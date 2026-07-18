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
  phase: string;        // "E" atau "F"
  jp_per_minggu: number;
  minggu_sem1: number;
  minggu_sem2: number;
  special_focus?: string;
  cp_reference?: string;
  subject_id: string;
  program_id?: string;
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
      "kode_tp": "TP-E-01",
      "deskripsi_tp": "Peserta didik mampu ...",
      "fase": "E",
      "semester": 1,
      "urutan": 1,
      "alokasi_jp": 4,
      "materi_pokok": "...",
      "indikator": ["...", "..."]
    }
  ]
}
Catatan: field "semester" wajib berisi 1 atau 2.`;
}

function buildUserPrompt(req: GenerateATPRequest): string {
  const jp_sem1 = req.jp_per_minggu * req.minggu_sem1;
  const jp_sem2 = req.jp_per_minggu * req.minggu_sem2;
  const focusLine = req.special_focus ? `\n- Fokus Khusus: ${req.special_focus}` : "";
  const cpSection = req.cp_reference
    ? `\nCapaian Pembelajaran Referensi:\n${req.cp_reference}`
    : "";

  return `Buat ATP untuk:
- Mata Pelajaran: ${req.subject_name}
- Fase: ${req.phase}
- JP per minggu: ${req.jp_per_minggu}
- Semester 1: ${req.minggu_sem1} minggu (${jp_sem1} JP)
- Semester 2: ${req.minggu_sem2} minggu (${jp_sem2} JP)${focusLine}${cpSection}

Distribusikan TP secara proporsional antara semester 1 dan 2.
Total JP harus mendekati ${jp_sem1 + jp_sem2} JP.
Buat minimal 6 TP per semester.
Ingat: respons HANYA JSON, tidak ada teks lain.`;
}

function extractJSON(raw: string): string {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();
  const braceMatch = raw.match(/\{[\s\S]*\}/);
  if (braceMatch) return braceMatch[0];
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

  // ── Role check ────────────────────────────────────────────────────────────
  const { data: userRow, error: userError } = await supabase
    .from("users")
    .select("role_type, school_id, user_id")
    .eq("auth_user_id", user.id)
    .single();

  if (userError || !userRow) return errorResponse(403, "User not found");
  if (!["GURU", "WAKA_KURIKULUM", "KEPALA_SEKOLAH"].includes(userRow.role_type)) {
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
    "subject_name", "phase", "jp_per_minggu", "minggu_sem1", "minggu_sem2",
    "subject_id", "school_id",
  ];
  for (const field of required) {
    if (body[field] === undefined || body[field] === null || body[field] === "") {
      return errorResponse(400, `Missing required field: ${field}`);
    }
  }

  // Tenant isolation
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

    if (claudeData.stop_reason === "max_tokens") {
      return errorResponse(422, "Response truncated by max_tokens — kurangi minggu atau sederhanakan CP", {
        stop_reason: "max_tokens",
      });
    }

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
  let atpData: { tujuan_pembelajaran: Array<Record<string, unknown>> };

  try {
    const extracted = extractJSON(claudeRaw);
    atpData = JSON.parse(extracted);
  } catch (e) {
    return errorResponse(422, "Failed to parse Claude response as JSON", {
      raw: claudeRaw,
      extractError: String(e),
    });
  }

  if (!Array.isArray(atpData.tujuan_pembelajaran) || atpData.tujuan_pembelajaran.length === 0) {
    return errorResponse(422, "ATP response missing tujuan_pembelajaran array", { raw: claudeRaw });
  }

  // ── Save to DB (schema: tujuan_pembelajaran per migration 75b6fa8) ─────────
  // Delete existing AI-generated TPs for this subject+fase+school before re-insert
  const { error: deleteError } = await supabase
    .from("tujuan_pembelajaran")
    .delete()
    .eq("school_id", body.school_id)
    .eq("subject_id", body.subject_id)
    .eq("fase", body.phase)
    .eq("generated_by", "AI");

  if (deleteError) {
    return errorResponse(500, "Failed to delete existing TPs", { error: deleteError });
  }

  const tpRows = atpData.tujuan_pembelajaran.map((tp, idx) => ({
    school_id: body.school_id,
    subject_id: body.subject_id,
    program_id: body.program_id ?? null,
    fase: (tp.fase as string) ?? body.phase,
    semester: Number(tp.semester) === 2 ? 2 : 1,
    urutan: Number(tp.urutan) || idx + 1,
    kode_tp: (tp.kode_tp as string) ?? `TP-${body.phase}-${String(idx + 1).padStart(2, "0")}`,
    deskripsi_tp: (tp.deskripsi_tp as string) ?? "",
    materi_pokok: (tp.materi_pokok as string) ?? null,
    alokasi_jp: Number(tp.alokasi_jp) || null,
    indikator: Array.isArray(tp.indikator) ? tp.indikator as string[] : [],
    generated_by: "AI",
    created_by: userRow.user_id,
  }));

  const { error: insertError } = await supabase
    .from("tujuan_pembelajaran")
    .insert(tpRows);

  if (insertError) {
    return errorResponse(500, "Failed to save tujuan_pembelajaran", { error: insertError });
  }

  return new Response(
    JSON.stringify({
      success: true,
      tp_count: tpRows.length,
      tp_sem1: tpRows.filter(r => r.semester === 1).length,
      tp_sem2: tpRows.filter(r => r.semester === 2).length,
    }),
    { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
  );
});
