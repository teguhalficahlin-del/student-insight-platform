/**
 * @file bulk-import-students/index.ts
 * @edge-function bulk-import-students
 * @version 1.1.0
 *
 * Bulk-creates student records + their initial class enrollment
 * from a CSV file during the ADMINISTRATIVE setup wizard.
 * Re-importing an existing NIS updates full_name, program_id,
 * and class enrollment — so TU can fix typos, wrong program,
 * or wrong class placement without deleting and re-importing.
 *
 * CONTRACT:
 *   POST /functions/v1/bulk-import-students
 *   Body: text/csv (raw CSV text), columns:
 *     nama, nis, kode_program, class_name
 *   academic_year and semester are NOT read from the CSV — they are
 *   taken from school_config.current_academic_year / current_semester,
 *   so every import always lands in the school's active period.
 *   Caller must be authenticated as role_type = ADMINISTRATIVE.
 *
 * PROCESSING SEQUENCE:
 *   1.  CORS preflight
 *   2.  Schema version check
 *   3.  Auth: verify JWT + resolve user row
 *   4.  Authorization: caller must be ADMINISTRATIVE
 *   5.  Fetch school_config (active academic_year + semester)
 *   6.  Parse CSV body
 *   7.  Validate each row (required fields)
 *   8.  Resolve kode_program -> program_id (per programs.code)
 *   9.  Resolve class_name -> class_id (per active academic_year)
 *  10.  Batch existing-NIS check against DB
 *  11.  Existing NIS rows: UPDATE full_name + program_id + class
 *       enrollment. New rows: RPC fn_bulk_import_students — atomic
 *       per-row insert (unchanged).
 *  12.  Response: { total, success, updated, failed, errors[] }
 *
 * WHY NOT supabase-js .upsert() HERE:
 *   New-row creation goes through fn_bulk_import_students (an atomic
 *   per-row RPC that also resolves enrollment); the only conflict case
 *   that needs handling client-side is "NIS already exists", which is
 *   resolved here with a direct, narrowly-scoped UPDATE before calling
 *   the RPC for the rest. This avoids touching the RPC definition
 *   (no migration) and avoids accidentally re-pointing an existing
 *   student's program_id/class on a routine re-import.
 */

import { handleCors, corsHeaders }     from '../_shared/cors.ts';
import { ok, badRequest, unauthorized,
         forbidden, internalError,
         checkSchemaVersion }          from '../_shared/response.ts';
import { resolveAuth, isAuthError }    from '../_shared/auth.ts';
import { getAdminClient }              from '../_shared/db.ts';
import { parseCsv }                    from '../_shared/csv.ts';

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

interface ImportRow {
    rowNumber:    number;
    nama:         string;
    nis:          string;
    kode_program: string;
    class_name:   string;
    program_id?:  string; // resolved from kode_program via programs.code lookup
    class_id?:    string;
}

