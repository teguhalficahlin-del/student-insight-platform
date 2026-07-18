import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 8000;

interface GenerateATPRequest {
  subject_name: string;
  fase: string;           // "E" atau "F"
  kelas?: string;
  program?: string;
  program_id?: string;
  jp_per_minggu: number;
  minggu_sem1: number;
  minggu_sem2: number;
  fokus_khusus?: string;
  cp_referensi?: string;
}

function buildSystemPrompt(cpRef: string): string {
  const cpSection = cpRef
    ? `REFERENSI CP RESMI YANG DIBERIKAN GURU:\n${cpRef}\n\nGunakan CP di atas sebagai acuan UTAMA dalam membuat ATP. Setiap TP harus mengacu pada elemen CP yang tercantum.`
    : `Buat ATP berdasarkan pengetahuan Kurikulum Merdeka untuk SMK. Gunakan pendekatan Genre-Based untuk bahasa, STEM untuk sains, dan konteks kejuruan SMK untuk mapel produktif.`;

  return `Anda adalah ahli kurikulum SMK Indonesia yang berpengalaman dalam Kurikulum Merdeka (SK BSKAP No. 8 Tahun 2022).
${cpSection}
Respond ONLY with a valid JSON object. No explanation, no markdown fences, no preamble. Start your response directly with { and end with }.
Be concise. For deskripsi_cp and deskripsi_tp fields, maximum 2 sentences each.`;
}

function buildUserPrompt(req: GenerateATPRequest): string {
  const fokusLine = req.fokus_khusus?.trim() ? `Fokus khusus: ${req.fokus_khusus.trim()}` : "";
  const cpInstruction = req.cp_referensi?.trim()
    ? `PENTING: Setiap TP HARUS mengacu pada elemen CP yang diberikan di system prompt. Cantumkan nama elemen CP di field "elemen_cp" setiap TP.`
    : `Buat ATP sesuai Kurikulum Merdeka untuk SMK.`;

  return `Buat CP dan ATP untuk:
Mata Pelajaran: ${req.subject_name}
Fase: ${req.fase}${req.kelas ? ` (${req.kelas})` : ""}
Program Keahlian: ${req.program ?? "Umum"}
JP per minggu: ${req.jp_per_minggu}
Minggu efektif Semester 1: ${req.minggu_sem1}
Minggu efektif Semester 2: ${req.minggu_sem2}
${fokusLine}

${cpInstruction}

Format JSON:
{
  "capaian_pembelajaran": [
    {
      "elemen": "...",
      "deskripsi_cp": "..."
    }
  ],
  "tujuan_pembelajaran": [
    {
      "semester": 1,
      "urutan": 1,
      "kode_tp": "TP-XXX-E-01",
      "deskripsi_tp": "Peserta didik mampu...",
      "materi_pokok": "...",
      "alokasi_jp": 4,
      "indikator": ["...", "..."]
    }
  ]
}
Buat minimal 6 TP per semester.`;
}

function extractJSON(raw: string): string {
  // Strategy 1: strip markdown code fences
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();

  // Strategy 2: extract outermost { } block
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) return raw.slice(start, end + 1);

  // Strategy 3: return as-is, let JSON.parse throw with context
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
    .select("role_type, school_id")
    .eq("auth_user_id", user.id)
    .single();

  if (userError || !userRow) return errorResponse(403, "User not found");

  const ALLOWED_ROLES = [
    "GURU", "WALI_KELAS", "BK", "KAPRODI", "KEPSEK",
    "WAKA_KURIKULUM", "WAKA_KESISWAAN", "WAKA_HUMAS", "ADMINISTRATIVE",
  ];
  if (!ALLOWED_ROLES.includes(userRow.role_type)) {
    return errorResponse(403, "Akses ditolak.");
  }

  // ── Parse request body ────────────────────────────────────────────────────
  let body: GenerateATPRequest;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "Body JSON tidak valid.");
  }

  if (!body.subject_name || !body.fase || !body.jp_per_minggu) {
    return errorResponse(400, "Field wajib tidak lengkap: subject_name, fase, jp_per_minggu");
  }

  // ── Call Anthropic API ────────────────────────────────────────────────────
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return errorResponse(503, "Konfigurasi AI belum diatur.");

  const cpRef = body.cp_referensi?.trim() ?? "";

  let claudeRes: Response;
  try {
    claudeRes = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: buildSystemPrompt(cpRef),
        messages: [{ role: "user", content: buildUserPrompt(body) }],
      }),
    });
  } catch (e) {
    return errorResponse(502, "Gagal menghubungi API AI.", { message: String(e) });
  }

  if (!claudeRes.ok) {
    const errText = await claudeRes.text().catch(() => "");
    return errorResponse(502, `API AI error ${claudeRes.status}`, { body: errText });
  }

  const claudeJson = await claudeRes.json();
  const finishReason = claudeJson?.stop_reason ?? "unknown";

  if (finishReason === "max_tokens") {
    return errorResponse(422, "Response truncated — JSON tidak lengkap. Kurangi jumlah minggu atau sederhanakan CP Referensi.", {
      finish_reason: finishReason,
    });
  }

  // Extract text across all content blocks
  const rawText: string = (claudeJson?.content ?? [])
    .filter((b: { type: string }) => b.type === "text")
    .map((b: { text: string }) => b.text)
    .join("\n")
    .trim();

  if (!rawText) {
    return errorResponse(502, "Empty response from Claude", { content: claudeJson?.content });
  }

  // ── Parse Claude response ─────────────────────────────────────────────────
  let parsed: { capaian_pembelajaran: unknown[]; tujuan_pembelajaran: unknown[] };
  try {
    const extracted = extractJSON(rawText);
    parsed = JSON.parse(extracted);
  } catch (e) {
    return errorResponse(422, "Failed to parse Claude response as JSON", {
      raw: rawText,
      extractError: String(e),
    });
  }

  // Inject program_id into CP and TP arrays for frontend to use when saving
  if (body.program_id) {
    const cpList = Array.isArray(parsed.capaian_pembelajaran) ? parsed.capaian_pembelajaran : [];
    const tpList = Array.isArray(parsed.tujuan_pembelajaran) ? parsed.tujuan_pembelajaran : [];
    parsed.capaian_pembelajaran = cpList.map((cp) => ({ ...(cp as object), program_id: body.program_id }));
    parsed.tujuan_pembelajaran = tpList.map((tp) => ({ ...(tp as object), program_id: body.program_id }));
  }

  return new Response(JSON.stringify(parsed), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});
