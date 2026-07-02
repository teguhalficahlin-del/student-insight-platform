/**
 * @file cancel-academic-year/index.ts
 * @edge-function cancel-academic-year
 *
 * Membatalkan "buka tahun ajaran" TERAKHIR (kemungkinan_buruk.md 4.3):
 * mengembalikan school_config, menghapus periode + enrollment tahun baru,
 * dan memulihkan enrollment tahun lama untuk siswa yang naik kelas.
 * Delegasi penuh ke fn_batalkan_tahun_ajaran() (satu transaksi Postgres).
 *
 * POST Body: { config_id }
 * Caller wajib role_type = ADMINISTRATIVE.
 */

import { handleCors, corsHeaders }            from '../_shared/cors.ts';
import { ok, badRequest, forbidden, internalError } from '../_shared/response.ts';
import { resolveAuth, isAuthError }           from '../_shared/auth.ts';
import { getAdminClient }                     from '../_shared/db.ts';

Deno.serve(async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return handleCors();
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
    }

    try {
        const admin      = getAdminClient();
        const authResult = await resolveAuth(req, admin);
        if (isAuthError(authResult)) return authResult;
        const { user } = authResult;

        if (user.role_type !== 'ADMINISTRATIVE') {
            return forbidden('Hanya akun ADMINISTRATIVE yang dapat membatalkan tahun ajaran');
        }

        const body = await req.json().catch(() => null);
        const config_id = body?.config_id;
        if (typeof config_id !== 'string' || !config_id.trim()) {
            return badRequest('Field config_id wajib diisi (string)');
        }

        const { data, error } = await admin.rpc('fn_batalkan_tahun_ajaran', { p_config_id: config_id });
        if (error) {
            console.error('[cancel-academic-year] fn_batalkan_tahun_ajaran failed:', error);
            return internalError(error);
        }

        return ok(data);
    } catch (err) {
        return internalError(err);
    }
});
