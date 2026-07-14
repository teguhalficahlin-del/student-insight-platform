/**
 * @file manage-admin-account/index.ts
 * @edge-function manage-admin-account
 *
 * Tambah atau hapus akun ADMINISTRATIVE per sekolah.
 * Hanya bisa dipanggil oleh Kepala Sekolah (is_kepsek = true).
 *
 * POST   — tambah admin baru
 *   Body: { full_name, login_identifier }
 *   Return: { user_id, login_identifier, temp_password }
 *
 * DELETE — hapus akun admin
 *   Body: { user_id }
 *   Guard: tidak boleh hapus diri sendiri + harus ada min. 1 admin tersisa
 */

import { handleCors, corsHeaders } from '../_shared/cors.ts';
import { ok, badRequest, forbidden, internalError } from '../_shared/response.ts';
import { resolveAuth, isAuthError } from '../_shared/auth.ts';
import { getAdminClient } from '../_shared/db.ts';

function generatePassword(len = 12): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    const arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    return Array.from(arr, b => chars[b % chars.length]).join('');
}

/** Ubah login_identifier jadi slug aman untuk dipakai di email internal */
function toEmailSlug(s: string): string {
    return s.trim().toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')   // ganti karakter non-alfanumerik
        .replace(/_+/g, '_')            // collapse underscore berulang
        .replace(/^_|_$/g, '');         // trim underscore di awal/akhir
}

Deno.serve(async (req: Request): Promise<Response> => {

    if (req.method === 'OPTIONS') return handleCors();

    const admin = getAdminClient();
    const authResult = await resolveAuth(req, admin);
    if (isAuthError(authResult)) return authResult;
    const { user } = authResult;

    // Verifikasi caller adalah kepsek (is_kepsek flag di DB, bukan JWT claim)
    const { data: callerRow, error: callerErr } = await admin
        .from('users')
        .select('is_kepsek')
        .eq('user_id', user.user_id)
        .single();

    if (callerErr || !callerRow?.is_kepsek) {
        return forbidden('Hanya Kepala Sekolah yang dapat mengelola akun admin');
    }

    // ── POST: tambah admin baru ──────────────────────────────
    if (req.method === 'POST') {
        let body: { full_name?: string; login_identifier?: string; identifier_type?: string };
        try { body = await req.json(); }
        catch { return badRequest('Body harus JSON: { full_name, login_identifier, identifier_type }'); }

        const { full_name, login_identifier } = body;
        const identifier_type = body.identifier_type === 'NIP' ? 'NIP' : 'NIK';
        if (!full_name?.trim())        return badRequest('full_name wajib diisi');
        if (!login_identifier?.trim()) return badRequest('login_identifier wajib diisi');
        if (login_identifier.trim().length < 9) return badRequest('login_identifier minimal 9 karakter');

        // Cek duplikat login_identifier dalam sekolah yang sama
        const { data: existing } = await admin
            .from('users')
            .select('user_id')
            .eq('school_id', user.school_id)
            .eq('login_identifier', login_identifier.trim())
            .maybeSingle();

        if (existing) {
            return badRequest(`Login ID "${login_identifier}" sudah dipakai di sekolah ini`);
        }

        const tempPassword = generatePassword();
        const email = `admin_${toEmailSlug(login_identifier)}@${user.school_id}.internal`;

        // Buat Auth user
        const { data: created, error: createErr } = await admin.auth.admin.createUser({
            email,
            password:      tempPassword,
            email_confirm: true,
        });

        if (createErr) {
            console.error('[manage-admin-account] createUser gagal:', createErr);
            return internalError(createErr);
        }

        const authUserId = created.user?.id;
        if (!authUserId) return internalError(new Error('auth_user_id kosong'));

        // Insert ke tabel users
        const { data: newUser, error: insertErr } = await admin
            .from('users')
            .insert({
                auth_user_id:     authUserId,
                login_identifier: login_identifier.trim(),
                identifier_type,
                role_type:        'ADMINISTRATIVE',
                full_name:        full_name.trim(),
                email,
                school_id:        user.school_id,
            })
            .select('user_id')
            .single();

        if (insertErr) {
            // Rollback Auth user agar tidak orphan
            await admin.auth.admin.deleteUser(authUserId).catch(() => {});
            console.error('[manage-admin-account] insert users gagal:', insertErr);
            return internalError(insertErr);
        }

        return ok({ user_id: newUser.user_id, login_identifier: login_identifier.trim(), temp_password: tempPassword });
    }

    // ── DELETE: hapus admin ──────────────────────────────────
    if (req.method === 'DELETE') {
        let body: { user_id?: string };
        try { body = await req.json(); }
        catch { return badRequest('Body harus JSON: { user_id }'); }

        const { user_id } = body;
        if (!user_id) return badRequest('user_id wajib diisi');

        if (user_id === user.user_id) {
            return forbidden('Tidak dapat menghapus akun Anda sendiri');
        }

        // Ambil target — harus ADMINISTRATIVE di sekolah yang sama
        const { data: target, error: fetchErr } = await admin
            .from('users')
            .select('auth_user_id, role_type, full_name')
            .eq('user_id', user_id)
            .eq('school_id', user.school_id)
            .maybeSingle();

        if (fetchErr) return internalError(fetchErr);
        if (!target)  return badRequest('Akun tidak ditemukan di sekolah ini');
        if (target.role_type !== 'ADMINISTRATIVE') {
            return forbidden('Hanya akun ADMINISTRATIVE yang dapat dihapus dari sini');
        }

        // Pastikan masih ada minimal 1 admin aktif tersisa setelah dihapus
        const { count, error: countErr } = await admin
            .from('users')
            .select('user_id', { count: 'exact', head: true })
            .eq('school_id', user.school_id)
            .eq('role_type', 'ADMINISTRATIVE')
            .eq('is_active', true)
            .is('deleted_at', null);

        if (countErr) return internalError(countErr);
        if ((count ?? 0) <= 1) {
            return forbidden('Tidak dapat menghapus admin terakhir sekolah ini');
        }

        // Soft-delete: set deleted_at + is_active=false di DB dulu
        const { error: softDelErr } = await admin
            .from('users')
            .update({ deleted_at: new Date().toISOString(), is_active: false })
            .eq('user_id', user_id);

        if (softDelErr) return internalError(softDelErr);

        // Ban Auth account (bukan hard-delete agar bisa restore dalam 30 hari)
        if (target.auth_user_id) {
            await admin.auth.admin.updateUserById(target.auth_user_id, {
                ban_duration: '87600h', // ~10 tahun = effectively permanent
            }).catch(e => console.warn('[manage-admin-account] ban auth user gagal:', e));
        }

        return ok({ deleted: true, user_id, full_name: target.full_name });
    }

    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
});
