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
const MAX_TOKENS     = 4000;
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

    const { subject_name, fase, kelas, program, jp_per_minggu, minggu_sem1, minggu_sem2, fokus_khusus } = body;
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

    const fokusLine = fokus_khusus?.trim()
        ? `Fokus khusus: ${fokus_khusus.trim()}`
        : '';

    const userPrompt = `Buat CP dan ATP untuk:
Mata Pelajaran: ${subject_name}
Fase: ${fase} (${kelas})
Program Keahlian: ${program}
JP per minggu: ${jp_per_minggu}
Minggu efektif Semester 1: ${minggu_sem1}
Minggu efektif Semester 2: ${minggu_sem2}
${fokusLine}

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
                system:     'Anda adalah asisten kurikulum SMK Indonesia ahli Kurikulum Merdeka. Buat CP dan ATP yang sesuai panduan resmi Kemdikbud untuk SMK. Respond ONLY dengan JSON valid, tanpa penjelasan apapun.',
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
    const rawText = claudeJson?.content?.[0]?.text ?? '';

    console.log('[generate-atp] raw response:', rawText.substring(0, 500));

    let parsed: { capaian_pembelajaran: unknown[]; tujuan_pembelajaran: unknown[] };
    try {
        // Ekstrak JSON object terluar — robust terhadap teks naratif sebelum/sesudah
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('No JSON object found in response');
        console.log('[generate-atp] jsonMatch (first 200):', jsonMatch[0].substring(0, 200));
        parsed = JSON.parse(jsonMatch[0]);
    } catch {
        return new Response(JSON.stringify({
            error: 'AI mengembalikan respons yang tidak valid. Coba generate ulang.',
            raw:   rawText.slice(0, 500),
        }), {
            status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    return new Response(JSON.stringify(parsed), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
});
