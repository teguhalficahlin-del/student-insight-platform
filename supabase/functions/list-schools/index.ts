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
        const { data: schools, error } = await admin
            .from('schools')
            .select('school_id, name, npsn, slug, phone, primary_color, is_active, created_at')
            .order('created_at', { ascending: false });
        if (error) throw error;

        // Sertakan data admin per sekolah (untuk fitur reset password)
        const { data: admins } = await admin
            .from('users')
            .select('school_id, login_identifier, full_name')
            .eq('role_type', 'ADMINISTRATIVE')
            .eq('is_active', true);

        const adminBySchool = Object.fromEntries(
            (admins ?? []).map(a => [a.school_id, { login_identifier: a.login_identifier, full_name: a.full_name }])
        );

        const result = (schools ?? []).map(s => ({
            ...s,
            admin_identifier: adminBySchool[s.school_id]?.login_identifier ?? null,
            admin_name:       adminBySchool[s.school_id]?.full_name ?? null,
        }));

        return json(result);
    } catch (err) {
        return json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
});
