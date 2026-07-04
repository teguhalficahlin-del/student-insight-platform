/**
 * @file apply-schedule-templates/index.ts
 *
 * Tombol "Terapkan Jadwal" di visual schedule builder: men-generate
 * teaching_schedules dari schedule_templates untuk periode aktif.
 *
 * Generasi sebenarnya dilakukan SET-BASED di DB lewat RPC
 * fn_apply_schedule_templates (lihat migrasi
 * 20260630230000_fix_apply_schedule.sql) — jauh lebih cepat & atomik
 * daripada membangun ~34k baris di klien lalu di-upsert per-chunk
 * (yang sebelumnya rawan timeout). Edge function ini hanya meng-auth
 * dan meneruskan periode aktif ke RPC.
 *
 * CONTRACT:
 *   POST /functions/v1/apply-schedule-templates
 *   Body: kosong
 *   Auth: ADMINISTRATIVE
 *   Response: { templates_found, assignments_upserted,
 *               schedules_total, schedules_generated }
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

        // Generasi set-based di DB (discope ke sekolah pemanggil).
        const { data: result, error: rpcErr } = await admin.rpc('fn_apply_schedule_templates', {
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
        });

    } catch (err) {
        return internalError(err);
    }
});
