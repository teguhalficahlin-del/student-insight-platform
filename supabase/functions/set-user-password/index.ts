/**
 * @file set-user-password/index.ts
 * @edge-function set-user-password
 *
 * Admin men-set password sementara untuk user lain.
 * User diminta ganti password saat login berikutnya
 * (ditandai via users.must_change_password = true).
 *
 * CONTRACT:
 *   POST /functions/v1/set-user-password
 *   Body: { "user_id": "<uuid>", "new_password": "<string>" }
 *   Caller: ADMINISTRATIVE only
 */

import { handleCors, corsHeaders }  from '../_shared/cors.ts';
import { ok, badRequest, forbidden,
         internalError,
         checkSchemaVersion }        from '../_shared/response.ts';
import { resolveAuth, isAuthError }  from '../_shared/auth.ts';
import { getAdminClient }            from '../_shared/db.ts';

const MIN_PASSWORD_LENGTH = 8;

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
            return forbidden('Hanya ADMINISTRATIVE yang dapat mereset password pengguna lain');
        }

        let body: { user_id?: string; new_password?: string };
        try { body = await req.json(); }
        catch { return badRequest('Body harus berformat JSON'); }

        const { user_id, new_password } = body;
        if (!user_id)      return badRequest('Field user_id wajib diisi');
        if (!new_password) return badRequest('Field new_password wajib diisi');
        if (new_password.length < MIN_PASSWORD_LENGTH) {
            return badRequest(`Password minimal ${MIN_PASSWORD_LENGTH} karakter`);
        }

        // Pastikan target user ada di sekolah yang sama
        const { data: targetUser, error: fetchErr } = await admin
            .from('users')
            .select('auth_user_id, full_name, school_id, role_type')
            .eq('user_id', user_id)
            .eq('school_id', user.school_id)
            .is('deleted_at', null)
            .maybeSingle();

        if (fetchErr) return internalError(fetchErr);
        if (!targetUser) {
            return badRequest(`Pengguna dengan user_id "${user_id}" tidak ditemukan di sekolah ini`);
        }
        if (targetUser.role_type === 'ADMINISTRATIVE') {
            return forbidden('Password ADMINISTRATIVE tidak bisa direset oleh admin lain');
        }
        if (!targetUser.auth_user_id) {
            return badRequest('Pengguna ini belum memiliki akun Auth. Provisi akun dulu.');
        }

        // Set password baru via Auth admin
        const { error: pwErr } = await admin.auth.admin
            .updateUserById(targetUser.auth_user_id, { password: new_password });
        if (pwErr) {
            console.error('[set-user-password] Auth update failed:', pwErr);
            return internalError(pwErr);
        }

        // Tandai harus ganti password saat login berikutnya
        await admin.from('users')
            .update({ must_change_password: true })
            .eq('user_id', user_id);

        return ok({
            reset: true,
            user_id,
            full_name: targetUser.full_name,
        });

    } catch (err) {
        return internalError(err);
    }
});
