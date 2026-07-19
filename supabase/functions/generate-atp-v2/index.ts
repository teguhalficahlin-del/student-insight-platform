import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_URL   = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

interface GenerateATPv2Request {
  school_id:       string;
  subject_id:      string;  // public.teaching_contexts subject_id (UUID)
  core_subject_id: string;  // core.subjects UUID
  phase_id:        string;  // core.phases UUID
  academic_year:   string;
  semester:        number;
  jp_per_week:     number;
  weeks_effective: number;
}

interface CPElement {
  urutan:    number;
  nama:      string;
  deskripsi: string;
}

interface CPContext {
  cp_umum:       string | null;
  rasional:      string | null;
  tujuan:        string | null;
  karakteristik: string | null;
  elemen:        CPElement[];
}

interface KnowledgeItem {
  category: string;
  label:    string;
  deskripsi: string;
}

function err(status: number, message: string, details?: unknown): Response {
  return new Response(
    JSON.stringify({ success: false, error: message, details }),
    { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
  );
}

function ok(data: unknown, metadata: unknown): Response {
  return new Response(
    JSON.stringify({ success: true, data, metadata }),
    { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
  );
}

// ── Context Builder Layer 1: CP + Elemen ──────────────────────────────────────
async function buildLayerCP(
  supabase: ReturnType<typeof createClient>,
  coreSubjectId: string,
  phaseId: string,
): Promise<CPContext | null> {
  const { data, error } = await supabase
    .from("capaian_pembelajaran")
    .select(`
      cp_umum, rasional, tujuan, karakteristik,
      cp_elements!left(element_order, nama_elemen, deskripsi_cp, is_active)
    `)
    .eq("subject_phases.subject_id", coreSubjectId)
    .eq("subject_phases.phase_id", phaseId)
    .limit(1)
    .single();

  // Fallback: join manual via subject_phases
  if (error || !data) {
    const { data: sp } = await supabase
      .schema("core")
      .from("subject_phases")
      .select("subject_phase_id")
      .eq("subject_id", coreSubjectId)
      .eq("phase_id", phaseId)
      .single();

    if (!sp) return null;

    const { data: cp } = await supabase
      .schema("core")
      .from("capaian_pembelajaran")
      .select(`
        cp_umum, rasional, tujuan, karakteristik,
        cp_elements(element_order, nama_elemen, deskripsi_cp, is_active)
      `)
      .eq("subject_phase_id", sp.subject_phase_id)
      .single();

    if (!cp) return null;

    const elemen: CPElement[] = ((cp as { cp_elements?: { element_order: number; nama_elemen: string; deskripsi_cp: string; is_active: boolean }[] }).cp_elements ?? [])
      .filter((e) => e.is_active)
      .sort((a, b) => a.element_order - b.element_order)
      .map((e) => ({ urutan: e.element_order, nama: e.nama_elemen, deskripsi: e.deskripsi_cp }));

    return {
      cp_umum:       (cp as { cp_umum: string }).cp_umum ?? null,
      rasional:      (cp as { rasional: string | null }).rasional ?? null,
      tujuan:        (cp as { tujuan: string | null }).tujuan ?? null,
      karakteristik: (cp as { karakteristik: string | null }).karakteristik ?? null,
      elemen,
    };
  }

  return null;
}

// ── Context Builder Layer 2: Knowledge Nasional ───────────────────────────────
async function buildLayerKnowledge(
  supabase: ReturnType<typeof createClient>,
  coreSubjectId: string,
): Promise<KnowledgeItem[]> {
  // Get program_id from subject
  const { data: subj } = await supabase
    .schema("core")
    .from("subjects")
    .select("vocational_program_id")
    .eq("subject_id", coreSubjectId)
    .single();

  const programId = (subj as { vocational_program_id?: string } | null)?.vocational_program_id ?? null;

  const query = supabase
    .schema("core")
    .from("knowledge_national")
    .select("category, label, deskripsi")
    .eq("is_active", true)
    .order("category");

  if (programId) query.or(`program_id.eq.${programId},program_id.is.null`);
  else query.is("program_id", null);

  const { data } = await query.limit(20);
  return (data ?? []) as KnowledgeItem[];
}

// ── Context Builder Layer 3: Teacher Profile + Teaching Context ───────────────
async function buildLayerTeacher(
  supabase: ReturnType<typeof createClient>,
  authUserId: string,
  schoolId: string,
  subjectId: string,
  academicYear: string,
) {
  const [profRes, ctxRes] = await Promise.allSettled([
    supabase
      .from("teacher_profiles")
      .select("instructional_intent, learning_model, depth_level, local_city, local_industry")
      .eq("teacher_user_id", authUserId)
      .eq("school_id", schoolId)
      .maybeSingle(),
    supabase
      .from("teaching_contexts")
      .select("expected_output, media_available, context_notes")
      .eq("teacher_user_id", authUserId)
      .eq("school_id", schoolId)
      .eq("subject_id", subjectId)
      .eq("academic_year", academicYear)
      .maybeSingle(),
  ]);

  const profil = profRes.status === "fulfilled" ? profRes.value.data : null;
  const konteks = ctxRes.status === "fulfilled" ? ctxRes.value.data : null;
  return { profil, konteks };
}

// ── Prompt Builder ────────────────────────────────────────────────────────────
function buildPrompt(
  cp: CPContext,
  knowledge: KnowledgeItem[],
  profil: Record<string, string> | null,
  konteks: Record<string, unknown> | null,
  req: GenerateATPv2Request,
  phaseName: string,
  subjectName: string,
): string {
  const totalJP = req.jp_per_week * req.weeks_effective;

  const cpUmumSection = cp.cp_umum && !cp.cp_umum.includes("[PENDING")
    ? `CAPAIAN PEMBELAJARAN:\n${cp.cp_umum}`
    : `CAPAIAN PEMBELAJARAN:\n[Mengacu pada SK BSKAP No. 046/H/KR/2025 untuk ${subjectName} Fase ${phaseName}]`;

  const elemenSection = cp.elemen.length > 0
    ? `ELEMEN CP:\n${cp.elemen.map((e, i) => `${i + 1}. ${e.nama}: ${e.deskripsi}`).join("\n")}`
    : "ELEMEN CP:\n[Tidak tersedia — buat TP berdasarkan karakteristik mata pelajaran]";

  const profilSection = profil ? `
- Tujuan pembelajaran: ${profil.instructional_intent ?? "-"}
- Model pembelajaran: ${profil.learning_model ?? "-"}
- Tingkat kedalaman: ${profil.depth_level ?? "-"}
- Konteks lokal: ${[profil.local_city, profil.local_industry].filter(Boolean).join(" — ") || "-"}` : "";

  const konteksSection = konteks ? `
- Output yang diharapkan: ${(konteks as { expected_output?: string }).expected_output ?? "-"}
- Catatan konteks: ${(konteks as { context_notes?: string }).context_notes ?? "-"}` : "";

  const knowledgeSection = knowledge.length > 0
    ? `\nKONTEKS INDUSTRI/BIDANG KEAHLIAN:\n${knowledge.map((k) => `- ${k.label}: ${k.deskripsi}`).join("\n")}`
    : "";

  return `Anda adalah ahli kurikulum SMK Indonesia yang berpengalaman dalam Kurikulum Merdeka.
Buat Alur Tujuan Pembelajaran (ATP) untuk mata pelajaran berikut:

MATA PELAJARAN: ${subjectName}
FASE: ${phaseName}
TAHUN AJARAN: ${req.academic_year}

${cpUmumSection}

${elemenSection}

KONTEKS MENGAJAR:
- JP per minggu: ${req.jp_per_week}
- Minggu efektif Semester ${req.semester}: ${req.weeks_effective}
- Total JP Semester ${req.semester}: ${totalJP}${profilSection}${konteksSection}${knowledgeSection}

INSTRUKSI:
Buat ATP untuk Semester ${req.semester} dengan format JSON berikut (HANYA JSON, tidak ada teks lain):
{
  "tujuan_pembelajaran": [
    {
      "nomor": 1,
      "deskripsi": "Peserta didik mampu...",
      "elemen_cp": "nama elemen yang dicakup",
      "jp": <jumlah JP untuk TP ini>,
      "materi_pokok": "materi utama",
      "kata_kerja_operasional": ["kata kerja 1", "kata kerja 2"]
    }
  ],
  "total_jp": ${totalJP},
  "catatan": "catatan penyusunan jika ada"
}

ATURAN WAJIB:
- Total JP semua TP harus TEPAT ${totalJP} JP
- Setiap TP merujuk minimal satu elemen CP (gunakan nama elemen yang ada)
- Gunakan kata kerja operasional Bloom's Taxonomy yang terukur
- Bahasa Indonesia formal
- Minimal 4 TP, maksimal 12 TP
- HANYA output JSON, tidak ada markdown, tidak ada penjelasan`;
}

// ── Gemini API Call ───────────────────────────────────────────────────────────
async function callGemini(prompt: string, apiKey: string): Promise<unknown> {
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
    throw new Error(`Gemini API ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = await res.json();
  const text: string = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  if (!text) throw new Error("Gemini returned empty response");

  // Strip markdown fences if present
  const cleaned = text.replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "").trim();
  return JSON.parse(cleaned);
}

// ── Main handler ─────────────────────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return err(401, "Authorization header hilang");

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // Verify user
  const supabaseUser = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();
  if (authErr || !user) return err(401, "Token tidak valid");

  const { data: userRow } = await supabaseAdmin
    .from("users")
    .select("role_type, school_id")
    .eq("auth_user_id", user.id)
    .single();

  if (!userRow) return err(403, "Pengguna tidak ditemukan");

  const ALLOWED = ["GURU","WALI_KELAS","BK","KAPRODI","KEPSEK","WAKA_KURIKULUM","WAKA_KESISWAAN","WAKA_HUMAS","ADMINISTRATIVE"];
  if (!ALLOWED.includes(userRow.role_type)) return err(403, "Akses ditolak");

  let body: GenerateATPv2Request;
  try {
    body = await req.json();
  } catch {
    return err(400, "Body JSON tidak valid");
  }

  if (!body.core_subject_id || !body.phase_id || !body.semester || !body.jp_per_week || !body.weeks_effective) {
    return err(400, "Field wajib tidak lengkap: core_subject_id, phase_id, semester, jp_per_week, weeks_effective");
  }

  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiKey) return err(503, "Konfigurasi Gemini AI belum diatur");

  // Get subject name and phase name for prompt
  const [subjRes, phaseRes] = await Promise.allSettled([
    supabaseAdmin.schema("core").from("subjects").select("name").eq("subject_id", body.core_subject_id).single(),
    supabaseAdmin.schema("core").from("phases").select("code").eq("phase_id", body.phase_id).single(),
  ]);
  const subjectName = subjRes.status === "fulfilled" ? (subjRes.value.data as { name: string } | null)?.name ?? "Mata Pelajaran" : "Mata Pelajaran";
  const phaseName   = phaseRes.status === "fulfilled" ? (phaseRes.value.data as { code: string } | null)?.code ?? "" : "";

  // Build context layers
  const [cp, knowledge, { profil, konteks }] = await Promise.all([
    buildLayerCP(supabaseAdmin, body.core_subject_id, body.phase_id),
    buildLayerKnowledge(supabaseAdmin, body.core_subject_id),
    buildLayerTeacher(supabaseAdmin, user.id, userRow.school_id, body.subject_id ?? "", body.academic_year),
  ]);

  if (!cp) {
    return err(422, `CP tidak ditemukan untuk mata pelajaran dan fase yang dipilih. Pastikan data CP sudah diisi di sistem.`);
  }

  const prompt = buildPrompt(
    cp,
    knowledge,
    profil as Record<string, string> | null,
    konteks as Record<string, unknown> | null,
    body,
    phaseName,
    subjectName,
  );

  let parsed: { tujuan_pembelajaran: unknown[]; total_jp: number; catatan?: string };
  try {
    parsed = await callGemini(prompt, geminiKey) as typeof parsed;
  } catch (e) {
    // Retry sekali dengan instruksi lebih ketat
    try {
      const retryPrompt = prompt + "\n\nPERINGATAN: Pastikan output adalah JSON valid. HANYA JSON saja.";
      parsed = await callGemini(retryPrompt, geminiKey) as typeof parsed;
    } catch (e2) {
      return err(502, `Gagal mendapat respons AI: ${String(e2)}`, { first_error: String(e) });
    }
  }

  if (!Array.isArray(parsed?.tujuan_pembelajaran)) {
    return err(422, "Format respons AI tidak valid — tujuan_pembelajaran bukan array");
  }

  return ok(
    {
      tujuan_pembelajaran: parsed.tujuan_pembelajaran,
      total_jp:            parsed.total_jp ?? body.jp_per_week * body.weeks_effective,
      catatan:             parsed.catatan ?? "",
    },
    {
      model:         GEMINI_MODEL,
      prompt_length: prompt.length,
      generated_at:  new Date().toISOString(),
      subject_name:  subjectName,
      phase:         phaseName,
      semester:      body.semester,
      total_jp_target: body.jp_per_week * body.weeks_effective,
    },
  );
});
