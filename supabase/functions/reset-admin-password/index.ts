/**
 * @file reset-admin-password/index.ts
 *
 * Mereset password akun ADMINISTRATIVE sebuah sekolah.
 * Hanya bisa dipanggil superadmin via X-Superadmin-Key.
 *
 * Deploy:
 *   supabase functions deploy reset-admin-password --no-verify-jwt
 *
 * Request body: { school_id: string }
 *
 * Response: { admin_identifier, admin_password, admin_name }
 */

import { handleCors, corsHeaders } from '../_shared/cors.ts';
import { internalError }           from '../_shared/response.ts';
import { getAdminClient }          from '../_shared/db.ts';

function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}

function randomPassword(len = 12): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#';
    return Array.from(crypto.getRandomValues(new Uint8Array(len)))
        .map(b => chars[b % chars.length]).join('');
}

Deno.serve(async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return handleCors();

    const superadminKey = Deno.env.get('SUPERADMIN_KEY');
    const reqKey        = req.headers.get('x-superadmin-key');
    if (!superadminKey || reqKey !== superadminKey) {
        return json({ error: 'Unauthorized' }, 401);
    }

    try {
        const { school_id } = await req.json();
        if (!school_id) return json({ error: 'school_id wajib diisi' }, 400);

        const admin = getAdminClient();

        // 1. Cari akun ADMINISTRATIVE milik sekolah ini
        const { data: user, error: userErr } = await admin
            .from('users')
            .select('auth_user_id, login_identifier, full_name')
            .eq('school_id', school_id)
            .eq('role_type', 'ADMINISTRATIVE')
            .eq('is_active', true)
            .maybeSingle();

        if (userErr) throw userErr;
        if (!user) return json({ error: 'Akun admin tidak ditemukan untuk sekolah ini' }, 404);

        // 2. Generate password baru & update via Auth Admin API
        const newPassword = randomPassword();
        const { error: updateErr } = await admin.auth.admin.updateUserById(
            user.auth_user_id,
            { password: newPassword },
        );
        if (updateErr) throw updateErr;

        // 3. Set must_change_password supaya admin wajib ganti saat login berikutnya
        await admin
            .from('users')
            .update({ must_change_password: true })
            .eq('auth_user_id', user.auth_user_id);

        return json({
            success:          true,
            admin_name:       user.full_name,
            admin_identifier: user.login_identifier,
            admin_password:   newPassword,
            note:             'Simpan password ini — tidak bisa dilihat lagi.',
        });

    } catch (err) {
        return internalError(err);
    }
});
