/**
 * @file update-user-identifier/index.ts
 * @edge-function update-user-identifier
 *
 * Update login_identifier (NIP/NIK/nama_usaha) dan/atau full_name
 * untuk user yang sudah ada. Perlu edge function karena mengubah
 * login_identifier juga harus mengubah email di Auth (karena email
 * = {identifier}@{role}.internal).
 *
 * CONTRACT:
 *   PATCH /functions/v1/update-user-identifier
 *   Body: { user_id, login_identifier?, full_name?, teacher_code?, dudi_org_name? }
 *   Caller: ADMINISTRATIVE only
 */

import { handleCors, corsHeaders }  from '../_shared/cors.ts';
import { ok, badRequest, forbidden,
         internalError,
         checkSchemaVersion }        from '../_shared/response.ts';
import { resolveAuth, isAuthError }  from '../_shared/auth.ts';
import { getAdminClient }            from '../_shared/db.ts';
import { toInternalEmail, IdentifierType } from '../_shared/identifier.ts';

Deno.serve(async (req: Request): Promise<Response> => {

    if (req.method === 'OPTIONS') return handleCors();
    if (req.method !== 'PATCH') {
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
            return forbidden('Hanya ADMINISTRATIVE yang dapat mengubah data pengguna');
        }

        let body: Record<string, string | undefined>;
        try {
            body = await req.json();
        } catch {
            return badRequest('Body harus berformat JSON');
        }

        const { user_id, login_identifier, full_name, teacher_code, dudi_org_name } = body;
        if (!user_id) return badRequest('Field user_id wajib diisi');

        // Ambil user saat ini — filter school_id agar tidak bisa edit user sekolah lain
        const { data: targetUser, error: fetchErr } = await admin
            .from('users')
            .select('auth_user_id, login_identifier, identifier_type, role_type, email, school_id')
            .eq('user_id', user_id)
            .eq('school_id', user.school_id)
            .maybeSingle();

        if (fetchErr) return internalError(fetchErr);
        if (!targetUser) return badRequest('User tidak ditemukan di sekolah ini');

        // Build update patch
        const patch: Record<string, string> = {};
        if (full_name)     patch.full_name = full_name;
        if (teacher_code)  patch.teacher_code = teacher_code;
        if (dudi_org_name) patch.dudi_org_name = dudi_org_name;

        // Jika login_identifier berubah, update juga auth email
        if (login_identifier && login_identifier !== targetUser.login_identifier) {
            patch.login_identifier = login_identifier;

            // Rebuild internal email — namespace per sekolah wajib agar tidak
            // collision di Supabase Auth global (NIS/NIK sama di dua sekolah berbeda)
            const newEmail = toInternalEmail(
                login_identifier,
                targetUser.identifier_type as IdentifierType,
                targetUser.school_id,
            );
            patch.email = newEmail;

            // Update auth email
            if (targetUser.auth_user_id) {
                const { error: authErr } = await admin.auth.admin
                    .updateUserById(targetUser.auth_user_id, { email: newEmail });
                if (authErr) {
                    console.error('[update-user-identifier] auth email update failed:', authErr);
                    return internalError(authErr);
                }
            }
        }

        if (Object.keys(patch).length === 0) {
            return badRequest('Tidak ada field yang diubah');
        }

        const { error: updateErr } = await admin
            .from('users')
            .update(patch)
            .eq('user_id', user_id);

        if (updateErr) {
            console.error('[update-user-identifier] update failed:', updateErr);
            return internalError(updateErr);
        }

        return ok({ updated: true, user_id });

    } catch (err) {
        return internalError(err);
    }
});
