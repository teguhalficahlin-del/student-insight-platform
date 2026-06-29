/**
 * @file delete-user/index.ts
 * @edge-function delete-user
 *
 * Hapus user secara lengkap: Auth account + tabel users.
 * Dipanggil oleh admin console saat menghapus staf/guru/ortu/dudi.
 *
 * Harus lewat Edge Function (bukan REST DELETE langsung) karena
 * menghapus Auth account membutuhkan service role key yang tidak
 * boleh ada di client.
 *
 * CONTRACT:
 *   DELETE /functions/v1/delete-user
 *   Body: { "user_id": "<uuid>" }
 *   Caller: ADMINISTRATIVE only
 *
 * URUTAN HAPUS:
 *   1. Ambil auth_user_id dari tabel users
 *   2. Hapus Auth account (admin.auth.admin.deleteUser)
 *   3. Hapus baris di tabel users
 *
 * Jika Auth account tidak ditemukan (sudah dihapus sebelumnya),
 * lanjutkan hapus baris users tanpa error.
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
            return forbidden('Hanya ADMINISTRATIVE yang dapat menghapus pengguna');
        }

        // Parse body
        let body: { user_id?: string };
        try {
            body = await req.json();
        } catch {
            return badRequest('Body harus berformat JSON: { "user_id": "<uuid>" }');
        }

        const { user_id } = body;
        if (!user_id) {
            return badRequest('Field user_id wajib diisi');
        }

        // Jangan izinkan admin menghapus dirinya sendiri
        if (user_id === user.user_id) {
            return forbidden('Tidak dapat menghapus akun Anda sendiri');
        }

        // 1. Ambil auth_user_id dari tabel users
        const { data: targetUser, error: fetchErr } = await admin
            .from('users')
            .select('auth_user_id, role_type, full_name')
            .eq('user_id', user_id)
            .maybeSingle();

        if (fetchErr) {
            console.error('[delete-user] fetch user failed:', fetchErr);
            return internalError(fetchErr);
        }
        if (!targetUser) {
            return badRequest(`Pengguna dengan user_id "${user_id}" tidak ditemukan`);
        }

        // Jangan izinkan hapus ADMINISTRATIVE
        if (targetUser.role_type === 'ADMINISTRATIVE') {
            return forbidden('Akun ADMINISTRATIVE tidak dapat dihapus melalui panel ini');
        }

        // 2. Hapus Auth account
        // Jika sudah tidak ada (orphan), abaikan error
        if (targetUser.auth_user_id) {
            const { error: authDeleteErr } = await admin.auth.admin
                .deleteUser(targetUser.auth_user_id);

            if (authDeleteErr) {
                // Auth user not found = sudah terhapus, lanjutkan
                if (!authDeleteErr.message?.includes('not found') &&
                    !authDeleteErr.message?.includes('User not found')) {
                    console.error('[delete-user] Auth delete failed:', authDeleteErr);
                    return internalError(authDeleteErr);
                }
                console.warn('[delete-user] Auth user already deleted, continuing:', targetUser.auth_user_id);
            }
        }

        // 3. Hapus byproduct impor (bukan data transaksional)
        //    Data transaksional (attendance, observations, cases, dll)
        //    harus sudah kosong — dijaga oleh validasi urutan di wizard.
        const byproductDeletes: { table: string; column: string }[] = [];

        if (targetUser.role_type === 'ORTU') {
            byproductDeletes.push({ table: 'student_parents', column: 'parent_user_id' });
        }

        if (['GURU', 'WALI_KELAS'].includes(targetUser.role_type)) {
            byproductDeletes.push(
                { table: 'teaching_assignments', column: 'user_id' },
                { table: 'schedule_templates',   column: 'teacher_id' },
            );
        }

        for (const bp of byproductDeletes) {
            const { error: bpErr } = await admin
                .from(bp.table).delete().eq(bp.column, user_id);
            if (bpErr) {
                console.error(`[delete-user] ${bp.table} delete failed:`, bpErr);
                return internalError(bpErr);
            }
        }

        // 4. Hapus baris di tabel users
        const { error: deleteErr } = await admin
            .from('users')
            .delete()
            .eq('user_id', user_id);

        if (deleteErr) {
            console.error('[delete-user] users table delete failed:', deleteErr);
            return internalError(deleteErr);
        }

        return ok({
            deleted: true,
            user_id,
            full_name: targetUser.full_name,
        });

    } catch (err) {
        return internalError(err);
    }
});
