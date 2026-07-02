/**
 * @file purge-user/index.ts
 * @edge-function purge-user
 *
 * Hard-delete permanen user yang sudah di-soft-delete.
 * Menghapus Auth account + baris users + byproduct impor.
 * Data historis (attendance, observations, cases) TIDAK dihapus.
 *
 * Hanya bisa dipanggil pada user dengan deleted_at NOT NULL.
 *
 * CONTRACT:
 *   DELETE /functions/v1/purge-user
 *   Body: { "user_id": "<uuid>" }
 *   Caller: ADMINISTRATIVE only
 */

import { handleCors, corsHeaders }  from '../_shared/cors.ts';
import { ok, badRequest, forbidden,
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
            return forbidden('Hanya ADMINISTRATIVE yang dapat menghapus permanen pengguna');
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
        if (!targetUser.deleted_at) {
            return badRequest('Pengguna ini harus di-soft-delete dulu sebelum bisa dipurge.');
        }
        if (targetUser.role_type === 'ADMINISTRATIVE') {
            return forbidden('Akun ADMINISTRATIVE tidak dapat dihapus permanen melalui panel ini');
        }

        // Hapus Auth account
        if (targetUser.auth_user_id) {
            const { error: authErr } = await admin.auth.admin.deleteUser(targetUser.auth_user_id);
            if (authErr) {
                if (!authErr.message?.includes('not found') && !authErr.message?.includes('User not found')) {
                    console.error('[purge-user] Auth delete failed:', authErr);
                    return internalError(authErr);
                }
            }
        }

        // Hapus byproduct impor (bukan data transaksional historis)
        const byproducts: { table: string; column: string }[] = [];
        if (targetUser.role_type === 'ORTU') {
            byproducts.push({ table: 'student_parents', column: 'parent_user_id' });
        }
        if (['GURU', 'WALI_KELAS'].includes(targetUser.role_type)) {
            byproducts.push(
                { table: 'teaching_assignments', column: 'user_id' },
                { table: 'schedule_templates',   column: 'teacher_id' },
            );
        }
        for (const bp of byproducts) {
            const { error: bpErr } = await admin.from(bp.table).delete().eq(bp.column, user_id);
            if (bpErr) return internalError(bpErr);
        }

        // Hard-delete baris users
        const { error: deleteErr } = await admin.from('users').delete().eq('user_id', user_id);
        if (deleteErr) return internalError(deleteErr);

        return ok({ purged: true, user_id, full_name: targetUser.full_name });

    } catch (err) {
        return internalError(err);
    }
});
