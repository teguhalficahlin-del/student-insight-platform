import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ANTHROPIC_MODEL = "claude-haiku-4-5";
const ANTHROPIC_URL   = "https://api.anthropic.com/v1/messages";

// ── Types ──────────────────────────────────────────────────────────────────────

interface RequestBody {
  school_id:       string;
  academic_year:   string;
  core_subject_id: string;
  phase_id:        string;
  atp_doc_id:      string;
  weeks_sem1:      number;
  weeks_sem2:      number;
}

interface TPRow {
  nomor:       number;
  deskripsi:   string;
  jp:          number;
  materi_pokok: string;
  elemen_cp?:  string;
}

interface DistribusiRow {
  minggu:     number;
  tp_nomor:   number | null;
  materi:     string;
  jp:         number;
  keterangan: string;
}

interface SemesterDistribusi {
  minggu_efektif: number;
  distribusi:     DistribusiRow[];
}

interface ProtaResult {
  judul:      string;
  semester_1: SemesterDistribusi;
  semester_2: SemesterDistribusi;
  catatan:    string;
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
  subjectName: string,
  faseCode:    string,
  academicYear: string,
  tps:         TPRow[],
  weeksSem1:   number,
  weeksSem2:   number,
): string {
  const totalJp = tps.reduce((s, tp) => s + (tp.jp ?? 0), 0);
  const jpPerWeek = weeksSem1 > 0 ? Math.round(totalJp / weeksSem1) : 2;

  const tpList = tps.map(tp =>
    `- TP ${tp.nomor}: ${tp.deskripsi} | JP: ${tp.jp} | Materi: ${tp.materi_pokok}`
  ).join("\n");

  return `Buat Program Tahunan (Prota) untuk:
MATA PELAJARAN: ${subjectName}
FASE: ${faseCode}
TAHUN AJARAN: ${academicYear}

DAFTAR TUJUAN PEMBELAJARAN DARI ATP:
${tpList}

PARAMETER WAKTU:
- Semester 1: ${weeksSem1} minggu efektif (~${jpPerWeek} JP/minggu)
- Semester 2: ${weeksSem2} minggu efektif (~${jpPerWeek} JP/minggu)
- Total JP ATP: ${totalJp} JP

INSTRUKSI:
1. Distribusikan TP ke minggu-minggu Semester 1 secara proporsional (jp TP / jp_per_minggu ≈ jumlah minggu yang dibutuhkan).
2. Untuk Semester 2, lanjutkan atau ulangi TP dengan pendalaman/pengayaan yang sesuai konteks semester kedua.
3. Sisakan 2 minggu terakhir tiap semester: minggu ke-(N-1) untuk PAS/PAT, minggu ke-N untuk cadangan/remedial.
4. Minggu PAS/PAT: tp_nomor = null, jp = 0, keterangan = "PAS" (Sem 1) atau "PAT" (Sem 2).
5. Minggu cadangan: tp_nomor = null, jp = 0, keterangan = "CADANGAN".
6. Setiap entri distribusi = satu minggu (total entri = minggu_efektif masing-masing semester).
7. Response HANYA JSON valid, tanpa teks lain, tanpa markdown fence.

FORMAT RESPONSE (ikuti persis, isi semua ${weeksSem1} baris Sem 1 dan ${weeksSem2} baris Sem 2):
{
  "judul": "Program Tahunan ${subjectName} Fase ${faseCode} ${academicYear}",
  "semester_1": {
    "minggu_efektif": ${weeksSem1},
    "distribusi": [
      { "minggu": 1, "tp_nomor": 1, "materi": "...", "jp": ${jpPerWeek}, "keterangan": "" }
    ]
  },
  "semester_2": {
    "minggu_efektif": ${weeksSem2},
    "distribusi": [
      { "minggu": 1, "tp_nomor": 1, "materi": "...", "jp": ${jpPerWeek}, "keterangan": "" }
    ]
  },
  "catatan": "catatan singkat penyusunan Prota"
}`;
}

// ── Anthropic Call ──────────────────────────────────────────────────────────────

