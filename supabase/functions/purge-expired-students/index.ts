/**
 * @file purge-expired-students/index.ts
 * @edge-function purge-expired-students
 *
 * Hapus permanen siswa LULUS/KELUAR yang sudah melewati masa retensi 6 bulan.
 * Menghapus semua data terkait (attendance, observations, cases, dll) + auth.users.
 *
 * CONTRACT:
 *   DELETE /functions/v1/purge-expired-students
 *   Body: { "student_ids": ["uuid", ...] }
 *   Caller: ADMINISTRATIVE only
 *   Response: { purged: number, results: [...] }
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
        return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
    }

    try {
        const versionError = checkSchemaVersion(req);
        if (versionError) return versionError;

        const admin      = getAdminClient();
        const authResult = await resolveAuth(req, admin);
        if (isAuthError(authResult)) return authResult;
        const { user } = authResult;

        if (user.role_type !== 'ADMINISTRATIVE') {
            return forbidden('Hanya ADMINISTRATIVE yang dapat menghapus permanen data siswa');
        }

        let body: { student_ids?: string[] };
        try { body = await req.json(); } catch {
            return badRequest('Body harus JSON: { "student_ids": ["uuid",...] }');
        }

        const { student_ids } = body;
        if (!Array.isArray(student_ids) || student_ids.length === 0) {
            return badRequest('Field student_ids wajib diisi dan tidak boleh kosong');
        }
        if (student_ids.length > 50) {
            return badRequest('Maksimal 50 siswa per permintaan');
        }

        const results = [];
        let purgedCount = 0;

        for (const student_id of student_ids) {
            try {
                const { data, error } = await admin.rpc('fn_purge_expired_student', {
                    p_student_id: student_id,
                    p_school_id:  user.school_id,
                });

                if (error) {
                    results.push({ student_id, success: false, error: error.message });
                    continue;
                }

                const r = data as {
                    student_auth_id: string | null;
                    orphan_auth_ids: string[];
                    full_name: string;
                    nis: string;
                };

                // Hapus auth.users siswa (jika punya akun)
                if (r.student_auth_id) {
                    const { error: authErr } = await admin.auth.admin.deleteUser(r.student_auth_id);
                    if (authErr && !authErr.message?.includes('not found')) {
                        console.error('[purge-expired-students] siswa auth delete failed:', authErr);
                        // Lanjutkan — baris DB sudah dihapus, auth account bisa dibersihkan manual
                    }
                }

                // Hapus auth.users ortu yatim piatu
                for (const orphanAuthId of (r.orphan_auth_ids ?? [])) {
                    const { error: orphanErr } = await admin.auth.admin.deleteUser(orphanAuthId);
                    if (orphanErr && !orphanErr.message?.includes('not found')) {
                        console.error('[purge-expired-students] orphan parent auth delete failed:', orphanErr);
                    }
                }

                results.push({ student_id, success: true, full_name: r.full_name, nis: r.nis });
                purgedCount++;

            } catch (err) {
                results.push({ student_id, success: false, error: String((err as Error).message) });
            }
        }

        return ok({ purged: purgedCount, results });

    } catch (err) {
        return internalError(err);
    }
});
