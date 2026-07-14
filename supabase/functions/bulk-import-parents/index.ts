/**
 * @file bulk-import-parents/index.ts
 * @edge-function bulk-import-parents
 * @version 1.1.0
 *
 * Bulk-provisions ORTU (parent) accounts and links them to students
 * via student_parents. Idempotent: re-importing the same NIK skips
 * account creation, updates that ORTU's full_name, and still ensures
 * the student_parents link exists. Supports the common "one parent,
 * two children" case — same NIK appearing on multiple rows with
 * different nis_siswa creates exactly one ORTU account and one link
 * per row.
 *
 * NOTE ON CONFLICT KEY: student_parents itself has no `nik` or
 * `full_name` column — it's a pure link table (student_id,
 * parent_user_id). The "upsert by nik, update full_name" requested
 * here actually applies to the `users` row (role_type=ORTU,
 * login_identifier=nik), which is what step 9b below updates. The
 * student_parents link's own upsert (step 10, ON CONFLICT DO NOTHING)
 * is unchanged — it has no other column worth updating.
 *
 * CONTRACT:
 *   POST /functions/v1/bulk-import-parents
 *   Body: text/csv (raw CSV text), columns: nama_ortu, nik, nis_siswa
 *   Caller must be authenticated as role_type = ADMINISTRATIVE.
 *
 * PROCESSING SEQUENCE:
 *   1.  CORS preflight
 *   2.  Schema version check
 *   3.  Auth: verify JWT + resolve user row
 *   4.  Authorization: caller must be ADMINISTRATIVE
 *   5.  Parse CSV body
 *   6.  Validate each row (nama_ortu/nik/nis_siswa present)
 *   7.  Resolve nis_siswa -> student_id (students.nis)
 *   8.  Batch duplicate check: nik already in users.login_identifier?
 *       (fn_check_niks_exist) — existing accounts skip step 9a.
 *   9.  a. For each unique new NIK: create Auth user + insert into users
 *          (role_type=ORTU). For rows whose NIK already existed, reuse
 *          that user_id.
 *       b. For each unique NIK that already existed: UPDATE
 *          users.full_name (no Auth/password change).
 *  10.  Batch upsert student_parents (ON CONFLICT DO NOTHING) for all
 *       valid rows.
 *  11.  Response: { total, success, updated, skipped, failed, errors[] }
 *
 * RESPONSE FIELD MEANING (mutually exclusive partition of `total`):
 *   success — row processed with a NEWLY created ORTU account
 *   updated — row processed against an existing ORTU account whose
 *             full_name was refreshed from this row's nama_ortu
 *   skipped — (reserved; currently unused — every existing-NIK row is
 *             now counted as `updated` instead of silently skipped)
 *   failed  — row could not be processed (validation/resolution error)
 */

import { handleCors, corsHeaders }     from '../_shared/cors.ts';
import { ok, badRequest,
         forbidden, internalError,
         checkSchemaVersion }          from '../_shared/response.ts';
import { resolveAuth, isAuthError }    from '../_shared/auth.ts';
import { getAdminClient }              from '../_shared/db.ts';
import { parseCsv }                    from '../_shared/csv.ts';
import { toInternalEmail }             from '../_shared/identifier.ts';

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

interface ImportRow {
    rowNumber:   number;
    nama_ortu:   string;
    nik:         string;
    nis_siswa:   string;
    student_id?: string;
}

interface ImportError {
    row:     number;
    message: string;
}

