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

        // Jalankan semua query secara paralel untuk efisiensi
        const [schoolsRes, adminsRes, staffHealthRes, studentHealthRes] = await Promise.all([
            admin
                .from('schools')
                .select('school_id, name, npsn, slug, phone, primary_color, is_active, created_at')
                .order('created_at', { ascending: false }),

            // Data admin per sekolah (untuk fitur reset password)
            admin
                .from('users')
                .select('school_id, login_identifier, full_name')
                .eq('role_type', 'ADMINISTRATIVE')
                .eq('is_active', true),

            // Health: hitung jabatan singleton + total staf per sekolah
            // Satu query GROUP BY — tidak ada N+1
            admin.rpc('fn_school_staff_health'),

            // Health: siswa total vs sudah punya akun login
            admin.rpc('fn_school_student_health'),
        ]);

        if (schoolsRes.error) throw schoolsRes.error;

        type AdminRow   = { school_id: string; login_identifier: string; full_name: string };
        type StaffHealth = { school_id: string; kepsek_count: number; waka_kurikulum_count: number; waka_kesiswaan_count: number; waka_humas_count: number; staff_count: number };
        type StudentHealth = { school_id: string; student_count: number; provisioned_count: number };

        const adminBySchool = Object.fromEntries(
            ((adminsRes.data ?? []) as AdminRow[]).map(a => [a.school_id, { login_identifier: a.login_identifier, full_name: a.full_name }])
        );
        const staffBySchool = Object.fromEntries(
            ((staffHealthRes.data ?? []) as StaffHealth[]).map(h => [h.school_id, h])
        );
        const studentBySchool = Object.fromEntries(
            ((studentHealthRes.data ?? []) as StudentHealth[]).map(h => [h.school_id, h])
        );

        const result = ((schoolsRes.data ?? []) as { school_id: string; [key: string]: unknown }[]).map(s => {
            const sh = staffBySchool[s.school_id];
            const st = studentBySchool[s.school_id];
            return {
                ...s,
                admin_identifier:      adminBySchool[s.school_id]?.login_identifier ?? null,
                admin_name:            adminBySchool[s.school_id]?.full_name ?? null,
                // Health data
                health: {
                    kepsek_count:         sh?.kepsek_count         ?? 0,
                    waka_kurikulum_count: sh?.waka_kurikulum_count ?? 0,
                    waka_kesiswaan_count: sh?.waka_kesiswaan_count ?? 0,
                    waka_humas_count:     sh?.waka_humas_count     ?? 0,
                    staff_count:          sh?.staff_count          ?? 0,
                    student_count:        st?.student_count        ?? 0,
                    provisioned_count:    st?.provisioned_count    ?? 0,
                },
            };
        });

        return json(result);
    } catch (err) {
        return json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
});
