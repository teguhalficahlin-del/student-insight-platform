/**
 * @file restore-user/index.ts
 * @edge-function restore-user
 *
 * Pulihkan user yang dihapus sementara (soft-delete):
 *   - Unban Auth account
 *   - Hapus deleted_at
 *   - Set is_active = true
 *
 * CONTRACT:
 *   POST /functions/v1/restore-user
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
    if (req.method !== 'POST') {
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
            return forbidden('Hanya ADMINISTRATIVE yang dapat memulihkan pengguna');
        }

        let body: { user_id?: string };
        try {
            body = await req.json();
        } catch {
            return badRequest('Body harus berformat JSON: { "user_id": "<uuid>" }');
        }

        const { user_id } = body;
        if (!user_id) return badRequest('Field user_id wajib diisi');

        // Ambil target — pastikan sekolah sama dan memang soft-deleted
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
            return badRequest('Pengguna ini tidak dalam status terhapus sementara.');
        }

        // Cek batas 30 hari
        const deletedAt  = new Date(targetUser.deleted_at);
        const daysSince  = (Date.now() - deletedAt.getTime()) / 86_400_000;
        if (daysSince > 30) {
            return badRequest(
                `Tidak bisa dipulihkan — sudah lebih dari 30 hari sejak dihapus (${Math.floor(daysSince)} hari).`
            );
        }

        // Unban Auth account
        if (targetUser.auth_user_id) {
            const { error: unbanErr } = await admin.auth.admin
                .updateUserById(targetUser.auth_user_id, { ban_duration: 'none' });
            if (unbanErr) {
                if (!unbanErr.message?.includes('not found') && !unbanErr.message?.includes('User not found')) {
                    console.error('[restore-user] Auth unban failed:', unbanErr);
                    return internalError(unbanErr);
                }
                console.warn('[restore-user] Auth user not found, skipping unban');
            }
        }

        // Pulihkan baris user
        const { error: updateErr } = await admin
            .from('users')
            .update({ deleted_at: null, is_active: true })
            .eq('user_id', user_id);

        if (updateErr) return internalError(updateErr);

        return ok({
            restored: true,
            user_id,
            full_name: targetUser.full_name,
        });

    } catch (err) {
        return internalError(err);
    }
});
