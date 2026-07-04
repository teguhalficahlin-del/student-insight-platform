/**
 * @file bulk-import-classes/index.ts
 * @edge-function bulk-import-classes
 * @version 1.1.0
 *
 * Bulk-creates/updates kelas/rombel records from a CSV file, run by
 * ADMINISTRATIVE during the setup wizard (Tahap 3) as an alternative
 * to the one-at-a-time manual form. Re-importing the same nama_kelas
 * within the same academic_year updates program_id/grade_level instead
 * of failing — upsert keyed on classes (name, academic_year) (UNIQUE).
 *
 * academic_year is NOT read from the CSV — it is taken from
 * school_config.current_academic_year, so every imported class lands
 * in the school's active academic year (same convention as
 * bulk-import-students).
 *
 * RLS on `classes` (rls_classes_write_admin) already permits
 * role_type = ADMINISTRATIVE, so this Edge Function isn't strictly
 * required to bypass RLS the way bulk-import-programs is — it exists
 * to follow the same CSV-import pattern (template, validation,
 * batch report) as the other bulk-import-* functions.
 *
 * CONTRACT:
 *   POST /functions/v1/bulk-import-classes
 *   Body: text/csv (raw CSV text), columns: nama_kelas, kode_program, tingkat
 *   Caller must be authenticated as role_type = ADMINISTRATIVE.
 *
 * PROCESSING SEQUENCE:
 *   1.  CORS preflight
 *   2.  Schema version check
 *   3.  Auth: verify JWT + resolve user row
 *   4.  Authorization: caller must be ADMINISTRATIVE
 *   5.  Fetch school_config (active academic_year)
 *   6.  Parse CSV body
 *   7.  Validate each row (required fields, tingkat in [10,11,12];
 *       nama_kelas unique within file — Postgres can't affect the
 *       same row twice in one upsert statement)
 *   8.  Resolve kode_program -> program_id (per programs.code)
 *   9.  Batch upsert into classes, ON CONFLICT (name, academic_year)
 *       DO UPDATE SET program_id = EXCLUDED.program_id,
 *       grade_level = EXCLUDED.grade_level (updated_at is set
 *       automatically by the trg_set_updated_at_classes trigger)
 *  10.  Response: { total, success, failed, errors[] }
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
    rowNumber:    number;
    nama_kelas:   string;
    kode_program: string;
    tingkat:      string;
    program_id?:  string; // resolved from kode_program via programs.code lookup
    grade_level?: number; // parsed from tingkat
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
            return forbidden('Hanya akun ADMINISTRATIVE yang dapat melakukan impor kelas massal');
        }

        // ── 5. Fetch active academic_year (fn_current_academic_year = SSoT,
        //       prioritas academic_periods ACTIVE, fallback school_config) ──
        const { data: schoolConfig, error: configErr } = await admin
            .from('school_config')
            .select('current_academic_year')
            .eq('school_id', user.school_id)
            .maybeSingle();

        if (configErr) {
            console.error('[bulk-import-classes] school_config lookup failed:', configErr);
            return internalError(configErr);
        }
        if (!schoolConfig?.current_academic_year) {
            return badRequest(
                'Tahun ajaran aktif belum diset. ' +
                'Selesaikan Tahap 1 (Data Sekolah) di wizard setup terlebih dahulu.'
            );
        }

        const { data: authYear } = await admin.rpc('fn_current_academic_year', { p_school_id: user.school_id });
        const academicYear = (authYear as string) || schoolConfig.current_academic_year;

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
            nama_kelas:   r.nama_kelas ?? '',
            kode_program: (r.kode_program ?? '').toUpperCase(),
            tingkat:      r.tingkat ?? '',
        }));

        // ── 7. Structural validation ────────────────────────────
        const errors: ImportError[] = [];
        const validRows: ImportRow[] = [];
        const seenNames = new Set<string>();

        for (const row of rows) {
            const missing = (['nama_kelas', 'kode_program', 'tingkat'] as const)
                .filter(field => !row[field]?.trim());
            if (missing.length > 0) {
                errors.push({ row: row.rowNumber, message: `Kolom wajib kosong: ${missing.join(', ')}` });
                continue;
            }

            const gradeLevel = Number(row.tingkat);
            if (!Number.isInteger(gradeLevel) || gradeLevel < 10 || gradeLevel > 12) {
                errors.push({ row: row.rowNumber, message: `Tingkat harus 10, 11, atau 12: "${row.tingkat}"` });
                continue;
            }

            if (seenNames.has(row.nama_kelas)) {
                errors.push({ row: row.rowNumber, message: `Nama kelas duplikat di dalam file: ${row.nama_kelas}` });
                continue;
            }

            seenNames.add(row.nama_kelas);
            row.grade_level = gradeLevel;
            validRows.push(row);
        }

        // ── 8. Resolve kode_program -> program_id ───────────────
        if (validRows.length > 0) {
            const codes = [...new Set(validRows.map(r => r.kode_program))];
            const { data: programs, error: programErr } = await admin
                .from('programs')
                .select('program_id, code')
                .eq('school_id', user.school_id)
                .in('code', codes);

            if (programErr) {
                console.error('[bulk-import-classes] program lookup failed:', programErr);
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

        // ── 9. Batch upsert (insert new / update existing by nama_kelas+academic_year) ──
        let success = 0;
        if (validRows.length > 0) {
            const { error: upsertErr } = await admin.from('classes').upsert(
                validRows.map(r => ({
                    school_id:     user.school_id,
                    name:          r.nama_kelas,
                    program_id:    r.program_id,
                    academic_year: academicYear,
                    grade_level:   r.grade_level,
                })),
                { onConflict: 'school_id,name,academic_year' },
            );

            if (upsertErr) {
                console.error('[bulk-import-classes] upsert failed:', upsertErr);
                return internalError(upsertErr);
            }
            success = validRows.length;
        }

        // ── 10. Response ─────────────────────────────────────────
        return ok({
            total:   rows.length,
            success,
            failed:  rows.length - success,
            errors,
        });

    } catch (err) {
        return internalError(err);
    }
});
