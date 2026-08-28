/**
 * @file purge-expired-students/index.ts
 * @edge-function purge-expired-students
 *
 * Batch-aware permanent purge for retained LULUS/KELUAR students.
 */

import { handleCors, corsHeaders } from '../_shared/cors.ts';
import { ok, badRequest, forbidden, internalError, checkSchemaVersion } from '../_shared/response.ts';
import { resolveAuth, isAuthError } from '../_shared/auth.ts';
import { getAdminClient } from '../_shared/db.ts';

const BATCH_SIZE = 200;
const TIMEOUT_GUARD_MS = 25_000;

type ResumeFrom = { student_id: string; last_table: string | null; last_id: string | null };
type RequestBody = { student_ids?: string[]; resume_from?: ResumeFrom };
type PurgeRpcResult = { deleted: number; has_more: boolean; last_table: string | null; last_id: string | null };

Deno.serve(async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return handleCors();
    if (req.method !== 'DELETE') {
        return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
    }

    try {
        const versionError = checkSchemaVersion(req);
        if (versionError) return versionError;

        const admin = getAdminClient();
        const authResult = await resolveAuth(req, admin);
        if (isAuthError(authResult)) return authResult;
        const { user } = authResult;
        if (user.role_type !== 'ADMINISTRATIVE') {
            return forbidden('Hanya ADMINISTRATIVE yang dapat menghapus permanen data siswa');
        }

        let body: RequestBody;
        try {
            body = await req.json();
        } catch {
            return badRequest('Body harus JSON: { "student_ids": ["uuid",...], "resume_from"?: {...} }');
        }

        const studentIds = body.student_ids;
        if (!Array.isArray(studentIds) || studentIds.length === 0) {
            return badRequest('Field student_ids wajib diisi dan tidak boleh kosong');
        }
        if (studentIds.length > 50) return badRequest('Maksimal 50 siswa per permintaan');
        if (new Set(studentIds).size !== studentIds.length) {
            return badRequest('student_ids tidak boleh mengandung duplikat');
        }

        let studentIndex = 0;
        let lastTable: string | null = 'assessment_results';
        let lastId: string | null = null;
        if (body.resume_from) {
            studentIndex = studentIds.indexOf(body.resume_from.student_id);
            if (studentIndex < 0) return badRequest('resume_from.student_id tidak ada di student_ids');
            lastTable = body.resume_from.last_table ?? null;
            lastId = body.resume_from.last_id ?? null;
        }

        const startedAt = Date.now();
        const timedOut = () => Date.now() - startedAt > TIMEOUT_GUARD_MS;
        let deletedStudents = studentIndex;

        for (; studentIndex < studentIds.length; studentIndex++) {
            const studentId = studentIds[studentIndex];

            while (true) {
                if (timedOut()) {
                    return ok({
                        deleted: deletedStudents,
                        total: studentIds.length,
                        status: 'partial',
                        resume_from: { student_id: studentId, last_table: lastTable, last_id: lastId },
                    });
                }

                const { data, error } = await admin.rpc('fn_purge_expired_student', {
                    p_student_id: studentId,
                    p_school_id: user.school_id,
                    p_last_table: lastTable,
                    p_last_id: lastId,
                    p_batch_size: BATCH_SIZE,
                });
                if (error) throw new Error(`Gagal menghapus siswa ${studentId}: ${error.message}`);

                const result = data as PurgeRpcResult;
                lastTable = result.last_table;
                lastId = result.last_id;
                if (result.has_more) continue;

                const { data: queueRows, error: queueError } = await admin
                    .from('pending_auth_deletions')
                    .select('queue_id, auth_user_id')
                    .eq('school_id', user.school_id)
                    .eq('purge_student_id', studentId)
                    .is('processed_at', null);
                if (queueError) throw new Error(`Gagal membaca antrean Auth: ${queueError.message}`);

                for (const queueRow of queueRows ?? []) {
                    const { error: authError } = await admin.auth.admin.deleteUser(queueRow.auth_user_id);
                    if (authError && !authError.message.toLowerCase().includes('not found')) {
                        await admin.from('pending_auth_deletions')
                            .update({ last_error: authError.message })
                            .eq('queue_id', queueRow.queue_id);
                        throw new Error(`Gagal menghapus akun Auth: ${authError.message}`);
                    }
                    const { error: markError } = await admin
                        .from('pending_auth_deletions')
                        .update({ processed_at: new Date().toISOString(), last_error: null })
                        .eq('queue_id', queueRow.queue_id);
                    if (markError) throw new Error(`Gagal menandai antrean Auth: ${markError.message}`);
                }

                deletedStudents++;
                lastTable = 'assessment_results';
                lastId = null;
                break;
            }
        }

        return ok({ deleted: deletedStudents, total: studentIds.length, status: 'complete', resume_from: null });
    } catch (error) {
        return internalError(error);
    }
});
