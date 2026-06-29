/**
 * @file open-academic-year/index.ts
 * @edge-function open-academic-year
 *
 * Single caller of fn_buka_tahun_ajaran() — wraps the "buka tahun ajaran
 * baru" flow (school_config update, academic_periods insert, class
 * promotion enrollments) in one atomic Postgres transaction instead of
 * the 4 sequential, non-transactional writes previously done client-side
 * in onConfirmNewYear() (admin/js/tutup-tahun.js).
 *
 * CONTRACT:
 *   POST /functions/v1/open-academic-year
 *   Body: application/json
 *     {
 *       config_id:         string (UUID, school_config.config_id),
 *       academic_year:     string (e.g. "2027/2028"),
 *       semester:          number (1 or 2),
 *       start_date:        string (date, e.g. "2027-07-01"),
 *       end_date:          string (date, e.g. "2027-12-31"),
 *       old_academic_year: string (the academic_year being closed),
 *       promotion_mapping: array<{ targetClassId, targetName, studentIds, ... }>
 *     }
 *   Caller must be authenticated as role_type = ADMINISTRATIVE.
 *
 * Delegates all writes to fn_buka_tahun_ajaran() via rpc() — this
 * function only validates input and maps it to the p_* parameters.
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
            return forbidden('Hanya akun ADMINISTRATIVE yang dapat membuka tahun ajaran baru');
        }

        // ── Parse + validate body ───────────────────────────────
        const body = await req.json().catch(() => null);
        if (!body || typeof body !== 'object') {
            return badRequest('Body request harus berupa JSON object');
        }

        const {
            config_id,
            academic_year,
            semester,
            start_date,
            end_date,
            old_academic_year,
            promotion_mapping,
        } = body;

        if (typeof config_id !== 'string' || !config_id.trim()) {
            return badRequest('Field config_id wajib diisi (string)');
        }
        if (typeof academic_year !== 'string' || !academic_year.trim()) {
            return badRequest('Field academic_year wajib diisi (string)');
        }
        if (typeof semester !== 'number' || (semester !== 1 && semester !== 2)) {
            return badRequest('Field semester wajib berupa angka 1 atau 2');
        }
        if (typeof start_date !== 'string' || !start_date.trim()) {
            return badRequest('Field start_date wajib diisi (string)');
        }
        if (typeof end_date !== 'string' || !end_date.trim()) {
            return badRequest('Field end_date wajib diisi (string)');
        }
        if (typeof old_academic_year !== 'string' || !old_academic_year.trim()) {
            return badRequest('Field old_academic_year wajib diisi (string)');
        }
        if (!Array.isArray(promotion_mapping)) {
            return badRequest('Field promotion_mapping wajib berupa array');
        }

        // ── Call fn_buka_tahun_ajaran via rpc() ──────────────────
        const { data, error: rpcError } = await admin.rpc('fn_buka_tahun_ajaran', {
            p_config_id:         config_id,
            p_academic_year:     academic_year,
            p_semester:          semester,
            p_start_date:        start_date,
            p_end_date:          end_date,
            p_old_academic_year: old_academic_year,
            p_promotion_mapping: promotion_mapping,
        });

        if (rpcError) {
            console.error('[open-academic-year] fn_buka_tahun_ajaran failed:', rpcError);
            return internalError(rpcError);
        }

        return ok(data);

    } catch (err) {
        return internalError(err);
    }
});
