import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { unzipSync }    from "https://esm.sh/fflate@0.8.2";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ANTHROPIC_MODEL = "claude-haiku-4-5";
const ANTHROPIC_URL   = "https://api.anthropic.com/v1/messages";
const MAX_BASE64_LEN  = 14_000_000; // ~10 MB raw

// ── Helpers ─────────────────────────────────────────────────────────────────

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

// ── DOCX text extraction ─────────────────────────────────────────────────────

function extractDocxText(base64: string): string {
  const binary = atob(base64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const unzipped = unzipSync(bytes);
  const docXml   = unzipped["word/document.xml"];
  if (!docXml) throw new Error("word/document.xml tidak ditemukan — file DOCX mungkin rusak");

  const xmlText = new TextDecoder().decode(docXml);
  const texts: string[] = [];
  const regex = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xmlText)) !== null) {
    if (match[1]) texts.push(match[1]);
  }
  if (!texts.length) throw new Error("Tidak ada teks yang bisa diekstrak dari dokumen DOCX");
  return texts.join(" ").replace(/\s{2,}/g, " ").trim();
}

// ── Prompts ──────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT =
  "Kamu adalah asisten kurikulum SMK Indonesia. " +
  "Ekstrak semua Tujuan Pembelajaran (TP) dari dokumen ATP berikut. " +
  "Dokumen bisa berformat tabel atau narasi/paragraf. " +
  "Respond HANYA dengan JSON valid tanpa teks atau markdown apapun di luar JSON.";

const EXTRACT_INSTRUCTION = `Ekstrak semua Tujuan Pembelajaran (TP) dari dokumen ATP ini dan kembalikan dalam format JSON berikut:

{
  "tujuan_pembelajaran": [
    {
      "nomor": 1,
      "deskripsi": "Peserta didik mampu...",
      "elemen_cp": "nama elemen CP yang dicakup, atau 'Tidak teridentifikasi' jika tidak jelas",
      "jp": 0,
      "materi_pokok": "materi utama yang dipelajari",
      "kata_kerja_operasional": ["kata kerja 1", "kata kerja 2"]
    }
  ],
  "total_jp": 0,
  "catatan": "catatan penting tentang hasil ekstraksi"
}

Aturan:
- Minimal 1 TP, maksimal 30 TP
- Setiap TP WAJIB punya nomor (integer) dan deskripsi (string tidak kosong)
- Jika JP tidak tertulis eksplisit di dokumen, isi 0 dan catat di catatan
- Jika elemen_cp tidak jelas, isi "Tidak teridentifikasi"
- total_jp adalah jumlah seluruh jp dari semua TP
- Respond HANYA dengan JSON valid, tanpa penjelasan atau markdown`;

// ── Main ─────────────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Auth
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return errResponse(401, "Authorization header hilang");

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")      ?? "",
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

  // Parse body
  let body: {
    school_id?:       string;
    file_base64?:     string;
    file_type?:       string;
    file_name?:       string;
    core_subject_id?: string;
    phase_id?:        string;
  };
  try {
    body = await req.json();
  } catch {
    return errResponse(400, "Body JSON tidak valid");
  }

  const { file_base64, file_type, file_name } = body;
  if (!file_base64 || !file_type || !file_name) {
    return errResponse(400, "Field wajib tidak lengkap: file_base64, file_type, file_name");
  }
  if (!["pdf", "docx"].includes(file_type)) {
    return errResponse(400, "file_type harus 'pdf' atau 'docx'");
  }
  if (file_base64.length > MAX_BASE64_LEN) {
    return errResponse(413, "Ukuran file melebihi batas 10MB");
  }

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) return errResponse(503, "Konfigurasi Anthropic AI belum diatur di server");

  // Build Anthropic messages per file type
  let messages: unknown[];

  if (file_type === "pdf") {
    messages = [{
      role: "user",
      content: [
        {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: file_base64 },
        },
        { type: "text", text: EXTRACT_INSTRUCTION },
      ],
    }];
  } else {
    // DOCX: extract text server-side, send as plain text
    let docText: string;
    try {
      docText = extractDocxText(file_base64);
    } catch (e) {
      return errResponse(422, `Gagal mengekstrak teks dari DOCX: ${String(e)}`);
    }
    messages = [{
      role: "user",
      content: `DOKUMEN ATP:\n${docText}\n\n${EXTRACT_INSTRUCTION}`,
    }];
  }

  // Call Anthropic
  const anthropicResp = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type":      "application/json",
      "x-api-key":         anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model:       ANTHROPIC_MODEL,
      max_tokens:  8192,
      temperature: 0.1,
      system:      SYSTEM_PROMPT,
      messages,
    }),
  });

  const anthropicData = await anthropicResp.json();
  if (!anthropicResp.ok) {
    return errResponse(502, `Anthropic API error: ${anthropicData.error?.message ?? anthropicResp.status}`);
  }

  const rawText = anthropicData.content?.[0]?.text ?? "";
  if (!rawText) return errResponse(502, "Anthropic mengembalikan respons kosong");

  // Parse JSON (strip markdown fences jika ada)
  let result: { tujuan_pembelajaran?: unknown[]; total_jp?: number; catatan?: string };
  try {
    const clean = rawText.replace(/^```(?:json)?\s*/m, "").replace(/\s*```\s*$/m, "").trim();
    result = JSON.parse(clean);
  } catch {
    return errResponse(422, "Respons AI bukan JSON valid", { raw: rawText.slice(0, 500) });
  }

  // Validate
  if (!Array.isArray(result.tujuan_pembelajaran) || result.tujuan_pembelajaran.length === 0) {
    return errResponse(422, "Tidak ada Tujuan Pembelajaran yang berhasil diekstrak dari dokumen");
  }
  type TpItem = { nomor?: unknown; deskripsi?: unknown; jp?: number };
  const invalid = (result.tujuan_pembelajaran as TpItem[]).find(tp => tp.nomor === undefined || !tp.deskripsi);
  if (invalid) {
    return errResponse(422, "Setiap TP harus memiliki nomor dan deskripsi");
  }

  const totalJP = (result.tujuan_pembelajaran as TpItem[])
    .reduce((s, tp) => s + (Number(tp.jp) || 0), 0);

  return okResponse(
    {
      tujuan_pembelajaran: result.tujuan_pembelajaran,
      total_jp:            result.total_jp ?? totalJP,
      catatan:             result.catatan ?? "",
    },
    {
      model:        ANTHROPIC_MODEL,
      file_name,
      file_type,
      generated_at: new Date().toISOString(),
    },
  );
});
