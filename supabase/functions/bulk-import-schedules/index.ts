/**
 * @file bulk-import-schedules/index.ts
 * @edge-function bulk-import-schedules
 * @version 3.0.0
 *
 * Bulk-creates recurring weekly schedule_templates rows from a CSV
 * file, then expands each template into concrete teaching_schedules
 * rows for every date within the active academic_periods range that
 * matches the template's day_of_week.
 *
 * Re-importing the same (academic_year, semester, day_of_week,
 * start_time, class_id, teacher_id) updates that template's end_time
 * instead of creating a duplicate template.
 *
 * CONTRACT:
 *   POST /functions/v1/bulk-import-schedules
 *   Body: text/csv (raw CSV text), columns:
 *     nama_guru, nama_kelas, hari, start_time, end_time
 *   Guru diidentifikasi dari nama (users.full_name). Mata pelajaran tidak
 *   diminta — semua sesi memakai subject default "KBM" (dibuat otomatis),
 *   karena platform memantau KEHADIRAN guru, bukan mapel. 1 guru tidak
 *   boleh mengajar di kelas berbeda pada waktu yang tumpang-tindih.
 *   academic_year and semester are NOT read from the CSV — they come
 *   from school_config.current_academic_year / current_semester.
 *   Date range for generation comes from the matching academic_periods row.
 *   Caller must be authenticated as role_type = ADMINISTRATIVE.
 *
 * PROCESSING SEQUENCE:
 *   1.  CORS preflight
 *   2.  Schema version check
 *   3.  Auth: verify JWT + resolve user row
 *   4.  Authorization: caller must be ADMINISTRATIVE
 *   5.  Fetch school_config (active academic_year + semester)
 *   6.  Fetch academic_periods for that period (need start_date/end_date
 *       to generate dates) — error if not found
 *   7.  Parse CSV body
 *   8.  Validate each row (hari valid, start_time < end_time,
 *       nama_guru/nama_kelas present)
 *   9.  Resolve nama_kelas -> class_id (classes.name + academic_year),
 *       nama_guru -> teacher_id (users.full_name; tolak bila nama ganda),
 *       subject_id -> default "KBM" (get-or-create)
 *   9b. Deteksi bentrok: 1 guru tak boleh mengajar di kelas berbeda pada
 *       hari & jam yang tumpang-tindih (cek antar baris + vs DB)
 *  10.  Upsert schedule_templates via native ON CONFLICT on
 *       (academic_year, semester, day_of_week, start_time, class_id,
 *       teacher_id) — backed by uq_schedule_template_slot UNIQUE
 *       constraint (migration 20250624000001_schedule_templates_unique.sql).
 *  10b. Upsert teaching_assignments per resolved row
 *       (user_id, class_id, subject_id, academic_year, semester) via
 *       ON CONFLICT on uq_assignment (contracts/01_reference_identity_org.sql:306).
 *       Result is used to populate assignment_id in step 11.
 *  11.  Generate teaching_schedules: for each resolved template, loop every
 *       date in the academic_periods range whose day-of-week matches,
 *       insert with ON CONFLICT (class_id, scheduled_teacher_id,
 *       session_date, session_start) DO NOTHING — assignment_id and
 *       subject_id are now populated from the schedule_templates row
 *       and the teaching_assignments upserted in step 10b.
 *       Intentionally DO NOTHING (not DO UPDATE): a teaching_schedules
 *       row that already exists may have progressed past
 *       PENDING_EVALUATION (attendance/journal recorded) — blindly
 *       resetting meeting_status/teacher_indicator on re-import would
 *       silently destroy that operational state.
 *  12.  Response: { total_templates, templates_updated,
 *       assignments_upserted, schedules_generated, failed, errors[] }
 *
 * NOTE: date generation happens here in application code (a loop over
 * Date objects), not in the database — per design decision to keep
 * calendar logic in JS where it's easier to test and reason about.
 */

import { handleCors, corsHeaders }     from '../_shared/cors.ts';
import { ok, badRequest,
         forbidden, internalError,
         checkSchemaVersion }          from '../_shared/response.ts';
import { resolveAuth, isAuthError }    from '../_shared/auth.ts';
import { getAdminClient }              from '../_shared/db.ts';
import { parseCsv }                    from '../_shared/csv.ts';

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

