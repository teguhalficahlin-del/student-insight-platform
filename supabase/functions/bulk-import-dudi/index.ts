/**
 * @file bulk-import-dudi/index.ts
 * @edge-function bulk-import-dudi
 * @version 1.0.0
 *
 * Bulk-provisions DUDI (industry partner) accounts. Unlike staff/students,
 * DUDI logs in with its organization name, not an NIK — login_identifier
 * is a slug of nama_usaha, identifier_type='NAMA_USAHA'.
 *
 * CONTRACT:
 *   POST /functions/v1/bulk-import-dudi
 *   Body: text/csv (raw CSV text), columns: nama_usaha, nama_penanggung_jawab
 *   Caller must be authenticated as role_type = ADMINISTRATIVE.
 *
 * PROCESSING SEQUENCE:
 *   1.  CORS preflight
 *   2.  Schema version check
 *   3.  Auth: verify JWT + resolve user row
 *   4.  Authorization: caller must be ADMINISTRATIVE
 *   5.  Parse CSV body
 *   6.  Validate each row (nama_usaha/nama_penanggung_jawab present)
 *   7.  Fetch existing DUDI login_identifiers (slugs) for duplicate check
 *   8.  Per row, in order:
 *       a. base slug = generateSlug(nama_usaha)
 *       b. if base slug already exists in DB -> re-import:
 *          update full_name + dudi_org_name, reuse existing user_id
 *       c. else -> resolve collision against DB + slugs already
 *          assigned earlier in this same batch, get a unique slug
 *   9.  For each row needing a NEW account: create Auth user
 *       (email={slug}@dudi.internal, password={slug}!SMK) + insert
 *       into users (role_type=DUDI, dudi_org_name=nama_usaha)
 *  10.  Response: { total, success, skipped, failed, errors[] }
 *
 * RESPONSE FIELD MEANING (mutually exclusive partition of `total`):
 *   success — row processed with a NEWLY created DUDI account
 *   updated — row processed, existing DUDI account updated (nama/PJ)
 *   failed  — row could not be processed (validation/creation error)
 */

import { handleCors, corsHeaders }     from '../_shared/cors.ts';
import { ok, badRequest,
         forbidden, internalError,
         checkSchemaVersion }          from '../_shared/response.ts';
import { resolveAuth, isAuthError }    from '../_shared/auth.ts';
import { getAdminClient }              from '../_shared/db.ts';
import { parseCsv }                    from '../_shared/csv.ts';
import { generateSlug, resolveCollision } from '../_shared/identifier.ts';

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

interface ImportRow {
    rowNumber:              number;
    nama_usaha:             string;
    nama_penanggung_jawab:  string;
    slug?:                  string;
    isNew?:                 boolean;
    userId?:                string;
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
            return forbidden('Hanya akun ADMINISTRATIVE yang dapat melakukan impor DUDI massal');
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
            rowNumber:             i + 2,
            nama_usaha:            r.nama_usaha ?? '',
            nama_penanggung_jawab: r.nama_penanggung_jawab ?? '',
        }));

        // ── 6. Structural validation ────────────────────────────
        const errors: ImportError[] = [];
        const validRows: ImportRow[] = [];

        for (const row of rows) {
            const missing = (['nama_usaha', 'nama_penanggung_jawab'] as const)
                .filter(field => !row[field]?.trim());
            if (missing.length > 0) {
                errors.push({ row: row.rowNumber, message: `Kolom wajib kosong: ${missing.join(', ')}` });
                continue;
            }
            validRows.push(row);
        }

        // ── 7. Fetch existing DUDI login_identifiers (slugs) ───
        const { data: existingDudi, error: dudiErr } = await admin
            .from('users')
            .select('user_id, login_identifier')
            .eq('role_type', 'DUDI');

        if (dudiErr) {
            console.error('[bulk-import-dudi] existing DUDI lookup failed:', dudiErr);
            return internalError(dudiErr);
        }

        const slugToUserId = new Map(
            (existingDudi ?? []).map((u: { user_id: string; login_identifier: string }) => [u.login_identifier, u.user_id]),
        );
        const knownSlugs = new Set(slugToUserId.keys());

        // ── 8. Resolve slug per row (duplicate-check, then collision) ──
        for (const row of validRows) {
            const baseSlug = generateSlug(row.nama_usaha);

            if (knownSlugs.has(baseSlug)) {
                // Idempotent re-import: same organization already provisioned.
                row.slug   = baseSlug;
                row.isNew  = false;
                row.userId = slugToUserId.get(baseSlug);
                continue;
            }

            // New organization — resolve collision against everything seen
            // so far (existing DB slugs + slugs already claimed by earlier
            // rows in this same batch).
            const finalSlug = resolveCollision(baseSlug, [...knownSlugs]);
            knownSlugs.add(finalSlug);
            row.slug  = finalSlug;
            row.isNew = true;
        }

        // ── 9a. Update existing organizations ────────────────────
        let updated = 0;
        const failedRowNumbers = new Set<number>();

        for (const row of validRows) {
            if (row.isNew) continue;

            const { error: updateErr } = await admin
                .from('users')
                .update({
                    full_name:     row.nama_penanggung_jawab,
                    dudi_org_name: row.nama_usaha,
                })
                .eq('user_id', row.userId);

            if (updateErr) {
                errors.push({ row: row.rowNumber, message: `Gagal memperbarui DUDI: ${updateErr.message}` });
                failedRowNumbers.add(row.rowNumber);
                continue;
            }
            updated++;
        }

        // ── 9b. Create accounts for new organizations ────────────

        for (const row of validRows) {
            if (!row.isNew) continue;

            const internalEmail = `${row.slug}@dudi.internal`;
            const password      = `${row.slug}!SMK`;

            const { data: authUser, error: authErr } = await admin.auth.admin.createUser({
                email:         internalEmail,
                password:      password,
                email_confirm: true,
            });

            if (authErr || !authUser?.user) {
                errors.push({ row: row.rowNumber, message: `Gagal membuat akun Auth: ${authErr?.message ?? 'unknown error'}` });
                failedRowNumbers.add(row.rowNumber);
                continue;
            }

            const { data: insertedUser, error: insertErr } = await admin
                .from('users')
                .insert({
                    auth_user_id:     authUser.user.id,
                    full_name:        row.nama_penanggung_jawab,
                    email:            internalEmail,
                    login_identifier: row.slug,
                    identifier_type:  'NAMA_USAHA',
                    role_type:        'DUDI',
                    dudi_org_name:    row.nama_usaha,
                })
                .select('user_id')
                .single();

            if (insertErr || !insertedUser) {
                // Roll back the orphaned Auth user so retries don't collide
                await admin.auth.admin.deleteUser(authUser.user.id);
                errors.push({ row: row.rowNumber, message: `Gagal menyimpan data DUDI: ${insertErr?.message ?? 'unknown error'}` });
                failedRowNumbers.add(row.rowNumber);
                continue;
            }

            row.userId = insertedUser.user_id;
        }

        // ── 10. Response ─────────────────────────────────────────
        let success = 0;
        for (const row of validRows) {
            if (failedRowNumbers.has(row.rowNumber)) continue;
            if (row.isNew) success++;
        }

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
