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
 *     kode_guru, nama_mapel, nama_kelas, hari, start_time, end_time
 *   Guru diidentifikasi dari kode singkat (users.teacher_code). Mata pelajaran
 *   dari nama (subjects.name) — get-or-create per sekolah. 1 guru tidak
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
 *       kode_guru/nama_kelas/nama_mapel present)
 *   9.  Resolve nama_kelas -> class_id (classes.name + academic_year),
 *       kode_guru -> teacher_id (users.teacher_code; unik per sekolah),
 *       nama_mapel -> subject_id (subjects.name; get-or-create)
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
 *  11b. Upsert schedule_time_slots: extract unique (day_of_week, start_time,
 *       end_time) dari validRows, sort by start_time per hari, assign
 *       slot_number 1..N, upsert ON CONFLICT DO UPDATE start_time/end_time
 *       (is_break dan break_label tidak disentuh — preserve slot manual).
 *  12.  Response: { total_templates, templates_updated,
 *       assignments_upserted, schedules_generated, time_slots_upserted, failed, errors[] }
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
    kode_guru:   string;
    nama_mapel:  string;
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

        // ── 5. Fetch active academic_year + semester ──────────────
        // academic_year: fn_current_academic_year = SSoT (academic_periods ACTIVE,
        //   fallback school_config). semester tetap dari school_config.
        const { data: schoolConfig, error: configErr } = await admin
            .from('school_config')
            .select('current_academic_year, current_semester')
            .eq('school_id', user.school_id)
            .maybeSingle();

        if (configErr || !schoolConfig) {
            console.error('[bulk-import-schedules] school_config lookup failed:', configErr);
            return internalError(configErr ?? new Error('school_config tidak ditemukan'));
        }

        const { data: authYear } = await admin.rpc('fn_current_academic_year', { p_school_id: user.school_id });
        const academicYear = (authYear as string) || schoolConfig.current_academic_year;
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
            kode_guru:  (r.kode_guru ?? '').trim().toUpperCase(),
            nama_mapel: (r.nama_mapel ?? '').trim(),
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
            if (!row.nama_kelas.trim() || !row.kode_guru) {
                errors.push({ row: row.rowNumber, message: 'Kolom kode_guru dan nama_kelas wajib diisi' });
                continue;
            }
            validRows.push(row);
        }

        // ── 9. Resolve nama_kelas -> class_id, nama_guru -> teacher_id,
        //       subject = default "KBM" ─────────────────────────────
        if (validRows.length > 0) {
            const classNames  = [...new Set(validRows.map(r => r.nama_kelas.trim()))];
            const teacherCodes = [...new Set(validRows.map(r => r.kode_guru))];
            const subjectNames = [...new Set(validRows.map(r => r.nama_mapel))];

            const [{ data: classes, error: classErr }, { data: teachers, error: teacherErr }] = await Promise.all([
                admin.from('classes').select('class_id, name').eq('school_id', user.school_id).eq('academic_year', academicYear).in('name', classNames),
                admin.from('users').select('user_id, teacher_code')
                    .eq('school_id', user.school_id)
                    .not('teacher_code', 'is', null)
                    .in('teacher_code', teacherCodes),
            ]);

            if (classErr)   { console.error('[bulk-import-schedules] class lookup failed:', classErr);   return internalError(classErr); }
            if (teacherErr) { console.error('[bulk-import-schedules] teacher lookup failed:', teacherErr); return internalError(teacherErr); }

            const classMap   = new Map((classes  ?? []).map((c: { class_id: string; name: string }) => [c.name, c.class_id]));
            const teacherMap = new Map((teachers ?? []).map((t: { user_id: string; teacher_code: string }) => [t.teacher_code.toUpperCase(), t.user_id]));

            // Resolve semua nama_mapel sekaligus (get-or-create per sekolah)
            const subjectMap = new Map<string, string>();
            for (const subName of subjectNames) {
                const key = subName.trim().toUpperCase();
                const { data: existing } = await admin.from('subjects').select('subject_id').eq('school_id', user.school_id).ilike('name', subName).maybeSingle();
                if (existing) {
                    subjectMap.set(key, existing.subject_id);
                } else {
                    const code = subName.replace(/\s+/g, '_').toUpperCase().slice(0, 20);
                    const { data: created, error: subErr } = await admin.from('subjects')
                        .insert({ name: subName, code, is_active: true, school_id: user.school_id })
                        .select('subject_id').single();
                    if (subErr) { console.error('[bulk-import-schedules] subject create failed:', subErr); return internalError(subErr); }
                    subjectMap.set(key, created.subject_id);
                }
            }

            for (const row of [...validRows]) {
                const classId = classMap.get(row.nama_kelas.trim());
                if (!classId) {
                    errors.push({ row: row.rowNumber, message: `Kelas "${row.nama_kelas}" tahun ajaran ${academicYear} tidak ditemukan` });
                    validRows.splice(validRows.indexOf(row), 1);
                    continue;
                }
                const teacherId = teacherMap.get(row.kode_guru);
                if (!teacherId) {
                    errors.push({ row: row.rowNumber, message: `Kode guru "${row.kode_guru}" tidak ditemukan. Pastikan kode sesuai daftar staf.` });
                    validRows.splice(validRows.indexOf(row), 1);
                    continue;
                }
                const subjectId = subjectMap.get(row.nama_mapel.trim().toUpperCase());
                if (!subjectId) {
                    errors.push({ row: row.rowNumber, message: `Mata pelajaran "${row.nama_mapel}" gagal dibuat.` });
                    validRows.splice(validRows.indexOf(row), 1);
                    continue;
                }
                row.class_id   = classId;
                row.teacher_id = teacherId;
                row.subject_id = subjectId;
            }
        }

        // ── 9b. Deteksi bentrok: 1 guru tidak boleh mengajar di kelas
        //        berbeda pada hari & waktu yang tumpang-tindih ────────
        if (validRows.length > 0) {
            // Kumpulkan guru yang boleh mengajar paralel (moving class/team teaching)
            const allTeacherIds = [...new Set(validRows.map(r => r.teacher_id).filter((id): id is string => !!id))];
            const { data: parallelRows } = await admin
                .from('users')
                .select('user_id')
                .in('user_id', allTeacherIds)
                .eq('allow_parallel_teaching', true);
            const parallelTeachers = new Set<string>((parallelRows ?? []).map((u: { user_id: string }) => u.user_id));

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
                            !parallelTeachers.has(b.teacher_id!) &&
                            overlaps(parseTimeMinutes(a.start_time), parseTimeMinutes(a.end_time),
                                     parseTimeMinutes(b.start_time), parseTimeMinutes(b.end_time))) {
                            conflicted.add(b); // baris yang belakangan ditolak
                            errors.push({ row: b.rowNumber, message: `Bentrok: ${b.kode_guru} sudah dijadwalkan di kelas lain pada ${b.hari} ${a.start_time}-${a.end_time} (baris ${a.rowNumber})`, code: 'SCHEDULE_CONFLICT' });
                        }
                    }
                }
            }
            for (const row of conflicted) validRows.splice(validRows.indexOf(row), 1);

            // (ii) Bentrok dengan jadwal tersimpan di DB — fetch SEKALI, cek in-memory
            const teacherIds = [...new Set(validRows.map(r => r.teacher_id))];
            const { data: dbTemplates, error: exErr } = await admin
                .from('schedule_templates')
                .select('teacher_id, day_of_week, start_time, end_time, class_id')
                .eq('school_id', user.school_id)
                .eq('academic_year', academicYear)
                .eq('semester', semester)
                .in('teacher_id', teacherIds);
            if (exErr) { console.error('[bulk-import-schedules] conflict check failed:', exErr); return internalError(exErr); }

            // Group db templates by teacher|day
            const dbByTeacherDay = new Map<string, { start_time: string; end_time: string; class_id: string }[]>();
            for (const t of dbTemplates ?? []) {
                const key = `${t.teacher_id}|${t.day_of_week}`;
                const arr = dbByTeacherDay.get(key) ?? [];
                arr.push(t);
                dbByTeacherDay.set(key, arr);
            }
            for (const row of [...validRows]) {
                const existing = dbByTeacherDay.get(`${row.teacher_id}|${row.hari}`) ?? [];
                const rS = parseTimeMinutes(row.start_time), rE = parseTimeMinutes(row.end_time);
                const clash = existing.find(e =>
                    e.class_id !== row.class_id &&
                    overlaps(rS, rE, parseTimeMinutes(e.start_time.slice(0, 5)), parseTimeMinutes(e.end_time.slice(0, 5))),
                );
                if (clash && !parallelTeachers.has(row.teacher_id!)) {
                    errors.push({ row: row.rowNumber, message: `Bentrok dengan jadwal tersimpan: ${row.kode_guru} sudah mengajar di kelas lain pada ${row.hari} ${clash.start_time.slice(0, 5)}-${clash.end_time.slice(0, 5)}`, code: 'SCHEDULE_CONFLICT' });
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
        const resolvedRows: ImportRow[] = [...validRows];

        if (validRows.length > 0) {
            // Batch upsert semua template sekaligus — jauh lebih efisien dari loop.
            // Dedup dulu berdasarkan kunci konflik: dua baris CSV identik akan memicu
            // "ON CONFLICT DO UPDATE cannot affect row a second time" jika dikirim bersama.
            const templateMap = new Map<string, object>();
            for (const row of validRows) {
                // Baris terakhir menang (end_time terbaru) — konsisten dengan DO UPDATE.
                templateMap.set(`${row.hari}|${row.start_time}|${row.class_id}|${row.teacher_id}`, {
                    academic_year: academicYear,
                    semester:      semester,
                    day_of_week:   row.hari,
                    start_time:    row.start_time,
                    end_time:      row.end_time,
                    class_id:      row.class_id,
                    teacher_id:    row.teacher_id,
                    subject_id:    row.subject_id,
                });
            }
            const templatePayload = [...templateMap.values()];
            const { error: upsertErr } = await admin
                .from('schedule_templates')
                .upsert(templatePayload, {
                    onConflict:       'academic_year,semester,day_of_week,start_time,class_id,teacher_id',
                    ignoreDuplicates: false,
                });
            if (upsertErr) {
                console.error('[bulk-import-schedules] schedule_templates batch upsert failed:', upsertErr);
                return internalError(upsertErr);
            }
        }
        totalTemplates   = resolvedRows.length;
        templatesUpdated = resolvedRows.length;

        // ── 10b. Upsert teaching_assignments per resolved row ────
        let assignmentsUpserted = 0;
        const assignmentMap = new Map<string, string>(); // key: teacherId|classId|subjectId -> assignment_id

        if (resolvedRows.length > 0) {
            // Deduplikasi: 1 guru bisa mengajar banyak sesi di kelas yang sama
            // → hanya 1 teaching_assignment per (user_id, class_id, subject_id)
            const assignmentMap2 = new Map<string, object>();
            for (const row of resolvedRows) {
                const key = `${row.teacher_id}|${row.class_id}|${row.subject_id}`;
                if (!assignmentMap2.has(key)) {
                    assignmentMap2.set(key, {
                        user_id:       row.teacher_id,
                        class_id:      row.class_id,
                        subject_id:    row.subject_id,
                        academic_year: academicYear,
                        semester:      semester,
                        is_active:     true,
                    });
                }
            }
            const assignmentRows = [...assignmentMap2.values()];

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

            // Assign block_group_id: slot berurutan (gap ≤ 40 menit) dengan
            // guru+kelas+hari yang sama mendapat UUID yang sama.
            const blockKeyMap = new Map<string, string>(); // "teacherId|classId|date|blockNum" → uuid
            // Group per (teacher, class, date), urutkan start_time, lalu assign blok
            const byTCD = new Map<string, typeof generatedRows>();
            for (const r of generatedRows) {
                const key = `${r.scheduled_teacher_id}|${r.class_id}|${r.session_date}`;
                if (!byTCD.has(key)) byTCD.set(key, []);
                byTCD.get(key)!.push(r);
            }
            for (const [key, slots] of byTCD) {
                slots.sort((a, b) => parseTimeMinutes(a.session_start) - parseTimeMinutes(b.session_start));
                let blockNum = 0;
                let prevEndMin = -1;
                for (const slot of slots) {
                    const startMin = parseTimeMinutes(slot.session_start);
                    const gap = prevEndMin >= 0 ? startMin - prevEndMin : -1;
                    if (gap < 0 || gap > 40) blockNum++;
                    prevEndMin = parseTimeMinutes(slot.session_end);
                    const blockKey = `${key}|${blockNum}`;
                    if (!blockKeyMap.has(blockKey)) blockKeyMap.set(blockKey, crypto.randomUUID());
                    (slot as Record<string, unknown>).block_group_id = blockKeyMap.get(blockKey);
                }
            }

            // Pecah insert menjadi chunk agar tidak membebani worker: 600 template
            // × ~26 tanggal/semester bisa menghasilkan belasan ribu baris. Satu
            // statement raksasa (bangun array + serialize + terima balik semua id)
            // memicu WORKER_RESOURCE_LIMIT. Chunk kecil menjaga memori & waktu tetap rendah.
            const CHUNK_SIZE = 500;
            for (let i = 0; i < generatedRows.length; i += CHUNK_SIZE) {
                const chunk = generatedRows.slice(i, i + CHUNK_SIZE);
                const { data: inserted, error: genErr } = await admin
                    .from('teaching_schedules')
                    .upsert(chunk, {
                        onConflict:       'class_id,scheduled_teacher_id,session_date,session_start',
                        ignoreDuplicates: true,
                    })
                    .select('schedule_id');

                if (genErr) {
                    console.error('[bulk-import-schedules] teaching_schedules generation failed:', genErr);
                    return internalError(genErr);
                }
                schedulesGenerated += inserted?.length ?? 0;
            }
        }

        // ── 11b. Upsert schedule_time_slots dari validRows ──────
        // Extract unique (start_time, end_time) per hari dari baris yang lolos
        // validasi. Baris istirahat tidak ada di payload (sudah dibuang parser).
        // slot_number di-assign berdasarkan urutan start_time per hari.
        // DO UPDATE hanya start_time/end_time — is_break & break_label tidak
        // disentuh agar slot istirahat yang diinput manual via schedule-builder
        // tidak tertimpa.
        let timeSlotsUpserted = 0;
        if (validRows.length > 0) {
            const slotsByDay = new Map<string, Set<string>>();
            for (const row of validRows) {
                if (!slotsByDay.has(row.hari)) slotsByDay.set(row.hari, new Set());
                slotsByDay.get(row.hari)!.add(`${row.start_time}|${row.end_time}`);
            }
            const slotPayload: object[] = [];
            for (const [hari, timeSet] of slotsByDay) {
                const sorted = [...timeSet]
                    .map(s => { const [st, et] = s.split('|'); return { st, et }; })
                    .sort((a, b) => parseTimeMinutes(a.st) - parseTimeMinutes(b.st));
                sorted.forEach(({ st, et }, idx) => {
                    slotPayload.push({
                        school_id:     user.school_id,
                        academic_year: academicYear,
                        semester:      semester,
                        day_of_week:   hari,
                        slot_number:   idx + 1,
                        start_time:    st,
                        end_time:      et,
                        is_break:      false,
                        break_label:   null,
                    });
                });
            }
            const { error: slotErr } = await admin
                .from('schedule_time_slots')
                .upsert(slotPayload, {
                    onConflict:       'school_id,academic_year,semester,day_of_week,slot_number',
                    ignoreDuplicates: false,
                });
            if (slotErr) {
                console.error('[bulk-import-schedules] schedule_time_slots upsert failed:', slotErr);
                return internalError(slotErr);
            }
            timeSlotsUpserted = slotPayload.length;
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
            time_slots_upserted: timeSlotsUpserted,
            failed:              rows.length - totalTemplates,
            errors,
        });

    } catch (err) {
        return internalError(err);
    }
});
