/**
 * @file apply-schedule-templates/index.ts
 *
 * Membaca schedule_templates yang sudah tersimpan untuk periode aktif,
 * lalu men-generate teaching_schedules untuk setiap tanggal dalam
 * academic_periods yang hari-nya cocok.
 *
 * Dipanggil oleh tombol "Terapkan Jadwal" di visual schedule builder
 * setelah TU selesai menyusun dan menyimpan template.
 *
 * CONTRACT:
 *   POST /functions/v1/apply-schedule-templates
 *   Body: kosong
 *   Auth: ADMINISTRATIVE
 *
 * PROCESSING:
 *   1. Auth + otorisasi ADMINISTRATIVE
 *   2. Fetch school_config (academic_year + semester aktif)
 *   3. Fetch academic_periods untuk rentang tanggal
 *   4. Fetch semua schedule_templates pada periode ini
 *   5. Get-or-create subject default "KBM"
 *   6. Upsert teaching_assignments per template
 *   7. Generate + upsert teaching_schedules (DO NOTHING on conflict —
 *      sesi yang sudah punya absensi tidak ditimpa)
 *   8. Response: { templates_found, assignments_upserted, schedules_generated }
 */

import { handleCors, corsHeaders } from '../_shared/cors.ts';
import { ok, badRequest, forbidden, internalError, checkSchemaVersion } from '../_shared/response.ts';
import { resolveAuth, isAuthError } from '../_shared/auth.ts';
import { getAdminClient } from '../_shared/db.ts';

const DOW_BY_DAY: Record<string, number> = {
    SENIN: 1, SELASA: 2, RABU: 3, KAMIS: 4, JUMAT: 5, SABTU: 6,
};

function* eachDateInRange(startDate: string, endDate: string): Generator<{ iso: string; dow: number }> {
    const start = new Date(`${startDate}T00:00:00Z`);
    const end   = new Date(`${endDate}T00:00:00Z`);
    for (let d = start; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        yield { iso: d.toISOString().slice(0, 10), dow: d.getUTCDay() };
    }
}

