/**
 * @file delete-school/index.ts
 * @edge-function delete-school
 *
 * Hapus sekolah beserta semua datanya secara permanen.
 * Hanya bisa dipanggil oleh superadmin (X-Superadmin-Key).
 *
 * Urutan hapus:
 *   1. Ambil semua auth_user_id dari users sekolah ini
 *   2. Hapus semua Auth account satu per satu
 *   3. Hapus baris di schools (FK CASCADE hapus users + data lain)
 */

import { handleCors, corsHeaders } from '../_shared/cors.ts';
import { getAdminClient }          from '../_shared/db.ts';

function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
}

Deno.serve(async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return handleCors();
    if (req.method !== 'DELETE') {
        return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
    }

    // Autentikasi superadmin
    const superadminKey = Deno.env.get('SUPERADMIN_KEY');
    const reqKey        = req.headers.get('x-superadmin-key');
    if (!superadminKey || reqKey !== superadminKey) {
        return json({ error: 'Unauthorized' }, 401);
    }

    let body: { school_id?: string };
    try { body = await req.json(); }
    catch { return json({ error: 'Body harus JSON: { school_id }' }, 400); }

    const { school_id } = body;
    if (!school_id) return json({ error: 'school_id wajib diisi' }, 400);

    const admin = getAdminClient();

    // 1. Ambil semua auth_user_id pengguna sekolah ini
    const { data: users, error: usersErr } = await admin
        .from('users')
        .select('auth_user_id')
        .eq('school_id', school_id);

    if (usersErr) {
        console.error('[delete-school] fetch users:', usersErr);
        return json({ error: usersErr.message }, 500);
    }

    // 2. Hapus semua Auth account
    for (const u of users ?? []) {
        if (!u.auth_user_id) continue;
        const { error: authErr } = await admin.auth.admin.deleteUser(u.auth_user_id);
        if (authErr && !authErr.message?.includes('not found')) {
            console.warn('[delete-school] deleteUser partial fail:', authErr.message);
        }
    }

    // 3. Hapus baris schools — FK CASCADE di DB akan hapus:
    //    school_config, users, classes, programs, subjects, schedules,
    //    attendance, observations, cases, pkl_placements, dst.
    const { error: delErr } = await admin
        .from('schools')
        .delete()
        .eq('school_id', school_id);

    if (delErr) {
        console.error('[delete-school] delete schools:', delErr);
        return json({ error: delErr.message }, 500);
    }

    return json({ success: true, school_id });
});
