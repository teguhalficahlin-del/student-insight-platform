/**
 * @file delete-school/index.ts
 * @edge-function delete-school
 *
 * Hapus sekolah beserta semua datanya secara permanen.
 * Hanya bisa dipanggil oleh superadmin (X-Superadmin-Key).
 *
 * Urutan hapus (semua FK ke schools adalah NO ACTION/RESTRICT):
 *   1. Hapus auth accounts semua user sekolah (batched parallel)
 *   2. Hapus data forum (child → parent)
 *   3. Hapus data transaksional
 *   4. Hapus data jadwal
 *   5. Hapus entitas utama
 *   6. Hapus schools (terakhir)
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
    if (req.method !== 'DELETE') {
        return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
    }

    // Autentikasi superadmin
    const superadminKey = Deno.env.get('SUPERADMIN_KEY');
    const reqKey        = req.headers.get('x-superadmin-key');
    if (!superadminKey || reqKey !== superadminKey) {
        return json({ error: 'Unauthorized' }, 401);
    }

    let body: { school_id?: string };
    try { body = await req.json(); }
    catch { return json({ error: 'Body harus JSON: { school_id }' }, 400); }

    const { school_id } = body;
    if (!school_id) return json({ error: 'school_id wajib diisi' }, 400);

    const admin = getAdminClient();

    // 0. Pastikan sekolah ada dan sudah nonaktif
    const { data: school, error: schoolErr } = await admin
        .from('schools')
        .select('is_active, name')
        .eq('school_id', school_id)
        .single();

    if (schoolErr || !school) return json({ error: 'Sekolah tidak ditemukan' }, 404);
    if (school.is_active) {
        return json({ error: 'Sekolah harus dinonaktifkan terlebih dahulu sebelum dihapus' }, 409);
    }

    // 1. Ambil semua auth_user_id pengguna sekolah ini
    const { data: users, error: usersErr } = await admin
        .from('users')
        .select('auth_user_id')
        .eq('school_id', school_id);

    if (usersErr) {
        console.error('[delete-school] fetch users:', usersErr);
        return json({ error: usersErr.message }, 500);
    }

    // 2. Hapus semua Auth account — batched parallel (50 per batch)
    const authIds = (users ?? [])
        .map(u => u.auth_user_id)
        .filter(Boolean) as string[];

    const BATCH_SIZE = 50;
    const failedAuthIds: string[] = [];

    for (let i = 0; i < authIds.length; i += BATCH_SIZE) {
        const batch = authIds.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(
            batch.map(id => admin.auth.admin.deleteUser(id))
        );
        results.forEach((result, idx) => {
            if (result.status === 'rejected') {
                failedAuthIds.push(batch[idx]);
                console.warn('[delete-school] deleteUser fail:', batch[idx], result.reason);
            } else if (result.value.error) {
                const msg = result.value.error.message ?? '';
                if (!msg.includes('not found')) {
                    failedAuthIds.push(batch[idx]);
                    console.warn('[delete-school] deleteUser error:', batch[idx], msg);
                }
            }
        });
    }

    // 3. Hapus semua data sekolah secara eksplisit — urut FK
    //    Semua FK ke schools adalah NO ACTION/RESTRICT, tidak ada CASCADE.
    //    Urutan wajib: child tables dulu, schools terakhir.

    // case_events: append-only (trg_case_events_immutable memblokir DELETE).
    // Harus dihapus via SECURITY DEFINER function yang disable trigger sementara.
    const { error: ceErr } = await admin.rpc('fn_delete_school_case_events', { p_school_id: school_id });
    if (ceErr) {
        console.error('[delete-school] delete case_events:', ceErr);
        return json({ error: `Gagal menghapus case_events: ${ceErr.message}` }, 500);
    }

    const tables: string[] = [
        // ── Forum kelas (RESTRICT ke schools) ──────────────────
        'forum_post_comments',
        'forum_post_subjects',
        'forum_post_audience',
        'forum_post_acknowledgements',
        'forum_posts',
        // ── Penugasan (RESTRICT ke schools) ────────────────────
        'bk_class_assignments',
        'guru_wali_assignments',
        // ── Data transaksional ──────────────────────────────────
        // case_events sudah dihapus via rpc di atas
        'cases',
        'pkl_attendance',
        'pkl_placements',
        'observations',
        'attendance',
        'teacher_journals',
        'teacher_attendance_log',
        'substitute_schedules',
        'sync_idempotency',
        'achievements',
        'student_updates',
        // ── Relasi siswa ────────────────────────────────────────
        'class_enrollments',
        'student_parents',
        // ── Jadwal ──────────────────────────────────────────────
        'teaching_schedules',
        'schedule_templates',
        'schedule_time_slots',
        'teaching_assignments',
        // ── Notifikasi & log ────────────────────────────────────
        'login_devices',
        'notifications',
        // ── Entitas utama ───────────────────────────────────────
        'students',
        'academic_periods', // closed_by_user_id → users (RESTRICT), harus sebelum users
        'users',
        'subjects',
        'classes',
        'programs',
        // ── Config ──────────────────────────────────────────────
        'school_config',
        // ── Audit log (school_id TEXT, bukan FK — data orphan jika tidak dihapus) ─
        'audit_log',
    ];

    for (const table of tables) {
        const { error } = await admin
            .from(table)
            .delete()
            .eq('school_id', school_id);
        if (error) {
            console.error(`[delete-school] delete ${table}:`, error);
            return json({ error: `Gagal menghapus ${table}: ${error.message}` }, 500);
        }
    }

    // 4. Hapus baris schools — semua child sudah bersih
    const { error: delErr } = await admin
        .from('schools')
        .delete()
        .eq('school_id', school_id);

    if (delErr) {
        console.error('[delete-school] delete schools:', delErr);
        return json({ error: delErr.message }, 500);
    }

    return json({
        success: true,
        school_id,
        ...(failedAuthIds.length > 0 && {
            warning: `${failedAuthIds.length} akun auth gagal dihapus`,
            failed_auth_ids: failedAuthIds,
        }),
    });
});
