import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 4096;

interface GenerateATPRequest {
  subject_name: string;
  phase: string;       // e.g. "E" atau "F"
  jp_total: number;    // jam pelajaran total
  effective_weeks: number;
  special_focus?: string;
  cp_reference: string; // paste dari Kemdikbud
  subject_id: string;
  academic_year: string;
  school_id: string;
}

function buildSystemPrompt(): string {
  return `Kamu adalah asisten kurikulum Merdeka Belajar untuk SMK Indonesia.
Tugasmu menghasilkan Alur Tujuan Pembelajaran (ATP) yang sesuai dengan Capaian Pembelajaran (CP) yang diberikan.
PENTING: Kamu HARUS merespons HANYA dengan JSON yang valid. Tidak ada teks lain, tidak ada markdown, tidak ada penjelasan.
Format respons wajib:
{
  "tujuan_pembelajaran": [
    {
      "kode": "TP.1",
      "deskripsi": "...",
      "jp": 4,
      "minggu": 1,
      "fase": "E",
      "domain": "...",
      "kata_kerja_operasional": ["..."],
      "indikator": ["..."]
    }
  ],
  "total_jp": 72,
  "catatan_pengembang": "..."
}`;
}

function buildUserPrompt(req: GenerateATPRequest): string {
  return `Buat ATP untuk:
- Mata Pelajaran: ${req.subject_name}
- Fase: ${req.phase}
- Total JP: ${req.jp_total}
- Minggu Efektif: ${req.effective_weeks}
- Rata-rata JP per minggu: ${(req.jp_total / req.effective_weeks).toFixed(1)}
${req.special_focus ? `- Fokus Khusus: ${req.special_focus}` : ""}

Capaian Pembelajaran:
${req.cp_reference}

Hasilkan ATP dengan distribusi JP yang realistis dan tujuan pembelajaran yang terukur.
Ingat: respons HANYA JSON, tidak ada teks lain.`;
}

function extractJSON(raw: string): string {
  // Strategy 1: strip markdown code fences
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();

  // Strategy 2: extract first {...} block (greedy, handles leading/trailing text)
  const braceMatch = raw.match(/\{[\s\S]*\}/);
  if (braceMatch) return braceMatch[0];

  // Strategy 3: return as-is and let JSON.parse throw with context
  return raw;
}

function errorResponse(status: number, message: string, details?: unknown) {
  return new Response(
    JSON.stringify({ error: message, details }),
    { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
  );
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return errorResponse(401, "Missing Authorization header");

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return errorResponse(401, "Unauthorized");

  // ── Role check: hanya GURU boleh generate ATP ─────────────────────────────
  const { data: userRow, error: userError } = await supabase
    .from("users")
    .select("role, school_id")
    .eq("id", user.id)
    .single();

  if (userError || !userRow) return errorResponse(403, "User not found");
  if (!["GURU", "WAKA_KURIKULUM", "KEPALA_SEKOLAH"].includes(userRow.role)) {
    return errorResponse(403, "Insufficient role");
  }

  // ── Parse request body ────────────────────────────────────────────────────
  let body: GenerateATPRequest;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "Invalid JSON in request body");
  }

  const required: (keyof GenerateATPRequest)[] = [
    "subject_name", "phase", "jp_total", "effective_weeks",
    "cp_reference", "subject_id", "academic_year", "school_id"
  ];
  for (const field of required) {
    if (!body[field]) return errorResponse(400, `Missing required field: ${field}`);
  }

  // Tenant isolation: school_id dari body harus sama dengan user
  if (body.school_id !== userRow.school_id) {
    return errorResponse(403, "school_id mismatch");
  }

  // ── Call Anthropic API ────────────────────────────────────────────────────
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return errorResponse(500, "ANTHROPIC_API_KEY not configured");

  let claudeRaw = "";
  try {
    const claudeRes = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: buildSystemPrompt(),
        messages: [{ role: "user", content: buildUserPrompt(body) }],
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      return errorResponse(502, "Anthropic API error", { status: claudeRes.status, body: errText });
    }

    const claudeData = await claudeRes.json();

    // Extract text from Claude response (handles multi-block)
    const textBlocks = (claudeData.content ?? [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text);

    claudeRaw = textBlocks.join("\n").trim();

    if (!claudeRaw) {
      return errorResponse(502, "Empty response from Claude", { content: claudeData.content });
    }

  } catch (e) {
    return errorResponse(502, "Network error calling Anthropic", { message: String(e) });
  }

  // ── Parse Claude response ─────────────────────────────────────────────────
  let atpData: {
    tujuan_pembelajaran: unknown[];
    total_jp: number;
    catatan_pengembang: string;
  };

  try {
    const extracted = extractJSON(claudeRaw);
    atpData = JSON.parse(extracted);
  } catch (e) {
    // Expose raw for debugging — critical for diagnosing prompt issues
    return errorResponse(422, "Failed to parse Claude response as JSON", {
      raw: claudeRaw,
      extractError: String(e),
    });
  }

  // Validate structure
  if (!Array.isArray(atpData.tujuan_pembelajaran) || atpData.tujuan_pembelajaran.length === 0) {
    return errorResponse(422, "ATP response missing tujuan_pembelajaran array", { raw: claudeRaw });
  }

  // ── Save to DB ────────────────────────────────────────────────────────────
  // Save ATP header
  const { data: atpRow, error: atpError } = await supabase
    .from("alur_tujuan_pembelajaran")
    .upsert({
      subject_id: body.subject_id,
      school_id: body.school_id,
      academic_year: body.academic_year,
      phase: body.phase,
      jp_total: body.jp_total,
      effective_weeks: body.effective_weeks,
      special_focus: body.special_focus ?? null,
      cp_reference: body.cp_reference,
      catatan_pengembang: atpData.catatan_pengembang ?? null,
      generated_at: new Date().toISOString(),
      generated_by: user.id,
    }, { onConflict: "subject_id,school_id,academic_year" })
    .select("id")
    .single();

  if (atpError || !atpRow) {
    return errorResponse(500, "Failed to save ATP header", { error: atpError });
  }

  // Save TP rows — delete existing first for clean regeneration
  await supabase
    .from("tujuan_pembelajaran")
    .delete()
    .eq("atp_id", atpRow.id);

  const tpRows = (atpData.tujuan_pembelajaran as Array<{
    kode: string;
    deskripsi: string;
    jp: number;
    minggu: number;
    domain?: string;
    kata_kerja_operasional?: string[];
    indikator?: string[];
  }>).map((tp, idx) => ({
    atp_id: atpRow.id,
    school_id: body.school_id,
    kode: tp.kode ?? `TP.${idx + 1}`,
    deskripsi: tp.deskripsi ?? "",
    jp: Number(tp.jp) || 0,
    minggu: Number(tp.minggu) || idx + 1,
    domain: tp.domain ?? null,
    kata_kerja_operasional: tp.kata_kerja_operasional ?? [],
    indikator: tp.indikator ?? [],
    urutan: idx + 1,
  }));

  const { error: tpError } = await supabase
    .from("tujuan_pembelajaran")
    .insert(tpRows);

  if (tpError) {
    return errorResponse(500, "Failed to save tujuan_pembelajaran", { error: tpError });
  }

  return new Response(
    JSON.stringify({
      success: true,
      atp_id: atpRow.id,
      tp_count: tpRows.length,
      total_jp: atpData.total_jp,
    }),
    { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
  );
});
