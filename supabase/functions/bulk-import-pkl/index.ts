/**
 * @file bulk-import-pkl/index.ts
 * @edge-function bulk-import-pkl
 *
 * Impor massal penempatan PKL dari CSV.
 * Setiap baris: nis, login_dudi, tanggal_mulai, tanggal_selesai
 *
 * CONTRACT:
 *   POST /functions/v1/bulk-import-pkl
 *   Body: text/csv
 *   Columns (header baris pertama): nis, login_dudi, tanggal_mulai, tanggal_selesai
 *   Caller: ADMINISTRATIVE atau KAPRODI atau KEPSEK
 *
 * LOGIC PER BARIS:
 *   1. Cari student_id dari NIS → validasi ada & student.program_id
 *   2. Cari dudi_user_id dari login_dudi slug → validasi role DUDI
 *   3. Validasi tanggal: tanggal_selesai > tanggal_mulai
 *   4. Cek tidak ada placement aktif lain yang tumpang-tindih (handled by DB constraint)
 *   5. INSERT pkl_placements (is_active=true)
 *   6. UPDATE students.student_status = 'PKL'
 *
 * Idempoten: baris yang sama (NIS + slug DUDI + tanggal sama) di-skip bila
 * placement identik sudah ada (cek placement_id via NIS+DUDI+start_date).
 */

import { handleCors, corsHeaders }  from '../_shared/cors.ts';
import { ok, badRequest, forbidden,
         internalError, checkSchemaVersion } from '../_shared/response.ts';
import { resolveAuth, isAuthError }  from '../_shared/auth.ts';
import { getAdminClient }            from '../_shared/db.ts';
import { parseCsv }                  from '../_shared/csv.ts';

interface ImportRow {
    rowNumber:    number;
    nis:          string;
    login_dudi:   string;
    tanggal_mulai:  string;
    tanggal_selesai: string;
}

interface ImportError {
    row:     number;
    message: string;
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

        if (!['ADMINISTRATIVE', 'KAPRODI', 'KEPSEK'].includes(user.role_type)) {
            return forbidden('Hanya ADMINISTRATIVE, KAPRODI, atau KEPSEK yang dapat mengimpor penempatan PKL');
        }

        const csvText = await req.text();
        if (!csvText?.trim()) {
            return badRequest('Body request kosong. Kirim file CSV sebagai teks mentah.');
        }

        const rawRows = parseCsv(csvText);
        if (rawRows.length === 0) return badRequest('CSV tidak berisi baris data');

        const rows: ImportRow[] = rawRows.map((r, i) => ({
            rowNumber:       i + 2,
            nis:             (r.nis ?? '').trim(),
            login_dudi:      (r.login_dudi ?? '').trim().toLowerCase(),
            tanggal_mulai:   (r.tanggal_mulai ?? '').trim(),
            tanggal_selesai: (r.tanggal_selesai ?? '').trim(),
        }));

        const errors: ImportError[] = [];
        const validRows: ImportRow[] = [];

        for (const row of rows) {
            const missing = (['nis', 'login_dudi', 'tanggal_mulai', 'tanggal_selesai'] as const)
                .filter(f => !row[f]);
            if (missing.length) {
                errors.push({ row: row.rowNumber, message: `Kolom wajib kosong: ${missing.join(', ')}` });
                continue;
            }
            if (row.tanggal_selesai <= row.tanggal_mulai) {
                errors.push({ row: row.rowNumber, message: `tanggal_selesai harus setelah tanggal_mulai` });
                continue;
            }
            validRows.push(row);
        }

        if (validRows.length === 0) {
            return ok({ total: rows.length, success: 0, skipped: 0, failed: rows.length, errors });
        }

        // Batch-resolve NIS → student
        const wantedNis = [...new Set(validRows.map(r => r.nis))];
        const { data: studentRows, error: studErr } = await admin
            .from('students')
            .select('student_id, nis, student_status, program_id')
            .in('nis', wantedNis);
        if (studErr) return internalError(studErr);

        const nisToBranch = new Map(
            (studentRows ?? []).map((s: { student_id: string; nis: string; student_status: string; program_id: string }) =>
                [s.nis, s]
            )
        );

        // Batch-resolve login_dudi slug → DUDI user
        const wantedSlugs = [...new Set(validRows.map(r => r.login_dudi))];
        const { data: dudiRows, error: dudiErr } = await admin
            .from('users')
            .select('user_id, login_identifier, dudi_org_name')
            .eq('role_type', 'DUDI')
            .in('login_identifier', wantedSlugs);
        if (dudiErr) return internalError(dudiErr);

        const slugToDudi = new Map(
            (dudiRows ?? []).map((d: { user_id: string; login_identifier: string; dudi_org_name: string }) =>
                [d.login_identifier, d]
            )
        );

        // Existing placements for idempotency check (same student+dudi+start_date)
        const { data: existingPlacements, error: plErr } = await admin
            .from('pkl_placements')
            .select('placement_id, student_id, dudi_user_id, start_date')
            .eq('is_active', true);
        if (plErr) return internalError(plErr);

        const placementKey = (sid: string, did: string, start: string) => `${sid}|${did}|${start}`;
        const existingKeys = new Set(
            (existingPlacements ?? []).map((p: { student_id: string; dudi_user_id: string; start_date: string }) =>
                placementKey(p.student_id, p.dudi_user_id, p.start_date)
            )
        );

        let success = 0;
        let skipped = 0;

        for (const row of validRows) {
            const student = nisToBranch.get(row.nis);
            if (!student) {
                errors.push({ row: row.rowNumber, message: `NIS tidak ditemukan: ${row.nis}` });
                continue;
            }

            const dudi = slugToDudi.get(row.login_dudi);
            if (!dudi) {
                errors.push({ row: row.rowNumber, message: `DUDI dengan login '${row.login_dudi}' tidak ditemukan` });
                continue;
            }

            // Idempotency: skip bila sudah ada
            const key = placementKey(student.student_id, dudi.user_id, row.tanggal_mulai);
            if (existingKeys.has(key)) {
                skipped++;
                continue;
            }

            // INSERT placement
            const { error: insertErr } = await admin
                .from('pkl_placements')
                .insert({
                    student_id:   student.student_id,
                    dudi_user_id: dudi.user_id,
                    start_date:   row.tanggal_mulai,
                    end_date:     row.tanggal_selesai,
                    is_active:    true,
                });

            if (insertErr) {
                const msg = insertErr.message?.includes('uq_active_pkl_per_student')
                    ? `Siswa ${row.nis} sudah punya penempatan aktif pada periode tersebut`
                    : `Gagal membuat penempatan: ${insertErr.message}`;
                errors.push({ row: row.rowNumber, message: msg });
                continue;
            }

            const { error: updErr } = await admin
                .from('students')
                .update({ student_status: 'PKL' })
                .eq('student_id', student.student_id);
            if (updErr) {
                errors.push({ row: row.rowNumber, message: `Penempatan dibuat tapi gagal update status siswa: ${updErr.message}` });
            }

            existingKeys.add(key); // prevent double-insert within same batch
            success++;
        }

        return ok({
            total:   rows.length,
            success,
            skipped,
            failed:  rows.length - success - skipped,
            errors,
        });

    } catch (err) {
        return internalError(err);
    }
});