interface ImportRow {
    rowNumber:   number;
    hari:        string;
    start_time:  string;
    end_time:    string;
    nama_kelas:  string;
    nama_guru:   string;
    class_id?:   string;
    teacher_id?: string;
    subject_id?: string;
}

interface ImportError {
    row:     number;
    message: string;
    code?:   string;
}

const VALID_DAYS = ['SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU'] as const;

// Postgres EXTRACT(DOW FROM date): 0=Minggu..6=Sabtu — same convention
// as JS Date#getUTCDay(), so this map lines up with both directly.
const DOW_BY_DAY: Record<string, number> = {
    SENIN: 1, SELASA: 2, RABU: 3, KAMIS: 4, JUMAT: 5, SABTU: 6,
};

/**
 * Parse "HH:MM" → total menit sejak tengah malam.
 * Return -1 jika format tidak valid.
 */
function parseTimeMinutes(t: string): number {
    const match = t.match(/^(\d{2}):(\d{2})$/);
    if (!match) return -1;
    const h = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    if (h > 23 || m > 59) return -1;
    return h * 60 + m;
}

function* eachDateInRange(startDate: string, endDate: string): Generator<{ iso: string; dow: number }> {
    const start = new Date(`${startDate}T00:00:00Z`);
    const end   = new Date(`${endDate}T00:00:00Z`);
    for (let d = start; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        yield { iso: d.toISOString().slice(0, 10), dow: d.getUTCDay() };
    }
}

/** Dua interval [aS,aE) dan [bS,bE) (menit) tumpang-tindih? */
function overlaps(aS: number, aE: number, bS: number, bE: number): boolean {
    return aS < bE && bS < aE;
}

/** Ambil (atau buat) subject default "KBM" yang dipakai semua sesi jadwal.
 *  teaching_assignments.subject_id NOT NULL, jadi tetap butuh satu subject;
 *  "KBM" disembunyikan dari TU (tidak ada di template jadwal). */
async function getOrCreateDefaultSubject(admin: ReturnType<typeof getAdminClient>, schoolId: string): Promise<string> {
    const { data: existing, error: selErr } = await admin
        .from('subjects')
        .select('subject_id')
        .eq('school_id', schoolId)
        .eq('code', 'KBM')
        .maybeSingle();
    if (selErr) throw selErr;
    if (existing) return existing.subject_id;

    const { data: created, error: insErr } = await admin
        .from('subjects')
        .insert({ code: 'KBM', name: 'Kegiatan Belajar Mengajar', is_active: true, school_id: schoolId })
        .select('subject_id')
        .single();
    if (insErr) throw insErr;
    return created.subject_id;
}

