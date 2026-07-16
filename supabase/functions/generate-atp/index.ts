/**
 * @file generate-atp/index.ts
 * @edge-function generate-atp
 *
 * Proxy ke Claude API untuk generate Capaian Pembelajaran + ATP.
 * API key Anthropic disimpan sebagai Supabase secret (ANTHROPIC_API_KEY),
 * tidak pernah terekspos ke browser.
 *
 * CONTRACT:
 *   POST /functions/v1/generate-atp
 *   Authorization: Bearer <supabase-jwt>
 *   Body: { subject_name, fase, kelas, program, jp_per_minggu,
 *            minggu_sem1, minggu_sem2, fokus_khusus? }
 *   Response: { capaian_pembelajaran: [...], tujuan_pembelajaran: [...] }
 */

import { handleCors, corsHeaders } from '../_shared/cors.ts';
import { resolveAuth, isAuthError } from '../_shared/auth.ts';
import { getAdminClient }           from '../_shared/db.ts';

const CLAUDE_MODEL   = 'claude-sonnet-4-6';
const MAX_TOKENS     = 8000;
const ANTHROPIC_URL  = 'https://api.anthropic.com/v1/messages';

const STAFF_ROLES = [
    'GURU','WALI_KELAS','BK','KAPRODI','KEPSEK',
    'WAKA_KURIKULUM','WAKA_KESISWAAN','WAKA_HUMAS','ADMINISTRATIVE',
];

