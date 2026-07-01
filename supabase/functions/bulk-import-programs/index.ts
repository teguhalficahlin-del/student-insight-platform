/**
 * @file bulk-import-programs/index.ts
 * @edge-function bulk-import-programs
 * @version 1.1.0
 *
 * Bulk-creates/updates program keahlian (study program) master records
 * from a CSV file, run by ADMINISTRATIVE during the setup wizard
 * (Tahap 2). Re-importing the same kode updates its nama instead of
 * failing — upsert keyed on programs.code (UNIQUE).
 *
 * Runs via the service-role admin client because RLS on `programs`
 * (rls_programs_write_admin) only permits role_type IN (KEPSEK, KAPRODI)
 * — not ADMINISTRATIVE. The setup wizard needs to provision programs
 * before any KEPSEK/KAPRODI account exists yet, so a direct insert
 * from the browser is blocked; this Edge Function bypasses RLS the
 * same way bulk-import-users/-students/-dudi do for their tables.
 *
 * CONTRACT:
 *   POST /functions/v1/bulk-import-programs
 *   Body: text/csv (raw CSV text), columns: kode, nama
 *   Caller must be authenticated as role_type = ADMINISTRATIVE.
 *
 * PROCESSING SEQUENCE:
 *   1.  CORS preflight
 *   2.  Schema version check
 *   3.  Auth: verify JWT + resolve user row
 *   4.  Authorization: caller must be ADMINISTRATIVE
 *   5.  Parse CSV body
 *   6.  Validate each row (kode, nama present; kode unique within file —
 *       Postgres can't affect the same row twice in one upsert statement)
 *   7.  Batch upsert into programs, ON CONFLICT (code) DO UPDATE SET
 *       name = EXCLUDED.name (updated_at is set automatically by the
 *       trg_set_updated_at_programs trigger)
 *   8.  Response: { total, success, failed, errors[] }
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
    rowNumber: number;
    kode:      string;
    nama:      string;
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
            return forbidden('Hanya akun ADMINISTRATIVE yang dapat melakukan impor program keahlian massal');
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
            kode:      (r.kode ?? '').toUpperCase(),
            nama:      r.nama ?? '',
        }));

        // ── 6. Structural validation ───────────────────────────
        const errors: ImportError[] = [];
        const validRows: ImportRow[] = [];
        const seenCodes = new Set<string>();

        for (const row of rows) {
            const missing = (['kode', 'nama'] as const).filter(field => !row[field]?.trim());
            if (missing.length > 0) {
                errors.push({ row: row.rowNumber, message: `Kolom wajib kosong: ${missing.join(', ')}` });
                continue;
            }
            if (seenCodes.has(row.kode)) {
                errors.push({ row: row.rowNumber, message: `Kode duplikat di dalam file: ${row.kode}` });
                continue;
            }
            seenCodes.add(row.kode);
            validRows.push(row);
        }

        // ── 7. Batch upsert (insert new / update existing by kode) ──
        let success = 0;
        if (validRows.length > 0) {
            const { error: upsertErr } = await admin
                .from('programs')
                .upsert(
                    validRows.map(r => ({ code: r.kode, name: r.nama, school_id: user.school_id })),
                    { onConflict: 'school_id,code' },
                );

            if (upsertErr) {
                console.error('[bulk-import-programs] upsert failed:', upsertErr);
                return internalError(upsertErr);
            }
            success = validRows.length;
        }

        // ── 8. Response ───────────────────────────────────────────
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