interface ImportError {
    row:     number;
    message: string;
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
            return forbidden('Hanya akun ADMINISTRATIVE yang dapat melakukan impor siswa massal');
        }

        // ── 5. Fetch active academic_year + semester ──────────────
        // academic_year: fn_current_academic_year = SSoT (academic_periods ACTIVE,
        //   fallback school_config). semester tetap dari school_config.
        const { data: schoolConfig, error: configErr } = await admin
            .from('school_config')
            .select('current_academic_year, current_semester')
            .eq('school_id', user.school_id)
            .maybeSingle();

        if (configErr) {
            console.error('[bulk-import-students] school_config lookup failed:', configErr);
            return internalError(configErr);
        }
        if (!schoolConfig?.current_academic_year || !schoolConfig?.current_semester) {
            return badRequest(
                'Tahun ajaran atau semester aktif belum diset. ' +
                'Selesaikan Tahap 1 (Data Sekolah) di wizard setup terlebih dahulu.'
            );
        }

        const { data: authYear } = await admin.rpc('fn_current_academic_year', { p_school_id: user.school_id });
        const academicYear = (authYear as string) || schoolConfig.current_academic_year;
        const semester      = schoolConfig.current_semester;

        // ── 6. Parse CSV body ──────────────────────────────────
        const csvText = await req.text();
        if (!csvText || !csvText.trim()) {
            return badRequest('Body request kosong. Kirim file CSV sebagai teks mentah.');
        }

        const rawRows = parseCsv(csvText);
        if (rawRows.length === 0) {
            return badRequest('CSV tidak berisi baris data');
        }

        const rows: ImportRow[] = rawRows.map((r, i) => ({
            rowNumber:    i + 2,
            nama:         r.nama ?? '',
            nis:          r.nis ?? '',
            kode_program: r.kode_program ?? '',
            class_name:   r.class_name ?? '',
        }));

        // ── 7. Structural validation ───────────────────────────
        const errors: ImportError[] = [];
        const validRows: ImportRow[] = [];
        const seenNis = new Set<string>();

        for (const row of rows) {
            const missing = (['nama', 'nis', 'kode_program', 'class_name'] as const)
                .filter(field => !row[field]?.trim());
            if (missing.length > 0) {
                errors.push({ row: row.rowNumber, message: `Kolom wajib kosong: ${missing.join(', ')}` });
                continue;
            }
            if (seenNis.has(row.nis)) {
                errors.push({ row: row.rowNumber, message: `NIS duplikat di dalam file: ${row.nis}` });
                continue;
            }
            seenNis.add(row.nis);
            validRows.push(row);
        }

        // ── 8. Resolve kode_program -> program_id ──────────────
        if (validRows.length > 0) {
            const codes = [...new Set(validRows.map(r => r.kode_program))];
            const { data: programs, error: programErr } = await admin
                .from('programs')
                .select('program_id, code')
                .eq('school_id', user.school_id)
                .in('code', codes);

            if (programErr) {
                console.error('[bulk-import-students] program lookup failed:', programErr);
                return internalError(programErr);
            }

            const programMap = new Map(
                (programs ?? []).map((p: { program_id: string; code: string }) => [p.code, p.program_id]),
            );

            for (const row of [...validRows]) {
                const programId = programMap.get(row.kode_program);
                if (!programId) {
                    errors.push({
                        row: row.rowNumber,
                        message: `Kode program tidak ditemukan: "${row.kode_program}"`,
                    });
                    validRows.splice(validRows.indexOf(row), 1);
                    continue;
                }
                row.program_id = programId;
            }
        }

        // ── 9. Resolve class_name -> class_id ──────────────────
        if (validRows.length > 0) {
            const classNames = [...new Set(validRows.map(r => r.class_name))];
            const { data: classes, error: classErr } = await admin
                .from('classes')
                .select('class_id, name, academic_year')
                .eq('school_id', user.school_id)
                .eq('academic_year', academicYear)
                .in('name', classNames);

            if (classErr) {
                console.error('[bulk-import-students] class lookup failed:', classErr);
                return internalError(classErr);
            }

            const classMap = new Map(
                (classes ?? []).map((c: { class_id: string; name: string }) => [c.name, c.class_id]),
            );

            for (const row of [...validRows]) {
                const classId = classMap.get(row.class_name);
                if (!classId) {
                    errors.push({
                        row: row.rowNumber,
                        message: `Kelas tidak ditemukan: "${row.class_name}" tahun ajaran ${academicYear}`,
                    });
                    validRows.splice(validRows.indexOf(row), 1);
                    continue;
                }
                row.class_id = classId;
            }
        }

        // ── 10. Batch existing-NIS check against DB ─────────────
        // Chunked to avoid PostgREST 1000-row default limit and long URL.
        const existingNisSet = new Set<string>();
        if (validRows.length > 0) {
            const CHUNK = 500;
            for (let i = 0; i < validRows.length; i += CHUNK) {
                const chunk = validRows.slice(i, i + CHUNK).map(r => r.nis);
                const { data: existing, error: dupErr } = await admin
                    .from('students')
                    .select('nis')
                    .eq('school_id', user.school_id)
                    .in('nis', chunk)
                    .limit(chunk.length);

                if (dupErr) {
                    console.error('[bulk-import-students] existing-NIS check failed:', dupErr);
                    return internalError(dupErr);
                }
                (existing ?? []).forEach((s: { nis: string }) => existingNisSet.add(s.nis));
            }
        }

        const existingRows = validRows.filter(r => existingNisSet.has(r.nis));
        const newRows       = validRows.filter(r => !existingNisSet.has(r.nis));

        // ── 11a. Existing NIS: update full_name + program_id + class enrollment
        let updated = 0;
        for (const row of existingRows) {
            const { data: studentRow, error: fetchErr } = await admin
                .from('students')
                .select('student_id')
                .eq('school_id', user.school_id)
                .eq('nis', row.nis)
                .single();

            if (fetchErr || !studentRow) {
                errors.push({ row: row.rowNumber, message: `Gagal mencari NIS ${row.nis}: ${fetchErr?.message ?? 'tidak ditemukan'}` });
                continue;
            }

            const { error: updateErr } = await admin
                .from('students')
                .update({ full_name: row.nama, program_id: row.program_id })
                .eq('student_id', studentRow.student_id);

            if (updateErr) {
                errors.push({ row: row.rowNumber, message: `Gagal memperbarui NIS ${row.nis}: ${updateErr.message}` });
                continue;
            }

            const { error: enrollErr } = await admin
                .from('class_enrollments')
                .upsert({
                    student_id:    studentRow.student_id,
                    class_id:      row.class_id,
                    academic_year: academicYear,
                    semester:      semester,
                }, { onConflict: 'student_id,academic_year,semester' });

            if (enrollErr) {
                errors.push({ row: row.rowNumber, message: `Gagal memperbarui kelas NIS ${row.nis}: ${enrollErr.message}` });
                continue;
            }

            updated++;
        }

        // ── 11b. New NIS: RPC atomic per-row insert ─────────────
        let success = 0;
        if (newRows.length > 0) {
            const { data: rpcResult, error: rpcErr } = await admin.rpc('fn_bulk_import_students', {
                p_rows: newRows.map(r => ({
                    nis:           r.nis,
                    full_name:     r.nama,
                    program_id:    r.program_id,
                    class_id:      r.class_id,
                    academic_year: academicYear,
                    semester:      semester,
                })),
            });

            if (rpcErr) {
                console.error('[bulk-import-students] RPC error:', rpcErr);
                return internalError(rpcErr);
            }

            const result = rpcResult as { success: number; failed: number; errors: Array<{ row_index: number; nis: string; message: string }> };
            success = result.success;

            for (const e of result.errors ?? []) {
                const originalRow = newRows[e.row_index - 1];
                errors.push({
                    row:     originalRow?.rowNumber ?? -1,
                    message: `Gagal menyimpan NIS ${e.nis}: ${e.message}`,
                });
            }
        }

        // ── 12. Response ────────────────────────────────────────
        return ok({
            total:   rows.length,
            success,
            updated,
            failed:  rows.length - success - updated,
            errors,
        });

    } catch (err) {
        return internalError(err);
    }
});
