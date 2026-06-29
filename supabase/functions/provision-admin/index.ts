/**
 * @file provision-admin/index.ts
 * @edge-function provision-admin
 *
 * Membuat akun ADMINISTRATIVE default saat deployment ke sekolah baru.
 * Dipanggil SEKALI oleh vendor via:
 *   supabase functions invoke provision-admin --project-ref xovvuuwexoweoqyltepq
 *
 * Deploy dengan:
 *   supabase functions deploy provision-admin --no-verify-jwt
 *
 * IDEMPOTENT: aman dipanggil berulang.
 * KREDENSIAL DEFAULT: Admin / Admin1234 — wajib diganti setelah login pertama.
 */

import { handleCors, corsHeaders } from '../_shared/cors.ts';
import { internalError }           from '../_shared/response.ts';
import { getAdminClient }          from '../_shared/db.ts';

const ADMIN_EMAIL      = 'Admin@staff.internal';
const ADMIN_PASSWORD   = 'Admin1234';
const ADMIN_IDENTIFIER = 'Admin';

function success(message: string): Response {
    return new Response(
        JSON.stringify({ success: true, message }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
}

Deno.serve(async (req: Request): Promise<Response> => {

    if (req.method === 'OPTIONS') return handleCors();

    try {
        const admin = getAdminClient();

        // 1. Idempotency: cek baris users sudah ada
        const { data: existing, error: existingErr } = await admin
            .from('users')
            .select('user_id')
            .eq('login_identifier', ADMIN_IDENTIFIER)
            .maybeSingle();

        if (existingErr) {
            console.error('[provision-admin] cek existing gagal:', existingErr);
            return internalError(existingErr);
        }
        if (existing) {
            return success('Akun admin sudah ada');
        }

        // 2. Buat Auth user
        let authUserId: string | null = null;

        const { data: created, error: createErr } = await admin.auth.admin.createUser({
            email:         ADMIN_EMAIL,
            password:      ADMIN_PASSWORD,
            email_confirm: true,
        });

        if (createErr) {
            // Partial provision: Auth user ada tapi baris users belum dibuat
            const alreadyExists =
                createErr.message?.toLowerCase().includes('already') ||
                createErr.message?.toLowerCase().includes('registered');

            if (!alreadyExists) {
                console.error('[provision-admin] createUser gagal:', createErr);
                return internalError(createErr);
            }

            const { data: list, error: listErr } = await admin.auth.admin.listUsers();

            if (listErr) {
                console.error('[provision-admin] listUsers gagal:', listErr);
                return internalError(listErr);
            }

            const found = list?.users?.find(
                (u) => u.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase(),
            ) ?? null;
            if (!found) {
                console.error('[provision-admin] Auth user tidak ditemukan setelah konflik');
                return internalError(createErr);
            }
            authUserId = found.id;

        } else {
            authUserId = created.user?.id ?? null;
        }

        if (!authUserId) {
            console.error('[provision-admin] auth_user_id kosong');
            return internalError(new Error('auth_user_id tidak tersedia'));
        }

        // 3. INSERT baris public.users
        const { error: insertErr } = await admin
            .from('users')
            .insert({
                auth_user_id:     authUserId,
                login_identifier: ADMIN_IDENTIFIER,
                identifier_type:  'NIK',
                role_type:        'ADMINISTRATIVE',
                full_name:        'Administrator',
                email:            ADMIN_EMAIL,
            });

        if (insertErr) {
            // 23505 = unique_violation dari race condition — idempoten
            if ((insertErr as { code?: string }).code === '23505') {
                return success('Akun admin sudah ada');
            }
            console.error('[provision-admin] insert users gagal:', insertErr);
            return internalError(insertErr);
        }

        return success('Akun admin berhasil dibuat');

    } catch (err) {
        return internalError(err);
    }
});