type RowOutcome = 'success' | 'updated';

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
            return forbidden('Hanya akun ADMINISTRATIVE yang dapat melakukan impor orang tua massal');
        }

        // ── 5. Parse CSV body ──────────────────────────────────
        const csvText = await req.text();
        if (!csvText || !csvText.trim()) {
            return badRequest('Body request kosong. Kirim file CSV sebagai teks mentah.');
        }

        const rawRows = parseCsv(csvText);
        if (rawRows.length === 0) {
            return badRequest('CSV tidak berisi baris data');
        }

        const rows: ImportRow[] = rawRows.map((r, i) => ({
            rowNumber: i + 2,
            nama_ortu: r.nama_ortu ?? '',
            nik:       r.nik ?? '',
            nis_siswa: r.nis_siswa ?? '',
        }));

        // ── 6. Structural validation ────────────────────────────
        const errors: ImportError[] = [];
        const validRows: ImportRow[] = [];

        for (const row of rows) {
            const missing = (['nama_ortu', 'nik', 'nis_siswa'] as const)
                .filter(field => !row[field]?.trim());
            if (missing.length > 0) {
                errors.push({ row: row.rowNumber, message: `Kolom wajib kosong: ${missing.join(', ')}` });
                continue;
            }
            validRows.push(row);
        }

        // ── 7. Resolve nis_siswa -> student_id ──────────────────
        if (validRows.length > 0) {
            const nisList = [...new Set(validRows.map(r => r.nis_siswa))];
            const { data: students, error: studentErr } = await admin
                .from('students')
                .select('student_id, nis')
                .eq('school_id', user.school_id)
                .in('nis', nisList);

            if (studentErr) {
                console.error('[bulk-import-parents] student lookup failed:', studentErr);
                return internalError(studentErr);
            }

            const studentMap = new Map((students ?? []).map((s: { student_id: string; nis: string }) => [s.nis, s.student_id]));

            for (const row of [...validRows]) {
                const studentId = studentMap.get(row.nis_siswa);
                if (!studentId) {
                    errors.push({ row: row.rowNumber, message: `Siswa dengan NIS "${row.nis_siswa}" tidak ditemukan` });
                    validRows.splice(validRows.indexOf(row), 1);
                    continue;
                }
                row.student_id = studentId;
            }
        }

        // ── 8. Batch duplicate check: NIK already a user? ───────
        let existingNikSet = new Set<string>();
        const nikToUserId = new Map<string, string>();

        if (validRows.length > 0) {
            const niks = [...new Set(validRows.map(r => r.nik))];
            const { data: existingNiks, error: dupErr } = await admin.rpc(
                'fn_check_niks_exist',
                { p_niks: niks, p_school_id: user.school_id },
            );

            if (dupErr) {
                console.error('[bulk-import-parents] duplicate check failed:', dupErr);
                return internalError(dupErr);
            }

            existingNikSet = new Set((existingNiks as string[] | null) ?? []);

            if (existingNikSet.size > 0) {
                const { data: existingUsers, error: userErr } = await admin
                    .from('users')
                    .select('user_id, login_identifier')
                    .in('login_identifier', [...existingNikSet])
                    .eq('school_id', user.school_id);

                if (userErr) {
                    console.error('[bulk-import-parents] existing user lookup failed:', userErr);
                    return internalError(userErr);
                }

                for (const u of (existingUsers ?? []) as { user_id: string; login_identifier: string }[]) {
                    nikToUserId.set(u.login_identifier, u.user_id);
                }
            }
        }

        // ── 9a. Create ORTU accounts for new (non-existing) NIKs ──
        const rowOutcome = new Map<number, RowOutcome>(); // rowNumber -> outcome
        const failedNiks = new Set<string>();

        const newNikToName = new Map<string, string>();
        for (const row of validRows) {
            if (!existingNikSet.has(row.nik) && !newNikToName.has(row.nik)) {
                newNikToName.set(row.nik, row.nama_ortu);
            }
        }

        const createdAccounts: { login_identifier: string; full_name: string; temp_password: string }[] = [];

        for (const [nik, namaOrtu] of newNikToName) {
            // Namespace per sekolah: NIK bisa dipakai orang tua yang sama di dua
            // sekolah (anak di sekolah berbeda). Auth global → tanpa prefix,
            // createUser sekolah kedua gagal "email already registered".
            const internalEmail = toInternalEmail(nik, 'NIK', user.school_id);
            const password = '12345678';

            const { data: authUser, error: authErr } = await admin.auth.admin.createUser({
                email:         internalEmail,
                password:      password,
                email_confirm: true,
            });

            if (authErr || !authUser?.user) {
                failedNiks.add(nik);
                continue; // error recorded per-row below
            }

            const { data: insertedUser, error: insertErr } = await admin
                .from('users')
                .insert({
                    auth_user_id:         authUser.user.id,
                    full_name:            namaOrtu,
                    email:                internalEmail,
                    login_identifier:     nik,
                    identifier_type:      'NIK',
                    role_type:            'ORTU',
                    school_id:            user.school_id,
                    must_change_password: true,
                })
                .select('user_id')
                .single();

            if (insertErr || !insertedUser) {
                // Roll back the orphaned Auth user so retries don't collide
                await admin.auth.admin.deleteUser(authUser.user.id);
                failedNiks.add(nik);
                continue;
            }

            nikToUserId.set(nik, insertedUser.user_id);
            createdAccounts.push({
                login_identifier: nik,
                full_name:        namaOrtu,
                temp_password:    password,
            });
        }

        // ── 9b. Existing NIKs: update full_name only ────────────
        // (no Auth/password change — only the users row is touched)
        for (const nik of existingNikSet) {
            const namaOrtu = validRows.find(r => r.nik === nik)?.nama_ortu;
            if (!namaOrtu) continue;

            const { error: updateErr } = await admin
                .from('users')
                .update({ full_name: namaOrtu })
                .eq('login_identifier', nik)
                .eq('school_id', user.school_id);

            if (updateErr) {
                console.error('[bulk-import-parents] full_name update failed for NIK', nik, updateErr);
                failedNiks.add(nik);
            }
        }

        // ── 10. Batch upsert student_parents (ON CONFLICT DO NOTHING) ──
        const linkRows: { student_id: string; parent_user_id: string }[] = [];

        for (const row of [...validRows]) {
            if (failedNiks.has(row.nik)) {
                errors.push({ row: row.rowNumber, message: `Gagal memproses akun orang tua untuk NIK "${row.nik}"` });
                validRows.splice(validRows.indexOf(row), 1);
                continue;
            }

            const parentUserId = nikToUserId.get(row.nik)!;
            rowOutcome.set(row.rowNumber, existingNikSet.has(row.nik) ? 'updated' : 'success');
            linkRows.push({ student_id: row.student_id!, parent_user_id: parentUserId });
        }

        if (linkRows.length > 0) {
            const { error: linkErr } = await admin
                .from('student_parents')
                .upsert(linkRows, { onConflict: 'student_id,parent_user_id', ignoreDuplicates: true });

            if (linkErr) {
                console.error('[bulk-import-parents] student_parents upsert failed:', linkErr);
                return internalError(linkErr);
            }
        }

        // ── 11. Response ────────────────────────────────────────
        let success = 0;
        let updated = 0;
        for (const outcome of rowOutcome.values()) {
            if (outcome === 'success') success++;
            else updated++;
        }

        return ok({
            total:   rows.length,
            success,
            updated,
            skipped: 0,
            failed:  rows.length - success - updated,
            errors,
            created: createdAccounts, // temp_password per akun baru — tampilkan sekali ke admin
        });

    } catch (err) {
        return internalError(err);
    }
});
