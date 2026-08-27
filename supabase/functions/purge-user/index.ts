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

        let body: {
            user_id?: string;
            resume_from?: { table?: string; last_id?: string | null; deleted_count?: number };
        };
        try {
            body = await req.json();
        } catch {
            return badRequest('Body harus berformat JSON: { "user_id": "<uuid>" }');
        }

        const { user_id, resume_from } = body;
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

        // Hapus byproduct impor (bukan data transaksional historis)
        const byproducts: { table: string; column: string; primaryKey: string }[] = [];
        if (targetUser.role_type === 'ORTU') {
            byproducts.push({ table: 'student_parents', column: 'parent_user_id', primaryKey: 'id' });
        }
        if (['GURU', 'WALI_KELAS'].includes(targetUser.role_type)) {
            byproducts.push(
                { table: 'teaching_assignments', column: 'user_id',    primaryKey: 'assignment_id' },
                { table: 'schedule_templates',   column: 'teacher_id', primaryKey: 'template_id' },
            );
        }

        const BATCH_SIZE = 200;
        const DEADLINE_MS = 25_000;
        const startedAt = Date.now();
        const resumeTable = resume_from?.table ?? byproducts[0]?.table ?? 'users';
        const startIndex = resumeTable === 'users'
            ? byproducts.length
            : byproducts.findIndex(bp => bp.table === resumeTable);
        if (startIndex < 0) return badRequest('resume_from.table tidak valid');

        let deleted = Number.isFinite(resume_from?.deleted_count)
            ? Math.max(0, Number(resume_from?.deleted_count))
            : 0;
        let total = deleted + 1;
        for (let i = startIndex; i < byproducts.length; i++) {
            const bp = byproducts[i];
            const { count, error: countErr } = await admin
                .from(bp.table)
                .select(bp.primaryKey, { count: 'exact', head: true })
                .eq(bp.column, user_id);
            if (countErr) return internalError(countErr);
            total += count ?? 0;
        }

        for (let i = startIndex; i < byproducts.length; i++) {
            const bp = byproducts[i];
            let lastId = i === startIndex ? (resume_from?.last_id ?? null) : null;

            while (true) {
                let selectQuery = admin
                    .from(bp.table)
                    .select(bp.primaryKey)
                    .eq(bp.column, user_id)
                    .order(bp.primaryKey, { ascending: true })
                    .limit(BATCH_SIZE);
                if (lastId) selectQuery = selectQuery.gt(bp.primaryKey, lastId);

                const { data: rows, error: selectErr } = await selectQuery;
                if (selectErr) return internalError(selectErr);
                if (!rows?.length) break;

                const ids = rows.map(row => (row as unknown as Record<string, string>)[bp.primaryKey]);
                const { error: bpErr } = await admin
                    .from(bp.table)
                    .delete()
                    .in(bp.primaryKey, ids)
                    .limit(BATCH_SIZE);
                if (bpErr) return internalError(bpErr);

                deleted += ids.length;
                lastId = ids[ids.length - 1];
                if (Date.now() - startedAt > DEADLINE_MS) {
                    return ok({
                        deleted,
                        total,
                        status: 'timeout',
                        resume_from: { table: bp.table, last_id: lastId, deleted_count: deleted },
                    });
                }
                if (ids.length < BATCH_SIZE) break;
            }
        }

        // Hard-delete baris users
        const { error: deleteErr } = await admin
            .from('users')
            .delete()
            .eq('user_id', user_id)
            .limit(1);
        if (deleteErr) return internalError(deleteErr);
        deleted += 1;

        // Auth dihapus paling akhir agar operasi yang timeout tetap dapat dilanjutkan.
        if (targetUser.auth_user_id) {
            const { error: authErr } = await admin.auth.admin.deleteUser(targetUser.auth_user_id);
            if (authErr && !authErr.message?.includes('not found') && !authErr.message?.includes('User not found')) {
                console.error('[purge-user] Auth delete failed:', authErr);
                return internalError(authErr);
            }
        }

        return ok({
            purged: true,
            user_id,
            full_name: targetUser.full_name,
            deleted,
            total,
            status: 'complete',
            resume_from: { table: 'users', last_id: user_id },
        });

    } catch (err) {
        return internalError(err);
    }
});