Deno.serve(async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return handleCors();
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
    }

    const adminClient = getAdminClient();
    const authResult  = await resolveAuth(req, adminClient);
    if (authResult instanceof Response) return authResult;
    const { user } = authResult;

    if (!STAFF_ROLES.includes(user.role_type)) {
        return new Response(JSON.stringify({ error: 'Akses ditolak.' }), {
            status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    let body: {
        subject_name: string;
        fase: string;
        kelas: string;
        program: string;
        program_id?: string;
        jp_per_minggu: number;
        minggu_sem1: number;
        minggu_sem2: number;
        fokus_khusus?: string;
    };
    try {
        body = await req.json();
    } catch {
        return new Response(JSON.stringify({ error: 'Body JSON tidak valid.' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    const { subject_name, fase, kelas, program, program_id, jp_per_minggu, minggu_sem1, minggu_sem2, fokus_khusus, cp_referensi } = body;
    if (!subject_name || !fase || !kelas || !program || !jp_per_minggu) {
        return new Response(JSON.stringify({ error: 'Field wajib tidak lengkap.' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
        return new Response(JSON.stringify({ error: 'Konfigurasi AI belum diatur.' }), {
            status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    const fokusLine   = fokus_khusus?.trim() ? `Fokus khusus: ${fokus_khusus.trim()}` : '';
    const cpRef       = cp_referensi?.trim() ?? '';

    const systemPrompt = cpRef
        ? `Anda adalah ahli kurikulum SMK Indonesia yang berpengalaman dalam Kurikulum Merdeka (SK BSKAP No. 8 Tahun 2022).

REFERENSI CP RESMI YANG DIBERIKAN GURU:
${cpRef}

Gunakan CP di atas sebagai acuan UTAMA dalam membuat ATP. Setiap TP harus mengacu pada elemen CP yang tercantum.
Respond ONLY with a valid JSON object. No explanation, no markdown fences, no preamble. Start your response directly with { and end with }.
Be concise. For deskripsi_cp and deskripsi_tp fields, maximum 2 sentences each. Do not elaborate beyond what is necessary.`
        : `Anda adalah ahli kurikulum SMK Indonesia yang berpengalaman dalam Kurikulum Merdeka (SK BSKAP No. 8 Tahun 2022).
Buat ATP berdasarkan pengetahuan Kurikulum Merdeka untuk SMK. Gunakan pendekatan Genre-Based untuk bahasa, STEM untuk sains, dan konteks kejuruan SMK untuk mapel produktif.
Respond ONLY with a valid JSON object. No explanation, no markdown fences, no preamble. Start your response directly with { and end with }.
Be concise. For deskripsi_cp and deskripsi_tp fields, maximum 2 sentences each. Do not elaborate beyond what is necessary.`;

    const cpInstruction = cpRef
        ? `PENTING: Setiap TP HARUS mengacu pada elemen CP yang diberikan di system prompt. Cantumkan nama elemen CP di field "elemen_cp" setiap TP.`
        : `Buat ATP sesuai Kurikulum Merdeka untuk SMK.`;

    const userPrompt = `Buat CP dan ATP untuk:
Mata Pelajaran: ${subject_name}
Fase: ${fase} (${kelas})
Program Keahlian: ${program}
JP per minggu: ${jp_per_minggu}
Minggu efektif Semester 1: ${minggu_sem1}
Minggu efektif Semester 2: ${minggu_sem2}
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

    let claudeRes: Response;
    try {
        claudeRes = await fetch(ANTHROPIC_URL, {
            method: 'POST',
            headers: {
                'x-api-key':         apiKey,
                'anthropic-version': '2023-06-01',
                'content-type':      'application/json',
            },
            body: JSON.stringify({
                model:      CLAUDE_MODEL,
                max_tokens: MAX_TOKENS,
                system:     systemPrompt,
                messages:   [{ role: 'user', content: userPrompt }],
            }),
        });
    } catch (e) {
        return new Response(JSON.stringify({ error: 'Gagal menghubungi API AI.' }), {
            status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    if (!claudeRes.ok) {
        const errText = await claudeRes.text().catch(() => '');
        return new Response(JSON.stringify({ error: `API AI error ${claudeRes.status}: ${errText}` }), {
            status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    const claudeJson = await claudeRes.json();
    const rawText: string = claudeJson?.content?.[0]?.text ?? '';
    const finishReason = claudeJson?.stop_reason ?? 'unknown';

    console.log('[generate-atp] finish_reason:', finishReason);
    console.log('[generate-atp] raw response:', rawText.substring(0, 500));

    if (finishReason === 'max_tokens') {
        return new Response(JSON.stringify({
            error:         'Response truncated',
            message:       'Claude response terpotong — JSON tidak lengkap. Coba kurangi jumlah minggu atau sederhanakan CP Referensi.',
            finish_reason: finishReason,
        }), {
            status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    if (!rawText) {
        return new Response(JSON.stringify({
            error: 'Empty response from Claude',
            raw:   JSON.stringify(claudeJson).slice(0, 500),
        }), {
            status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    function extractJson(text: string): string | null {
        // Strategy 1: strip markdown fences
        const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (fenced) return fenced[1].trim();
        // Strategy 2: find outermost { }
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end > start) return text.slice(start, end + 1);
        return null;
    }

    const extracted = extractJson(rawText);
    if (!extracted) {
        return new Response(JSON.stringify({
            error: 'Cannot extract JSON from Claude response',
            raw:   rawText.slice(0, 500),
        }), {
            status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    let parsed: { capaian_pembelajaran: unknown[]; tujuan_pembelajaran: unknown[] };
    try {
        parsed = JSON.parse(extracted);
    } catch (e) {
        return new Response(JSON.stringify({
            error:   'JSON.parse failed',
            message: (e as Error).message,
            raw:     extracted.slice(0, 500),
        }), {
            status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    // Inject program_id ke setiap CP dan TP agar frontend bisa meneruskan ke DB
    if (program_id) {
        const cpList = Array.isArray(parsed.capaian_pembelajaran) ? parsed.capaian_pembelajaran : [];
        const tpList = Array.isArray(parsed.tujuan_pembelajaran)  ? parsed.tujuan_pembelajaran  : [];
        parsed.capaian_pembelajaran = cpList.map((cp: Record<string, unknown>) => ({ ...cp, program_id }));
        parsed.tujuan_pembelajaran  = tpList.map((tp: Record<string, unknown>) => ({ ...tp, program_id }));
    }

    return new Response(JSON.stringify(parsed), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
});