// ─────────────────────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────────────────────

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
            return forbidden('Hanya akun ADMINISTRATIVE yang dapat melakukan impor jadwal massal');
        }

        // ── 5. Fetch school_config (active academic_year + semester) ──
        const { data: schoolConfig, error: configErr } = await admin
            .from('school_config')
            .select('current_academic_year, current_semester')
            .eq('school_id', user.school_id)
            .maybeSingle();

        if (configErr || !schoolConfig) {
            console.error('[bulk-import-schedules] school_config lookup failed:', configErr);
            return internalError(configErr ?? new Error('school_config tidak ditemukan'));
        }

        const academicYear = schoolConfig.current_academic_year;
        const semester      = schoolConfig.current_semester;

        // ── 6. Fetch academic_periods for the active period ───────
        const { data: period, error: periodErr } = await admin
            .from('academic_periods')
            .select('start_date, end_date')
            .eq('school_id', user.school_id)
            .eq('academic_year', academicYear)
            .eq('semester', semester)
            .maybeSingle();

        if (periodErr) {
            console.error('[bulk-import-schedules] academic_periods lookup failed:', periodErr);
            return internalError(periodErr);
        }
        if (!period) {
            return badRequest(
                `Periode akademik aktif (${academicYear} semester ${semester}) belum terdaftar di ` +
                `academic_periods. Buat periode ini terlebih dahulu sebelum mengimpor jadwal.`,
            );
        }

        // ── 7. Parse CSV body ──────────────────────────────────
        const csvText = await req.text();
        if (!csvText || !csvText.trim()) {
            return badRequest('Body request kosong. Kirim file CSV sebagai teks mentah.');
        }

        const rawRows = parseCsv(csvText);
        if (rawRows.length === 0) {
            return badRequest('CSV tidak berisi baris data');
        }

        const rows: ImportRow[] = rawRows.map((r, i) => ({
            rowNumber:  i + 2,
            hari:       (r.hari ?? '').toUpperCase(),
            start_time: r.start_time ?? '',
            end_time:   r.end_time ?? '',
            nama_kelas: r.nama_kelas ?? '',
            nama_guru:  r.nama_guru ?? '',
        }));

        // ── 8. Structural validation ────────────────────────────
        const errors: ImportError[] = [];
        const validRows: ImportRow[] = [];

        for (const row of rows) {
            if (!VALID_DAYS.includes(row.hari as typeof VALID_DAYS[number])) {
                errors.push({ row: row.rowNumber, message: `hari tidak valid: "${row.hari}". Harus salah satu dari [${VALID_DAYS.join(', ')}]` });
                continue;
            }
            const startMin = parseTimeMinutes(row.start_time);
            const endMin   = parseTimeMinutes(row.end_time);
            if (startMin === -1) {
                errors.push({ row: row.rowNumber, message: `Format start_time tidak valid: "${row.start_time}". Gunakan format HH:MM, contoh: 07:00` });
                continue;
            }
            if (endMin === -1) {
                errors.push({ row: row.rowNumber, message: `Format end_time tidak valid: "${row.end_time}". Gunakan format HH:MM, contoh: 08:30` });
                continue;
            }
            if (startMin >= endMin) {
                errors.push({ row: row.rowNumber, message: `start_time (${row.start_time}) harus lebih kecil dari end_time (${row.end_time})` });
                continue;
            }
            if (!row.nama_kelas.trim() || !row.nama_guru.trim()) {
                errors.push({ row: row.rowNumber, message: 'Kolom nama_guru dan nama_kelas wajib diisi' });
                continue;
            }
            validRows.push(row);
        }

        // ── 9. Resolve nama_kelas -> class_id, nama_guru -> teacher_id,
        //       subject = default "KBM" ─────────────────────────────
        if (validRows.length > 0) {
            const classNames = [...new Set(validRows.map(r => r.nama_kelas.trim()))];

            const [{ data: classes, error: classErr }, { data: teachers, error: teacherErr }] = await Promise.all([
                admin.from('classes').select('class_id, name').eq('school_id', user.school_id).eq('academic_year', academicYear).in('name', classNames),
                admin.from('users').select('user_id, full_name')
                    .eq('school_id', user.school_id)
                    .in('role_type', ['GURU', 'WALI_KELAS', 'KAPRODI', 'KEPSEK', 'BK']),
            ]);

            if (classErr) { console.error('[bulk-import-schedules] class lookup failed:', classErr); return internalError(classErr); }
            if (teacherErr) { console.error('[bulk-import-schedules] teacher lookup failed:', teacherErr); return internalError(teacherErr); }

            const classMap = new Map((classes ?? []).map((c: { class_id: string; name: string }) => [c.name, c.class_id]));

            // Nama (uppercase + trim) -> daftar user_id, untuk deteksi nama ganda.
            const teacherByName = new Map<string, string[]>();
            for (const t of (teachers ?? []) as { user_id: string; full_name: string }[]) {
                const key = t.full_name.trim().toUpperCase();
                const arr = teacherByName.get(key) ?? [];
                arr.push(t.user_id);
                teacherByName.set(key, arr);
            }

            const defaultSubjectId = await getOrCreateDefaultSubject(admin, user.school_id);

            for (const row of [...validRows]) {
                const classId = classMap.get(row.nama_kelas.trim());
                if (!classId) {
                    errors.push({ row: row.rowNumber, message: `Kelas "${row.nama_kelas}" tahun ajaran ${academicYear} tidak ditemukan` });
                    validRows.splice(validRows.indexOf(row), 1);
                    continue;
                }
                const matches = teacherByName.get(row.nama_guru.trim().toUpperCase());
                if (!matches || matches.length === 0) {
                    errors.push({ row: row.rowNumber, message: `Guru bernama "${row.nama_guru}" tidak ditemukan` });
                    validRows.splice(validRows.indexOf(row), 1);
                    continue;
                }
                if (matches.length > 1) {
                    errors.push({ row: row.rowNumber, message: `Nama guru "${row.nama_guru}" ganda (${matches.length} akun). Bedakan namanya agar unik.`, code: 'AMBIGUOUS_TEACHER' });
                    validRows.splice(validRows.indexOf(row), 1);
                    continue;
                }
                row.class_id   = classId;
                row.teacher_id = matches[0];
                row.subject_id = defaultSubjectId;
            }
        }

        // ── 9b. Deteksi bentrok: 1 guru tidak boleh mengajar di kelas
        //        berbeda pada hari & waktu yang tumpang-tindih ────────
        if (validRows.length > 0) {
            // (i) Bentrok antar baris dalam file yang sama
            const byTeacherDay = new Map<string, ImportRow[]>();
            for (const row of validRows) {
                const key = `${row.teacher_id}|${row.hari}`;
                const arr = byTeacherDay.get(key) ?? [];
                arr.push(row);
                byTeacherDay.set(key, arr);
            }
            const conflicted = new Set<ImportRow>();
            for (const group of byTeacherDay.values()) {
                group.sort((a, b) => parseTimeMinutes(a.start_time) - parseTimeMinutes(b.start_time));
                for (let i = 0; i < group.length; i++) {
                    for (let j = i + 1; j < group.length; j++) {
                        const a = group[i], b = group[j];
                        if (conflicted.has(b)) continue;
                        if (a.class_id !== b.class_id &&
                            overlaps(parseTimeMinutes(a.start_time), parseTimeMinutes(a.end_time),
                                     parseTimeMinutes(b.start_time), parseTimeMinutes(b.end_time))) {
                            conflicted.add(b); // baris yang belakangan ditolak
                            errors.push({ row: b.rowNumber, message: `Bentrok: ${b.nama_guru} sudah dijadwalkan di kelas lain pada ${b.hari} ${a.start_time}-${a.end_time} (baris ${a.rowNumber})`, code: 'SCHEDULE_CONFLICT' });
                        }
                    }
                }
            }
            for (const row of conflicted) validRows.splice(validRows.indexOf(row), 1);

            // (ii) Bentrok dengan jadwal yang sudah tersimpan di DB
            for (const row of [...validRows]) {
                const { data: existing, error: exErr } = await admin
                    .from('schedule_templates')
                    .select('start_time, end_time, class_id')
                    .eq('school_id', user.school_id)
                    .eq('academic_year', academicYear)
                    .eq('semester', semester)
                    .eq('day_of_week', row.hari)
                    .eq('teacher_id', row.teacher_id);
                if (exErr) { console.error('[bulk-import-schedules] conflict check failed:', exErr); return internalError(exErr); }

                const rS = parseTimeMinutes(row.start_time), rE = parseTimeMinutes(row.end_time);
                const clash = (existing ?? []).find((e: { start_time: string; end_time: string; class_id: string }) =>
                    e.class_id !== row.class_id &&
                    overlaps(rS, rE, parseTimeMinutes(e.start_time.slice(0, 5)), parseTimeMinutes(e.end_time.slice(0, 5))),
                );
                if (clash) {
                    errors.push({ row: row.rowNumber, message: `Bentrok dengan jadwal tersimpan: ${row.nama_guru} sudah mengajar di kelas lain pada ${row.hari} ${clash.start_time.slice(0, 5)}-${clash.end_time.slice(0, 5)}`, code: 'SCHEDULE_CONFLICT' });
                    validRows.splice(validRows.indexOf(row), 1);
                }
            }
        }

        // ── 10. Upsert schedule_templates via native ON CONFLICT on
        //       (academic_year, semester, day_of_week, start_time,
        //       class_id, teacher_id) — backed by uq_schedule_template_slot
        //       UNIQUE constraint (migration
        //       20250624000001_schedule_templates_unique.sql) ───────────
        let totalTemplates   = 0;
        let templatesUpdated = 0;
        const resolvedRows: ImportRow[] = [];

        for (const row of validRows) {
            // Upsert via ON CONFLICT — replaces select-then-branch.
            // Requires uq_schedule_template_slot UNIQUE constraint
            // (migration 20250624000001_schedule_templates_unique.sql).
            const { error: upsertErr } = await admin
                .from('schedule_templates')
                .upsert(
                    {
                        academic_year: academicYear,
                        semester:      semester,
                        day_of_week:   row.hari,
                        start_time:    row.start_time,
                        end_time:      row.end_time,
                        class_id:      row.class_id,
                        teacher_id:    row.teacher_id,
                        subject_id:    row.subject_id,
                    },
                    {
                        onConflict:       'academic_year,semester,day_of_week,start_time,class_id,teacher_id',
                        ignoreDuplicates: false,
                    }
                );

            if (upsertErr) {
                errors.push({
                    row:     row.rowNumber,
                    message: `Gagal menyimpan jadwal template: ${upsertErr.message}`,
                });
                continue;
            }

            resolvedRows.push(row);
        }
        totalTemplates   = resolvedRows.length;
        // upsert tidak membedakan insert vs update — semua baris yang
        // berhasil disimpan dihitung sebagai "templates_updated"
        templatesUpdated = resolvedRows.length;

        // ── 10b. Upsert teaching_assignments per resolved row ────
        let assignmentsUpserted = 0;
        const assignmentMap = new Map<string, string>(); // key: teacherId|classId|subjectId -> assignment_id

        if (resolvedRows.length > 0) {
            const assignmentRows = resolvedRows.map(row => ({
                user_id:       row.teacher_id,
                class_id:      row.class_id,
                subject_id:    row.subject_id,
                academic_year: academicYear,
                semester:      semester,
                is_active:     true,
            }));

            const { data: upsertedAssignments, error: assignErr } = await admin
                .from('teaching_assignments')
                .upsert(assignmentRows, {
                    onConflict:       'user_id,class_id,subject_id,academic_year,semester',
                    ignoreDuplicates: false,
                })
                .select('assignment_id, user_id, class_id, subject_id');

            if (assignErr) {
                console.error('[bulk-import-schedules] teaching_assignments upsert failed:', assignErr);
                return internalError(assignErr);
            }

            for (const a of upsertedAssignments ?? []) {
                assignmentMap.set(`${a.user_id}|${a.class_id}|${a.subject_id}`, a.assignment_id);
            }
            assignmentsUpserted = upsertedAssignments?.length ?? 0;
        }

        // ── 11. Generate teaching_schedules from templates ──────
        let schedulesGenerated = 0;
        if (resolvedRows.length > 0) {
            const generatedRows = [];
            for (const row of resolvedRows) {
                const targetDow = DOW_BY_DAY[row.hari];
                const assignmentId = assignmentMap.get(`${row.teacher_id}|${row.class_id}|${row.subject_id}`);
                if (!assignmentId) {
                    console.warn(`[bulk-import-schedules] assignment_id tidak ditemukan untuk row ${row.rowNumber} (teacher=${row.teacher_id}, class=${row.class_id}, subject=${row.subject_id}) — baris dilewati`);
                    continue;
                }
                for (const { iso, dow } of eachDateInRange(period.start_date, period.end_date)) {
                    if (dow !== targetDow) continue;
                    generatedRows.push({
                        assignment_id:        assignmentId,
                        class_id:             row.class_id,
                        subject_id:           row.subject_id,
                        scheduled_teacher_id: row.teacher_id,
                        session_date:         iso,
                        session_start:        row.start_time,
                        session_end:          row.end_time,
                        academic_year:        academicYear,
                        semester:             semester,
                        meeting_status:       'NORMAL',
                        teacher_indicator:    'PENDING_EVALUATION',
                    });
                }
            }

            if (generatedRows.length > 0) {
                const { data: inserted, error: genErr } = await admin
                    .from('teaching_schedules')
                    .upsert(generatedRows, {
                        onConflict:       'class_id,scheduled_teacher_id,session_date,session_start',
                        ignoreDuplicates: true,
                    })
                    .select('schedule_id');

                if (genErr) {
                    console.error('[bulk-import-schedules] teaching_schedules generation failed:', genErr);
                    return internalError(genErr);
                }
                schedulesGenerated = inserted?.length ?? 0;
            }
        }

        // ── 12. Response ────────────────────────────────────────
        return ok({
            // Alias generik agar laporan hasil di wizard tampil seragam
            total:               rows.length,
            success:             totalTemplates,
            // Rincian khusus jadwal
            total_templates:     totalTemplates,
            templates_updated:   templatesUpdated,
            assignments_upserted: assignmentsUpserted,
            schedules_generated: schedulesGenerated,
            failed:              rows.length - totalTemplates,
            errors,
        });

    } catch (err) {
        return internalError(err);
    }
});
