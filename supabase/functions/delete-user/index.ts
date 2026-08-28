/**
 * @file delete-user/index.ts
 * @edge-function delete-user
 *
 * Hard-delete staff yang tidak lagi memiliki data aktif.
 * Staff dengan data aktif ditolak agar histori operasional tidak ikut hilang.
 *
 * CONTRACT:
 *   DELETE /functions/v1/delete-user
 *   Body: { "user_id": "<uuid>" }
 *   Caller: ADMINISTRATIVE only
 *
 * URUTAN:
 *   1. Validasi — user ada, sekolah sama, bukan ADMINISTRATIVE, bukan diri sendiri
 *   2. Tolak jika masih memiliki data aktif
 *   3. Hapus byproduct non-historis yang mereferensikan user
 *   4. Hapus baris users
 *   5. Hapus Auth account paling akhir
 */

import { handleCors, corsHeaders }  from '../_shared/cors.ts';
import { ok, badRequest, forbidden, conflict,
         internalError,
         checkSchemaVersion }        from '../_shared/response.ts';
import { resolveAuth, isAuthError }  from '../_shared/auth.ts';
import { getAdminClient }            from '../_shared/db.ts';

Deno.serve(async (req: Request): Promise<Response> => {

    if (req.method === 'OPTIONS') return handleCors();
    if (req.method !== 'DELETE') {
        return new Response('Method Not Allowed',
            { status: 405, headers: corsHeaders });
    }

    try {
        const versionError = checkSchemaVersion(req);
        if (versionError) return versionError;

        const admin      = getAdminClient();
        const authResult = await resolveAuth(req, admin);
        if (isAuthError(authResult)) return authResult;
        const { user } = authResult;

        if (user.role_type !== 'ADMINISTRATIVE') {
            return forbidden('Hanya ADMINISTRATIVE yang dapat menghapus pengguna');
        }

        let body: { user_id?: string };
        try {
            body = await req.json();
        } catch {
            return badRequest('Body harus berformat JSON: { "user_id": "<uuid>" }');
        }

        const { user_id } = body;
        if (!user_id) return badRequest('Field user_id wajib diisi');

        if (user_id === user.user_id) {
            return forbidden('Tidak dapat menghapus akun Anda sendiri');
        }

        // 1. Ambil target user — filter school_id mencegah hapus user sekolah lain
        const { data: targetUser, error: fetchErr } = await admin
            .from('users')
            .select('auth_user_id, role_type, full_name, school_id, deleted_at')
            .eq('user_id', user_id)
            .eq('school_id', user.school_id)
            .maybeSingle();

        if (fetchErr) return internalError(fetchErr);
        if (!targetUser) {
            return badRequest(`Pengguna dengan user_id "${user_id}" tidak ditemukan di sekolah ini`);
        }
        if (targetUser.role_type === 'ADMINISTRATIVE') {
            return forbidden('Akun ADMINISTRATIVE tidak dapat dihapus melalui panel ini');
        }
        // 2. Tolak hard-delete jika staff masih memiliki data aktif.
        // Schema aktual memakai is_active pada teaching_assignments dan tidak
        // memiliki deleted_at pada learning_objectives.
        const activeChecks = await Promise.all([
            admin.from('teaching_assignments')
                .select('assignment_id', { count: 'exact', head: true })
                .eq('user_id', user_id)
                .eq('is_active', true),
            admin.from('teaching_schedules')
                .select('schedule_id', { count: 'exact', head: true })
                .eq('scheduled_teacher_id', user_id),
            admin.from('teacher_journals')
                .select('journal_id', { count: 'exact', head: true })
                .eq('owner_user_id', user_id),
            admin.from('learning_objectives')
                .select('id', { count: 'exact', head: true })
                .eq('teacher_id', user_id),
            admin.from('coaching_cases')
                .select('case_id', { count: 'exact', head: true })
                .eq('current_handler_user_id', user_id)
                .neq('status', 'CLOSED'),
            admin.from('forum_posts')
                .select('post_id', { count: 'exact', head: true })
                .eq('author_user_id', user_id)
                .eq('is_withdrawn', false),
        ]);

        const activeLabels = [
            'penugasan mengajar',
            'jadwal mengajar',
            'jurnal guru',
            'tujuan pembelajaran',
            'kasus aktif',
            'posting forum aktif',
        ];
        const activeData: Array<{ type: string; count: number }> = [];
        for (let i = 0; i < activeChecks.length; i++) {
            const check = activeChecks[i];
            if (check.error) return internalError(check.error);
            if ((check.count ?? 0) > 0) {
                activeData.push({ type: activeLabels[i], count: check.count ?? 0 });
            }
        }

        if (activeData.length > 0) {
            return conflict(
                'Staf ini memiliki data aktif dan tidak dapat dihapus. Nonaktifkan staf terlebih dahulu.',
                { active_data: activeData },
            );
        }

        // 3. Hapus byproduct non-historis. Nama kolom disesuaikan dengan schema
        // aktual: substitute_user_id, duty_schedules.user_id, recipient_user_id.
        const cleanupSteps = [
            () => admin.from('teaching_assignments').delete().eq('user_id', user_id),
            () => admin.from('schedule_templates').delete().eq('teacher_id', user_id),
            () => admin.from('substitute_schedules').delete()
                .or(`substitute_user_id.eq.${user_id},granted_by_user_id.eq.${user_id}`),
            () => admin.from('teacher_piket_assignments').delete().eq('user_id', user_id),
            () => admin.from('duty_schedules').delete()
                .or(`user_id.eq.${user_id},assigned_by_user_id.eq.${user_id}`),
            () => admin.from('tp_taught_status').delete().eq('teacher_id', user_id),
            () => admin.from('notifications').delete().eq('recipient_user_id', user_id),
            () => admin.from('student_parents').delete().eq('parent_user_id', user_id),
        ];
        for (const cleanup of cleanupSteps) {
            const { error: cleanupError } = await cleanup();
            if (cleanupError) return internalError(cleanupError);
        }

        // 4. Hard-delete public.users; tenant guard tetap eksplisit.
        const { error: deleteErr } = await admin
            .from('users')
            .delete()
            .eq('user_id', user_id)
            .eq('school_id', user.school_id)
            .limit(1);
        if (deleteErr) return internalError(deleteErr);

        // 5. Hapus Supabase Auth paling akhir.
        if (targetUser.auth_user_id) {
            const { error: authErr } = await admin.auth.admin.deleteUser(targetUser.auth_user_id);
            if (authErr && !authErr.message?.includes('not found') && !authErr.message?.includes('User not found')) {
                console.error('[delete-user] Auth delete failed:', authErr);
                return internalError(authErr);
            }
        }

        return ok({
            deleted: true,
            hard: true,
            user_id,
            full_name: targetUser.full_name,
        });

    } catch (err) {
        return internalError(err);
    }
});
