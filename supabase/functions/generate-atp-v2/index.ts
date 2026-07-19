import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_URL   = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// ── Types ──────────────────────────────────────────────────────────────────────

interface RequestBody {
  school_id:       string;
  core_subject_id: string;
  phase_id:        string;
  academic_year:   string;
  semester:        number;
  jp_per_week:     number;
  weeks_effective: number;
}

interface CPRow {
  core_subject_id: string;
  phase_id:        string;
  fase_code:       string;
  subject_name:    string;
  cp_umum:         string | null;
  rasional:        string | null;
  tujuan:          string | null;
  karakteristik:   string | null;
  elemen: Array<{
    urutan:    number;
    nama:      string;
    deskripsi: string;
  }>;
}

interface TeacherProfile {
  instructional_intent: string | null;
  learning_model:       string | null;
  depth_level:          string | null;
  local_city:           string | null;
  local_industry:       string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function errResponse(status: number, message: string, details?: unknown): Response {
  return new Response(
    JSON.stringify({ success: false, error: message, details }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

function okResponse(data: unknown, metadata: unknown): Response {
  return new Response(
    JSON.stringify({ success: true, data, metadata }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

// ── Prompt Builder ──────────────────────────────────────────────────────────────

function buildPrompt(
  cp: CPRow,
  profile: TeacherProfile | null,
  semester: number,
  jpPerWeek: number,
  weeksEffective: number,
): string {
  const totalJP = jpPerWeek * weeksEffective;

  const cpUmumText = (cp.cp_umum && !cp.cp_umum.startsWith("[PENDING"))
    ? cp.cp_umum
    : `[Mengacu pada SK BSKAP No. 046/H/KR/2025 untuk ${cp.subject_name} Fase ${cp.fase_code}]`;

  const elemenText = cp.elemen.length > 0
    ? cp.elemen
        .sort((a, b) => a.urutan - b.urutan)
        .map((e, i) => `${i + 1}. ${e.nama}: ${e.deskripsi}`)
        .join("\n")
    : "[Elemen CP tidak tersedia — susun TP berdasarkan karakteristik mata pelajaran]";

  const profilText = profile ? `
KONTEKS MENGAJAR GURU:
- Tujuan pembelajaran: ${profile.instructional_intent ?? "Tidak diisi"}
- Model pembelajaran: ${profile.learning_model ?? "Tidak diisi"}
- Tingkat kedalaman: ${profile.depth_level ?? "Menengah"}
- Konteks lokal: ${[profile.local_city, profile.local_industry].filter(Boolean).join(", ") || "Tidak diisi"}` : "";

  return `Anda adalah ahli kurikulum SMK Indonesia yang berpengalaman dalam Kurikulum Merdeka (SK BSKAP No. 8 Tahun 2022).
Buat Alur Tujuan Pembelajaran (ATP) berdasarkan data berikut:

MATA PELAJARAN: ${cp.subject_name}
FASE: ${cp.fase_code}
SEMESTER: ${semester}
JP PER MINGGU: ${jpPerWeek}
MINGGU EFEKTIF: ${weeksEffective}
TOTAL JP SEMESTER ${semester}: ${totalJP}

CAPAIAN PEMBELAJARAN:
${cpUmumText}

ELEMEN CAPAIAN PEMBELAJARAN:
${elemenText}
${profilText}

INSTRUKSI PENTING:
1. Buat daftar Tujuan Pembelajaran (TP) untuk Semester ${semester}
2. Total JP semua TP HARUS TEPAT ${totalJP} JP
3. Setiap TP merujuk minimal satu elemen CP (sebutkan nama elemennya)
4. Gunakan kata kerja operasional Bloom's Taxonomy yang terukur
5. Bahasa Indonesia formal
6. Minimal 4 TP, maksimal 12 TP
7. Response HANYA JSON valid, tidak ada teks lain, tidak ada markdown fence

FORMAT RESPONSE:
{
  "tujuan_pembelajaran": [
    {
      "nomor": 1,
      "deskripsi": "Peserta didik mampu...",
      "elemen_cp": "nama elemen yang dicakup",
      "jp": 12,
      "materi_pokok": "materi utama",
      "kata_kerja_operasional": ["menganalisis", "merancang"]
    }
  ],
  "total_jp": ${totalJP},
  "catatan": "catatan penyusunan ATP"
}`;
}

// ── Gemini Call ─────────────────────────────────────────────────────────────────

async function callGemini(prompt: string, apiKey: string): Promise<unknown> {
  // Format key AQ.xxx benar dipakai sebagai ?key= query param (bukan Bearer)
  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature:      0.3,
        maxOutputTokens:  8192,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // 429 = quota habis, berikan pesan yang jelas
    if (res.status === 429) {
      throw new Error(`Quota Gemini API habis. Coba lagi beberapa menit. Detail: ${body.slice(0, 200)}`);
    }
    throw new Error(`Gemini API ${res.status}: ${body.slice(0, 400)}`);
  }

  const json = await res.json();
  const raw: string = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!raw) throw new Error("Gemini mengembalikan respons kosong");

  // Strip markdown fences jika ada
  const clean = raw.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
  return JSON.parse(clean);
}

// ── Main ────────────────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // ── Auth ────────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return errResponse(401, "Authorization header hilang");

  // User client — pakai JWT guru → RLS berlaku
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return errResponse(401, "Token tidak valid atau sudah kedaluwarsa");

  // Role check
  const { data: userRow } = await userClient
    .from("users")
    .select("role_type, school_id")
    .eq("auth_user_id", user.id)
    .single();

  if (!userRow) return errResponse(403, "Pengguna tidak ditemukan");

  const ALLOWED_ROLES = [
    "GURU","WALI_KELAS","BK","KAPRODI","KEPSEK",
    "WAKA_KURIKULUM","WAKA_KESISWAAN","WAKA_HUMAS","ADMINISTRATIVE",
  ];
  if (!ALLOWED_ROLES.includes(userRow.role_type)) {
    return errResponse(403, "Akses ditolak — hanya staf sekolah");
  }

  // ── Parse body ───────────────────────────────────────────────────────────────
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return errResponse(400, "Body JSON tidak valid");
  }

  const { core_subject_id, phase_id, academic_year, semester, jp_per_week, weeks_effective } = body;
  if (!core_subject_id || !phase_id || !semester || !jp_per_week || !weeks_effective) {
    return errResponse(400, "Field wajib tidak lengkap: core_subject_id, phase_id, semester, jp_per_week, weeks_effective");
  }

  // ── Layer 1: CP via view ────────────────────────────────────────────────────
  // v_cp_for_generate accessible oleh authenticated → pakai userClient
  const { data: cpData, error: cpErr } = await userClient
    .from("v_cp_for_generate")
    .select("*")
    .eq("core_subject_id", core_subject_id)
    .eq("phase_id", phase_id)
    .single();

  if (cpErr || !cpData) {
    return errResponse(422, "CP tidak ditemukan untuk mata pelajaran dan fase yang dipilih.", { detail: cpErr?.message });
  }
  const cp = cpData as CPRow;

  // ── Layer 3: Teacher Profile ────────────────────────────────────────────────
  const { data: profileData } = await userClient
    .from("teacher_profiles")
    .select("instructional_intent, learning_model, depth_level, local_city, local_industry")
    .eq("teacher_user_id", user.id)
    .eq("school_id", userRow.school_id)
    .maybeSingle();

  const profile = profileData as TeacherProfile | null;

  // ── Build prompt & call Gemini ──────────────────────────────────────────────
  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiKey) return errResponse(503, "Konfigurasi Gemini AI belum diatur di server");

  const prompt = buildPrompt(cp, profile, semester, jp_per_week, weeks_effective);
  const totalJP = jp_per_week * weeks_effective;

  let result: { tujuan_pembelajaran: Array<{ jp?: number }>; total_jp?: number; catatan?: string };
  try {
    result = await callGemini(prompt, geminiKey) as typeof result;
  } catch (e) {
    // Retry sekali
    try {
      result = await callGemini(prompt + "\n\nPASTIKAN output adalah JSON valid saja.", geminiKey) as typeof result;
    } catch (e2) {
      return errResponse(502, `Gagal mendapat respons dari Gemini AI: ${String(e2)}`, { first_error: String(e) });
    }
  }

  if (!Array.isArray(result?.tujuan_pembelajaran)) {
    return errResponse(422, "Format respons AI tidak valid — tujuan_pembelajaran bukan array");
  }

  // Validasi total JP & tambah catatan jika mismatch
  const actualTotal = result.tujuan_pembelajaran.reduce((s, tp) => s + (tp.jp ?? 0), 0);
  if (actualTotal !== totalJP) {
    result.catatan = (result.catatan ?? "").trim();
    result.catatan += (result.catatan ? " " : "") +
      `[Perhatian: Total JP hasil generate (${actualTotal}) berbeda dari target (${totalJP}). Harap periksa distribusi JP.]`;
  }

  return okResponse(
    {
      tujuan_pembelajaran: result.tujuan_pembelajaran,
      total_jp:            result.total_jp ?? actualTotal,
      catatan:             result.catatan ?? "",
    },
    {
      model:           GEMINI_MODEL,
      subject_name:    cp.subject_name,
      fase:            cp.fase_code,
      semester,
      total_jp_target: totalJP,
      total_jp_actual: actualTotal,
      jp_valid:        actualTotal === totalJP,
      generated_at:    new Date().toISOString(),
    },
  );
});
