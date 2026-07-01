/**
 * @file list-schools/index.ts
 *
 * Mengembalikan daftar sekolah untuk dashboard Superadmin.
 * Superadmin bukan user Supabase auth (key-based) → tak bisa membaca
 * tabel `schools` lewat anon REST karena RLS `rls_schools_read_own`
 * butuh auth.uid(). Fungsi ini memakai service-role (bypass RLS) dan
 * digerbang oleh X-Superadmin-Key, sama seperti provision-school.
 *
 * Auth: Header  X-Superadmin-Key: <SUPERADMIN_KEY>
 * Deploy: supabase functions deploy list-schools --no-verify-jwt
 *
 * Response: array<{ school_id, name, npsn, slug, phone,
 *                   primary_color, is_active, created_at }>
 */

import { handleCors, corsHeaders } from '../_shared/cors.ts';
import { getAdminClient }          from '../_shared/db.ts';

function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}

Deno.serve(async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return handleCors();

    const superadminKey = Deno.env.get('SUPERADMIN_KEY');
    const reqKey        = req.headers.get('x-superadmin-key');
    if (!superadminKey || reqKey !== superadminKey) {
        return json({ error: 'Unauthorized' }, 401);
    }

    try {
        const admin = getAdminClient();
        const { data, error } = await admin
            .from('schools')
            .select('school_id, name, npsn, slug, phone, primary_color, is_active, created_at')
            .order('created_at', { ascending: false });
        if (error) throw error;
        return json(data ?? []);
    } catch (err) {
        return json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
});
