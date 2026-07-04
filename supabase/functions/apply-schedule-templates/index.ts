/**
 * @file apply-schedule-templates/index.ts
 *
 * Tombol "Terapkan Jadwal" dan "Terapkan Ulang Jadwal" di visual schedule builder.
 *
 * Mode default (tanpa ?mode):
 *   Panggil fn_apply_schedule_templates — generate sesi dari template,
 *   ON CONFLICT DO NOTHING (tidak sentuh sesi yang sudah ada).
 *   Cocok untuk awal semester.
 *
 * Mode reapply (?mode=reapply):
 *   Panggil fn_reapply_schedule_templates — hapus sesi masa depan tanpa
 *   absensi lalu generate ulang dari template terkini.
 *   Cocok setelah perubahan template mid-semester (ganti guru, ganti slot).
 *
 * CONTRACT:
 *   POST /functions/v1/apply-schedule-templates[?mode=reapply]
 *   Body: kosong
 *   Auth: ADMINISTRATIVE
 *   Response: { templates_found, assignments_upserted,
 *               schedules_total, schedules_generated, sessions_deleted? }
 */

import { handleCors, corsHeaders } from '../_shared/cors.ts';
import { ok, badRequest, forbidden, internalError, checkSchemaVersion } from '../_shared/response.ts';
import { resolveAuth, isAuthError } from '../_shared/auth.ts';
import { getAdminClient } from '../_shared/db.ts';

Deno.serve(async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return handleCors();
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
    }

    try {
        const versionError = checkSchemaVersion(req);
        if (versionError) return versionError;

        const admin      = getAdminClient();
        const authResult = await resolveAuth(req, admin);
        if (isAuthError(authResult)) return authResult;
        const { user } = authResult;

        if (user.role_type !== 'ADMINISTRATIVE') {
            return forbidden('Hanya akun ADMINISTRATIVE yang dapat menerapkan jadwal');
        }

        const url      = new URL(req.url);
        const isReapply = url.searchParams.get('mode') === 'reapply';

        // Periode aktif: academic_year dari fn_current_academic_year (SSoT),
        // semester dari school_config.
        const { data: config, error: configErr } = await admin
            .from('school_config')
            .select('current_academic_year, current_semester')
            .eq('school_id', user.school_id)
            .maybeSingle();

        if (configErr || !config) {
            return internalError(configErr ?? new Error('school_config tidak ditemukan'));
        }

        const { data: authYear } = await admin.rpc('fn_current_academic_year', { p_school_id: user.school_id });
        const academicYear = (authYear as string) || config.current_academic_year;
        const semester     = config.current_semester;

        const rpcName = isReapply ? 'fn_reapply_schedule_templates' : 'fn_apply_schedule_templates';
        const { data: result, error: rpcErr } = await admin.rpc(rpcName, {
            p_academic_year: academicYear,
            p_semester:      semester,
            p_school_id:     user.school_id,
        });

        if (rpcErr) return internalError(rpcErr);

        if (!result || result.templates_found === 0) {
            return badRequest('Belum ada template jadwal untuk periode ini. Susun jadwal terlebih dahulu.');
        }

        return ok({
            templates_found:      result.templates_found,
            assignments_upserted: result.assignments_upserted,
            schedules_total:      result.schedules_generated,
            schedules_generated:  result.schedules_generated,
            ...(isReapply && { sessions_deleted: result.sessions_deleted }),
        });

    } catch (err) {
        return internalError(err);
    }
});
