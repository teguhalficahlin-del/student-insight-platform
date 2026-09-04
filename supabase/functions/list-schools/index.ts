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
 *                   primary_color, is_active, created_at,
 *                   has_admin_account, admin_name, admin_login_identifier }>
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
        const [schoolsRes, adminsRes, staffHealthRes, studentHealthRes, userCountsRes] = await Promise.all([
            admin
                .from('schools')
                .select('school_id, name, npsn, slug, phone, primary_color, is_active, created_at')
                .order('created_at', { ascending: false }),

            // Data admin per sekolah (untuk fitur reset password + tampilan username).
            // SUP-02 (direvisi 24 Agustus 2026): login_identifier semula tidak di-select
            // karena dianggap sensitif. Keputusan direvisi — Superadmin adalah operator
            // platform yang memerlukan username untuk keperluan operasional (identifikasi
            // akun, troubleshooting login). Endpoint sudah di-gate X-Superadmin-Key.
            admin
                .from('users')
                .select('school_id, full_name, login_identifier')
                .eq('role_type', 'ADMINISTRATIVE')
                .eq('is_active', true),

            // Health: hitung jabatan singleton + total staf per sekolah
            // Satu query GROUP BY — tidak ada N+1
            admin.rpc('fn_school_staff_health'),

            // Health: siswa total vs sudah punya akun login
            admin.rpc('fn_school_student_health'),

            // Jumlah pengguna aktif per role group per sekolah
            admin
                .from('users')
                .select('school_id, role_type')
                .eq('is_active', true)
                .in('role_type', ['GURU','WALI_KELAS','BK','WAKA_KURIKULUM','WAKA_HUMAS','WAKA_KESISWAAN','KEPSEK','KAPRODI','TU','ADMINISTRATIVE','SISWA','ORTU','DUDI','STAKEHOLDER']),
        ]);

        if (schoolsRes.error) throw schoolsRes.error;

        type AdminRow    = { school_id: string; full_name: string; login_identifier: string | null };
        type StaffHealth = { school_id: string; kepsek_count: number; waka_kurikulum_count: number; waka_kesiswaan_count: number; waka_humas_count: number; staff_count: number };
        type StudentHealth = { school_id: string; student_count: number; provisioned_count: number };
        type UserRow    = { school_id: string; role_type: string };

        // Agregasi jumlah pengguna per role group per sekolah
        const GURU_ROLES = new Set(['GURU','WALI_KELAS','BK','WAKA_KURIKULUM','WAKA_HUMAS','WAKA_KESISWAAN','KEPSEK','KAPRODI','TU','ADMINISTRATIVE']);
        const userCountsBySchool: Record<string, { guru: number; siswa: number; ortu: number; dudi: number; stakeholder: number }> = {};
        for (const u of ((userCountsRes.data ?? []) as UserRow[])) {
            if (!userCountsBySchool[u.school_id]) {
                userCountsBySchool[u.school_id] = { guru: 0, siswa: 0, ortu: 0, dudi: 0, stakeholder: 0 };
            }
            const g = userCountsBySchool[u.school_id];
            if (GURU_ROLES.has(u.role_type))    g.guru++;
            else if (u.role_type === 'SISWA')   g.siswa++;
            else if (u.role_type === 'ORTU')    g.ortu++;
            else if (u.role_type === 'DUDI')    g.dudi++;
            else if (u.role_type === 'STAKEHOLDER') g.stakeholder++;
        }

        const adminBySchool = Object.fromEntries(
            ((adminsRes.data ?? []) as AdminRow[]).map(a => [a.school_id, { full_name: a.full_name, login_identifier: a.login_identifier ?? null }])
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
            const uc = userCountsBySchool[s.school_id] ?? { guru: 0, siswa: 0, ortu: 0, dudi: 0, stakeholder: 0 };
            return {
                ...s,
                has_admin_account:        !!adminBySchool[s.school_id],
                admin_name:               adminBySchool[s.school_id]?.full_name ?? null,
                admin_login_identifier:   adminBySchool[s.school_id]?.login_identifier ?? null,
                // Health data
                health: {
                    kepsek_count:         sh?.kepsek_count         ?? 0,
                    waka_kurikulum_count: sh?.waka_kurikulum_count ?? 0,
                    waka_kesiswaan_count: sh?.waka_kesiswaan_count ?? 0,
                    waka_humas_count:     sh?.waka_humas_count     ?? 0,
                    staff_count:          sh?.staff_count          ?? 0,
                    student_count:        st?.student_count        ?? 0,
                    provisioned_count:    st?.provisioned_count    ?? 0,
                    // Jumlah pengguna aktif per role group
                    guru_count:           uc.guru,
                    siswa_count:          uc.siswa,
                    ortu_count:           uc.ortu,
                    dudi_count:           uc.dudi,
                    stakeholder_count:    uc.stakeholder,
                },
            };
        });

        return json(result);
    } catch (err) {
        return json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
});