async function getOrCreateDefaultSubject(admin: ReturnType<typeof getAdminClient>): Promise<string> {
    const { data: existing, error: selErr } = await admin
        .from('subjects')
        .select('subject_id')
        .eq('code', 'KBM')
        .maybeSingle();
    if (selErr) throw selErr;
    if (existing) return existing.subject_id;

    const { data: created, error: insErr } = await admin
        .from('subjects')
        .insert({ code: 'KBM', name: 'Kegiatan Belajar Mengajar', is_active: true })
        .select('subject_id')
        .single();
    if (insErr) throw insErr;
    return created.subject_id;
}

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

        // ── 2. school_config ──────────────────────────────────
        const { data: config, error: configErr } = await admin
            .from('school_config')
            .select('current_academic_year, current_semester')
            .single();

        if (configErr || !config) return internalError(configErr ?? new Error('school_config tidak ditemukan'));

        const { current_academic_year: academicYear, current_semester: semester } = config;

        // ── 3. academic_periods ───────────────────────────────
        const { data: period, error: periodErr } = await admin
            .from('academic_periods')
            .select('start_date, end_date')
            .eq('academic_year', academicYear)
            .eq('semester', semester)
            .maybeSingle();

        if (periodErr) return internalError(periodErr);
        if (!period) {
            return badRequest(
                `Periode akademik aktif (${academicYear} semester ${semester}) belum terdaftar. ` +
                `Buat periode ini terlebih dahulu.`
            );
        }

        // ── 4. schedule_templates ─────────────────────────────
        const { data: templates, error: tmplErr } = await admin
            .from('schedule_templates')
            .select('template_id, day_of_week, start_time, end_time, class_id, teacher_id')
            .eq('academic_year', academicYear)
            .eq('semester', semester);

        if (tmplErr) return internalError(tmplErr);
        if (!templates || templates.length === 0) {
            return badRequest('Belum ada template jadwal untuk periode ini. Susun jadwal terlebih dahulu.');
        }

        // ── 5. Subject default KBM ────────────────────────────
        const defaultSubjectId = await getOrCreateDefaultSubject(admin);

        // ── 6. Upsert teaching_assignments ────────────────────
        // DEDUPE: satu guru×kelas cukup satu assignment (subject KBM konstan).
        // 1330 template hanya menghasilkan ~369 pasangan (guru,kelas) unik; tanpa
        // dedup, payload berisi banyak baris dengan kunci-konflik sama sehingga
        // ON CONFLICT DO UPDATE gagal: "cannot affect row a second time" → 500.
        const assignmentByKey = new Map<string, Record<string, unknown>>();
        for (const t of templates as Array<{ teacher_id: string; class_id: string }>) {
            const key = `${t.teacher_id}|${t.class_id}`;
            if (assignmentByKey.has(key)) continue;
            assignmentByKey.set(key, {
                user_id:       t.teacher_id,
                class_id:      t.class_id,
                subject_id:    defaultSubjectId,
                academic_year: academicYear,
                semester,
                is_active:     true,
            });
        }
        const assignmentRows = [...assignmentByKey.values()];

        const { data: upsertedAssignments, error: assignErr } = await admin
            .from('teaching_assignments')
            .upsert(assignmentRows, {
                onConflict:       'user_id,class_id,subject_id,academic_year,semester',
                ignoreDuplicates: false,
            })
            .select('assignment_id, user_id, class_id');

        if (assignErr) return internalError(assignErr);

        const assignmentMap = new Map<string, string>();
        for (const a of upsertedAssignments ?? []) {
            assignmentMap.set(`${a.user_id}|${a.class_id}`, a.assignment_id);
        }

        // ── 7. Generate teaching_schedules ────────────────────
        const scheduleRows = [];
        for (const tmpl of templates as Array<{
            teacher_id: string; class_id: string;
            day_of_week: string; start_time: string; end_time: string;
        }>) {
            const targetDow    = DOW_BY_DAY[tmpl.day_of_week];
            const assignmentId = assignmentMap.get(`${tmpl.teacher_id}|${tmpl.class_id}`);
            if (!assignmentId || targetDow === undefined) continue;

            for (const { iso, dow } of eachDateInRange(period.start_date, period.end_date)) {
                if (dow !== targetDow) continue;
                scheduleRows.push({
                    assignment_id:        assignmentId,
                    class_id:             tmpl.class_id,
                    subject_id:           defaultSubjectId,
                    scheduled_teacher_id: tmpl.teacher_id,
                    session_date:         iso,
                    session_start:        tmpl.start_time.slice(0, 5),
                    session_end:          tmpl.end_time.slice(0, 5),
                    academic_year:        academicYear,
                    semester,
                    meeting_status:       'NORMAL',
                    teacher_indicator:    'PENDING_EVALUATION',
                });
            }
        }

        // Count existing schedules before upsert so we can report truly new ones
        const { count: existingCount } = await admin
            .from('teaching_schedules')
            .select('schedule_id', { count: 'exact', head: true })
            .eq('academic_year', academicYear)
            .eq('semester', semester);

        if (scheduleRows.length > 0) {
            const CHUNK = 500;
            for (let i = 0; i < scheduleRows.length; i += CHUNK) {
                const { error: genErr } = await admin
                    .from('teaching_schedules')
                    .upsert(scheduleRows.slice(i, i + CHUNK), {
                        onConflict:       'class_id,scheduled_teacher_id,session_date,session_start',
                        ignoreDuplicates: true,
                    });

                if (genErr) return internalError(genErr);
            }
        }

        const { count: finalCount } = await admin
            .from('teaching_schedules')
            .select('schedule_id', { count: 'exact', head: true })
            .eq('academic_year', academicYear)
            .eq('semester', semester);

        return ok({
            templates_found:      templates.length,
            assignments_upserted: upsertedAssignments?.length ?? 0,
            schedules_total:      scheduleRows.length,
            schedules_generated:  (finalCount ?? 0) - (existingCount ?? 0),
        });

    } catch (err) {
        return internalError(err);
    }
});