async function callAnthropic(prompt: string, apiKey: string): Promise<unknown> {
  const anthropicResp = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 8192,
      temperature: 0.3,
      system: "Kamu adalah asisten kurikulum SMK Indonesia. Buat Program Tahunan dari ATP yang diberikan. Respond HANYA dengan JSON valid sesuai format yang diminta. Jangan tambahkan teks, penjelasan, atau markdown apapun di luar JSON.",
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const anthropicData = await anthropicResp.json();
  if (!anthropicResp.ok) throw new Error(anthropicData.error?.message ?? `Anthropic error ${anthropicResp.status}`);

  const rawText = anthropicData.content?.[0]?.text ?? "";
  if (!rawText) throw new Error("Anthropic mengembalikan respons kosong");

  const clean = rawText.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
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

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return errResponse(401, "Token tidak valid atau sudah kedaluwarsa");

  const { data: userRow } = await userClient
    .from("users")
    .select("role_type, school_id")
    .eq("auth_user_id", user.id)
    .single();

  if (!userRow) return errResponse(403, "Pengguna tidak ditemukan");

  const ALLOWED_ROLES = [
    "GURU", "WALI_KELAS", "BK", "KAPRODI", "KEPSEK",
    "WAKA_KURIKULUM", "WAKA_KESISWAAN", "WAKA_HUMAS", "ADMINISTRATIVE",
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

  const { academic_year, core_subject_id, phase_id, atp_doc_id, weeks_sem1, weeks_sem2 } = body;
  if (!core_subject_id || !phase_id || !atp_doc_id || !weeks_sem1 || !weeks_sem2) {
    return errResponse(400, "Field wajib tidak lengkap: core_subject_id, phase_id, atp_doc_id, weeks_sem1, weeks_sem2");
  }

  // ── Fetch ATP document ───────────────────────────────────────────────────────
  const { data: atpDoc, error: atpErr } = await userClient
    .from("teacher_documents")
    .select("doc_id, content_json")
    .eq("doc_id", atp_doc_id)
    .eq("teacher_user_id", user.id)
    .single();

  if (atpErr || !atpDoc) {
    return errResponse(404, "ATP tidak ditemukan atau bukan milik Anda", { detail: atpErr?.message });
  }

  const tps: TPRow[] = (atpDoc as { content_json?: { tujuan_pembelajaran?: TPRow[] } })
    .content_json?.tujuan_pembelajaran ?? [];

  if (tps.length === 0) {
    return errResponse(422, "ATP tidak memiliki Tujuan Pembelajaran. Pastikan ATP sudah di-generate dengan benar.");
  }

  // ── Fetch subject info ───────────────────────────────────────────────────────
  const { data: cpData, error: cpErr } = await userClient
    .from("v_cp_for_generate")
    .select("subject_name, fase_code")
    .eq("core_subject_id", core_subject_id)
    .eq("phase_id", phase_id)
    .single();

  if (cpErr || !cpData) {
    return errResponse(422, "Data mata pelajaran tidak ditemukan", { detail: cpErr?.message });
  }

  // ── Build prompt & call Anthropic ───────────────────────────────────────────
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) return errResponse(503, "Konfigurasi Anthropic AI belum diatur di server");

  const prompt = buildPrompt(
    (cpData as { subject_name: string; fase_code: string }).subject_name,
    (cpData as { subject_name: string; fase_code: string }).fase_code,
    academic_year,
    tps,
    Number(weeks_sem1),
    Number(weeks_sem2),
  );

  let result: ProtaResult;
  try {
    result = await callAnthropic(prompt, anthropicKey) as ProtaResult;
  } catch (e) {
    try {
      result = await callAnthropic(
        prompt + "\n\nPASTIKAN output adalah JSON valid saja.",
        anthropicKey,
      ) as ProtaResult;
    } catch (e2) {
      return errResponse(502, `Gagal mendapat respons dari Anthropic AI: ${String(e2)}`, { first_error: String(e) });
    }
  }

  if (!Array.isArray(result?.semester_1?.distribusi) || !Array.isArray(result?.semester_2?.distribusi)) {
    return errResponse(422, "Format respons AI tidak valid — distribusi semester bukan array");
  }

  const subjectName = (cpData as { subject_name: string; fase_code: string }).subject_name;
  const faseCode    = (cpData as { subject_name: string; fase_code: string }).fase_code;

  return okResponse(
    {
      judul:      result.judul ?? `Program Tahunan ${subjectName} Fase ${faseCode} ${academic_year}`,
      semester_1: result.semester_1,
      semester_2: result.semester_2,
      catatan:    result.catatan ?? "",
    },
    {
      model:        ANTHROPIC_MODEL,
      generated_at: new Date().toISOString(),
      atp_doc_id,
    },
  );
});
