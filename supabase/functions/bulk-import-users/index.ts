/**
 * @file bulk-import-users/index.ts
 * @edge-function bulk-import-users
 * @version 1.2.0
 *
 * Bulk-provisions GURU/staff user accounts from a CSV file
 * during the ADMINISTRATIVE setup wizard or ongoing onboarding.
 * Re-importing an existing login_identifier (NIP/NIK) updates that
 * user's full_name instead of failing — it does NOT touch the Auth
 * account or password.
 *
 * CONTRACT:
 *   POST /functions/v1/bulk-import-users
 *   Body: text/csv (raw CSV text), columns:
 *     nama, nip_atau_nik, role_type, kode_program (optional),
 *     nama_kelas (optional, WALI_KELAS only), email (optional),
 *     teacher_code (optional, GURU only — auto-generated from nama
 *     initials when left blank)
 *   Caller must be authenticated as role_type = ADMINISTRATIVE.
 *
 * PROCESSING SEQUENCE:
 *   1.  CORS preflight
 *   2.  Schema version check
 *   3.  Auth: verify JWT + resolve user row
 *   4.  Authorization: caller must be ADMINISTRATIVE
 *   5.  Parse CSV body
 *   6.  Validate each row (role_type valid, identifier present)
 *   7.  Resolve kode_program -> program_id (per programs.code)
 *   8.  Resolve nama_kelas -> wali_kelas_class_id (per classes.name +
 *       school_config.current_academic_year) — only for rows that
 *       provide nama_kelas
 *   9.  Batch existing-identifier check (within file + against DB)
 *  9b.  Resolve teacher_code for GURU rows: use CSV value (trim,
 *       uppercase) if provided; otherwise auto-generate from nama
 *       initials (unique within this batch) — but only for rows that
 *       will be newly inserted. Existing (re-import) rows with a blank
 *       teacher_code column are left untouched, not auto-filled.
 *  10.  For each existing identifier: UPDATE users.full_name only
 *       (and teacher_code if a new non-blank value was provided — no
 *       Auth/password change). For each new identifier: Supabase
 *       Auth createUser + insert into users.
 *  11.  Response: { total, success, updated, failed, errors[] }
 *
 * IDENTIFIER -> EMAIL MAPPING:
 *   Staff roles (GURU, BK, WALI_KELAS, KAPRODI, KEPSEK, ADMINISTRATIVE)
 *   use identifier_type = NIP. DUDI uses NAMA_USAHA (slug of `nama`).
 *   If the CSV provides an explicit `email`, it is used for Auth
 *   sign-in/notifications instead of the generated internal email,
 *   but login_identifier (NIP/NIK) remains the source of truth for login.
 *
 * WHY NOT supabase-js .upsert() HERE:
 *   .upsert(onConflict: 'login_identifier') would need to submit a full
 *   row (auth_user_id, email, identifier_type, role_type, ...) to satisfy
 *   NOT NULL columns on the INSERT branch, and PostgREST's generated
 *   ON CONFLICT DO UPDATE sets every submitted column — there's no way
 *   to upsert-but-only-touch-full_name with a single .upsert() call.
 *   Splitting into an explicit create-vs-update branch (as below) is the
 *   only way to satisfy "ON CONFLICT DO UPDATE SET full_name only" while
 *   leaving role_type/email/program_id/wali_kelas_class_id untouched on
 *   existing rows.
 */

import { handleCors, corsHeaders }     from '../_shared/cors.ts';
import { ok, badRequest, unauthorized,
         forbidden, internalError,
         checkSchemaVersion }          from '../_shared/response.ts';
import { resolveAuth, isAuthError }    from '../_shared/auth.ts';
import { getAdminClient }              from '../_shared/db.ts';
import { parseCsv }                    from '../_shared/csv.ts';
import { toInternalEmail, IdentifierType } from '../_shared/identifier.ts';
import { ROLE_TYPE }                   from '../_shared/validate.ts';

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────

interface ImportRow {
    rowNumber:        number;
    nama:              string;
    nip_atau_nik:      string;
    role_type:         string;
    kode_program?:     string;
    program_id?:       string;
    nama_kelas?:       string;
    wali_kelas_class_id?: string;
    email?:            string;
    teacher_code?:     string;
    // Multi-role fields
    wali_kelas?:       string;    // nama kelas walian
    program_kaprodi?:  string;    // kode program untuk kaprodi
    kaprodi_program_id?: string;  // resolved
    jabatan?:          string;    // comma-separated: BK, KEPSEK, WAKA_KURIKULUM, WAKA_KESISWAAN, WAKA_HUMAS
    is_bk?:            boolean;
    is_kepsek?:        boolean;
    is_waka_kurikulum?: boolean;
    is_waka_kesiswaan?: boolean;
    is_waka_humas?:    boolean;
    allow_parallel_teaching?: boolean;
    mengajar?:         boolean;
}

interface ImportError {
    row:     number;
    message: string;
}

interface ImportedUser {
    row:              number;
    login_identifier: string;
    full_name:        string;
    role_type:        string;
    temp_password:    string;
}

const STAFF_ROLES = ROLE_TYPE.filter(
    r => !['SISWA', 'ORTU', 'ADMINISTRATIVE'].includes(r)
);

function generateTempPassword(): string {
    return '12345678';
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
            return forbidden('Hanya akun ADMINISTRATIVE yang dapat melakukan impor pengguna massal');
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

        const rows: ImportRow[] = rawRows.map((r, i) => {
            const jabatan = (r.jabatan ?? '').toUpperCase().split(',').map((s: string) => s.trim()).filter(Boolean);
            const mengajar = (r.mengajar ?? '').toUpperCase().trim() === 'YA';
            // role_type: jabatan spesifik menang atas mengajar (BK yang mengajar tetap BK)
            let roleType = (r.role_type ?? '').toUpperCase();
            if (!roleType) {
                if (jabatan.includes('KEPSEK')) roleType = 'KEPSEK';
                else if (jabatan.includes('WAKA_KURIKULUM')) roleType = 'WAKA_KURIKULUM';
                else if (jabatan.includes('WAKA_KESISWAAN')) roleType = 'WAKA_KESISWAAN';
                else if (jabatan.includes('WAKA_HUMAS')) roleType = 'WAKA_HUMAS';
                else if (jabatan.includes('BK')) roleType = 'BK';
                else if (mengajar) roleType = 'GURU';
                else roleType = 'GURU';
            }
            return {
                rowNumber:    i + 2,
                nama:         r.nama ?? '',
                nip_atau_nik: r.nip_atau_nik ?? '',
                role_type:    roleType,
                kode_program: r.kode_program || undefined,
                nama_kelas:   r.nama_kelas || undefined,
                email:        r.email || undefined,
                teacher_code: r.teacher_code ?? '',
                wali_kelas:   r.wali_kelas || undefined,
                program_kaprodi: r.program_kaprodi || undefined,
                jabatan:      r.jabatan || undefined,
                is_bk:            jabatan.includes('BK'),
                is_kepsek:        jabatan.includes('KEPSEK'),
                is_waka_kurikulum: jabatan.includes('WAKA_KURIKULUM'),
                is_waka_kesiswaan: jabatan.includes('WAKA_KESISWAAN'),
                is_waka_humas:     jabatan.includes('WAKA_HUMAS'),
                allow_parallel_teaching: String(r.allow_parallel ?? '').toUpperCase() === 'YA',
                mengajar,
            };
        });

        // ── 6. Per-row structural validation ───────────────────
        const errors: ImportError[] = [];
        const validRows: ImportRow[] = [];
        const seenIdentifiers = new Set<string>();

        for (const row of rows) {
            if (!row.nama.trim()) {
                errors.push({ row: row.rowNumber, message: 'Kolom nama wajib diisi' });
                continue;
            }
            if (!row.nip_atau_nik.trim()) {
                errors.push({ row: row.rowNumber, message: 'Kolom nip_atau_nik wajib diisi' });
                continue;
            }
            if (!STAFF_ROLES.includes(row.role_type as typeof STAFF_ROLES[number])) {
                errors.push({
                    row: row.rowNumber,
                    message: `role_type tidak valid: "${row.role_type}". Harus salah satu dari [${STAFF_ROLES.join(', ')}]`,
                });
                continue;
            }
            if (seenIdentifiers.has(row.nip_atau_nik)) {
                errors.push({ row: row.rowNumber, message: `NIP/NIK duplikat di dalam file: ${row.nip_atau_nik}` });
                continue;
            }
            seenIdentifiers.add(row.nip_atau_nik);
            validRows.push(row);
        }

        // ── 7. Resolve kode_program -> program_id ──────────────
        if (validRows.length > 0) {
            const codes = [...new Set(
                validRows.map(r => r.kode_program).filter((c): c is string => !!c),
            )];

            if (codes.length > 0) {
                const { data: programs, error: programErr } = await admin
                    .from('programs')
                    .select('program_id, code')
                    .eq('school_id', user.school_id)
                    .in('code', codes);

                if (programErr) {
                    console.error('[bulk-import-users] program lookup failed:', programErr);
                    return internalError(programErr);
                }

                const programMap = new Map(
                    (programs ?? []).map((p: { program_id: string; code: string }) => [p.code, p.program_id]),
                );

                for (const row of [...validRows]) {
                    if (!row.kode_program) continue;
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
        }

        // ── 7b. Resolve program_kaprodi -> kaprodi_program_id ────
        if (validRows.length > 0) {
            const kaprodiCodes = [...new Set(
                validRows.map(r => r.program_kaprodi).filter((c): c is string => !!c),
            )];
            if (kaprodiCodes.length > 0) {
                const { data: kpPrograms } = await admin
                    .from('programs').select('program_id, code')
                    .eq('school_id', user.school_id).in('code', kaprodiCodes);
                const kpMap = new Map(
                    (kpPrograms ?? []).map((p: { program_id: string; code: string }) => [p.code, p.program_id]),
                );
                for (const row of [...validRows]) {
                    if (!row.program_kaprodi) continue;
                    const pid = kpMap.get(row.program_kaprodi);
                    if (!pid) {
                        errors.push({ row: row.rowNumber, message: `Kode program kaprodi tidak ditemukan: "${row.program_kaprodi}"` });
                        validRows.splice(validRows.indexOf(row), 1);
                        continue;
                    }
                    row.kaprodi_program_id = pid;
                }
            }
        }

        // ── 8. Resolve wali_kelas/nama_kelas -> wali_kelas_class_id ──
        if (validRows.length > 0) {
            // wali_kelas column takes priority over legacy nama_kelas
            for (const row of validRows) {
                if (row.wali_kelas && !row.nama_kelas) row.nama_kelas = row.wali_kelas;
            }

            const classNames = [...new Set(
                validRows
                    .map(r => r.nama_kelas?.trim().toUpperCase())
                    .filter((c): c is string => !!c),
            )];

            if (classNames.length > 0) {
                const { data: schoolConfig, error: configErr } = await admin
                    .from('school_config')
                    .select('current_academic_year')
                    .eq('school_id', user.school_id)
                    .maybeSingle();

                if (configErr) {
                    console.error('[bulk-import-users] school_config lookup failed:', configErr);
                    return internalError(configErr);
                }
                if (!schoolConfig?.current_academic_year) {
                    return badRequest(
                        'Tahun ajaran aktif belum diset. ' +
                        'Selesaikan Tahap 1 (Data Sekolah) di wizard setup terlebih dahulu.'
                    );
                }

                const { data: authYear } = await admin.rpc('fn_current_academic_year', { p_school_id: user.school_id });
                const resolvedAcademicYear = (authYear as string) || schoolConfig.current_academic_year;

                // Fetch semua kelas lalu normalize name untuk perbandingan
                const { data: classes, error: classErr } = await admin
                    .from('classes')
                    .select('class_id, name')
                    .eq('school_id', user.school_id)
                    .eq('academic_year', resolvedAcademicYear);

                if (classErr) {
                    console.error('[bulk-import-users] class lookup failed:', classErr);
                    return internalError(classErr);
                }

                // Map dengan key ter-normalize (uppercase + trim)
                const classMap = new Map(
                    (classes ?? []).map((c: { class_id: string; name: string }) => [
                        c.name.trim().toUpperCase(),
                        c.class_id,
                    ]),
                );

                for (const row of [...validRows]) {
                    if (!row.nama_kelas) continue;
                    const normalized = row.nama_kelas.trim().toUpperCase();
                    const classId = classMap.get(normalized);
                    if (!classId) {
                        errors.push({
                            row: row.rowNumber,
                            message: `Kelas "${row.nama_kelas}" tidak ditemukan untuk tahun ajaran ${resolvedAcademicYear}. ` +
                                     `Pastikan nama kelas sesuai dengan data di Tahap 3.`,
                        });
                        validRows.splice(validRows.indexOf(row), 1);
                        continue;
                    }
                    row.wali_kelas_class_id = classId;
                }
            }
        }

        // ── 9. Batch existing-identifier check against DB ──────
        let existingSet = new Set<string>();
        if (validRows.length > 0) {
            const { data: existing, error: dupErr } = await admin.rpc(
                'fn_check_identifiers_exist',
                { p_identifiers: validRows.map(r => r.nip_atau_nik), p_school_id: user.school_id },
            );

            if (dupErr) {
                console.error('[bulk-import-users] existing-identifier check failed:', dupErr);
                return internalError(dupErr);
            }

            existingSet = new Set((existing as string[] | null) ?? []);
        }

        // ── 9c. Singleton jabatan check ────────────────────────
        // Jabatan KEPSEK/WAKA_* hanya boleh 1 orang aktif per sekolah.
        // Dilakukan SETELAH existingSet terisi agar baris re-impor
        // (identifier sudah ada di DB) tidak dihitung sebagai "baru".
        if (validRows.length > 0) {
            type SFEntry = { fileRows: ImportRow[] };
            const singletonFlags: Record<string, SFEntry> = {
                KEPSEK:         { fileRows: [] },
                WAKA_KURIKULUM: { fileRows: [] },
                WAKA_KESISWAAN: { fileRows: [] },
                WAKA_HUMAS:     { fileRows: [] },
            };
            for (const row of validRows) {
                if (row.role_type === 'KEPSEK'         || row.is_kepsek)         singletonFlags['KEPSEK'].fileRows.push(row);
                if (row.role_type === 'WAKA_KURIKULUM' || row.is_waka_kurikulum) singletonFlags['WAKA_KURIKULUM'].fileRows.push(row);
                if (row.role_type === 'WAKA_KESISWAAN' || row.is_waka_kesiswaan) singletonFlags['WAKA_KESISWAAN'].fileRows.push(row);
                if (row.role_type === 'WAKA_HUMAS'     || row.is_waka_humas)     singletonFlags['WAKA_HUMAS'].fileRows.push(row);
            }

            // Apakah ada jabatan singleton yang memiliki baris BARU (bukan re-impor)?
            const hasSingletonNew = Object.values(singletonFlags)
                .some(({ fileRows }) => fileRows.some(r => !existingSet.has(r.nip_atau_nik)));

            if (hasSingletonNew) {
                // Ambil semua user aktif & tidak terhapus, filter di app (satu query)
                const { data: activeUsers, error: singletonErr } = await admin
                    .from('users')
                    .select('full_name, role_type, is_kepsek, is_waka_kurikulum, is_waka_kesiswaan, is_waka_humas')
                    .eq('school_id', user.school_id)
                    .eq('is_active', true)
                    .is('deleted_at', null);
                if (singletonErr) {
                    console.error('[bulk-import-users] singleton check failed:', singletonErr);
                    return internalError(singletonErr);
                }

                type UserRow = { full_name: string; role_type: string; is_kepsek: boolean; is_waka_kurikulum: boolean; is_waka_kesiswaan: boolean; is_waka_humas: boolean };
                const au = (activeUsers ?? []) as UserRow[];

                const dbWho: Record<string, string | null> = {
                    KEPSEK:         au.find(u => u.role_type === 'KEPSEK'         || u.is_kepsek)?.full_name         ?? null,
                    WAKA_KURIKULUM: au.find(u => u.role_type === 'WAKA_KURIKULUM' || u.is_waka_kurikulum)?.full_name ?? null,
                    WAKA_KESISWAAN: au.find(u => u.role_type === 'WAKA_KESISWAAN' || u.is_waka_kesiswaan)?.full_name ?? null,
                    WAKA_HUMAS:     au.find(u => u.role_type === 'WAKA_HUMAS'     || u.is_waka_humas)?.full_name     ?? null,
                };

                for (const [jabatan, { fileRows }] of Object.entries(singletonFlags)) {
                    const newRows = fileRows.filter(r => !existingSet.has(r.nip_atau_nik));
                    if (newRows.length === 0) continue;

                    // Duplikat dalam file itu sendiri (>1 baris baru untuk jabatan ini)
                    if (newRows.length > 1) {
                        for (const r of newRows.slice(1)) {
                            errors.push({
                                row: r.rowNumber,
                                message: `Duplikat ${jabatan} dalam file: baris ${newRows[0].rowNumber} (${newRows[0].nama}) sudah menjadi ${jabatan}. Setiap sekolah hanya boleh memiliki satu pemegang jabatan ini.`,
                            });
                            validRows.splice(validRows.indexOf(r), 1);
                        }
                    }

                    // Konflik dengan DB: jabatan sudah dipegang orang lain
                    if (dbWho[jabatan]) {
                        for (const r of newRows.slice(0, 1)) {
                            errors.push({
                                row: r.rowNumber,
                                message: `Konflik ${jabatan}: sekolah ini sudah memiliki "${dbWho[jabatan]}" sebagai ${jabatan}. Nonaktifkan atau hapus pemegang lama sebelum mengimpor pengganti.`,
                            });
                            validRows.splice(validRows.indexOf(r), 1);
                        }
                    }
                }
            }
        }

        // ── 9a. Deteksi identifier yang sedang di Recycle Bin (soft-deleted) ──
        // Re-impor / tambah-ulang identifier yang masih ada di DB tapi terhapus
        // sementara HARUS memulihkannya (undelete + unban Auth), bukan sekadar
        // update senyap yang meninggalkannya tetap tersembunyi. Peta ini dipakai
        // di step 10 untuk membangkitkan baris + membatalkan ban akun Auth.
        const revivedAuthByIdentifier = new Map<string, string | null>();
        if (existingSet.size > 0) {
            const { data: softDeleted, error: sdErr } = await admin
                .from('users')
                .select('login_identifier, auth_user_id')
                .eq('school_id', user.school_id)
                .in('login_identifier', [...existingSet])
                .not('deleted_at', 'is', null);
            if (sdErr) {
                console.error('[bulk-import-users] soft-deleted lookup failed:', sdErr);
                return internalError(sdErr);
            }
            for (const r of (softDeleted ?? []) as { login_identifier: string; auth_user_id: string | null }[]) {
                revivedAuthByIdentifier.set(r.login_identifier, r.auth_user_id);
            }
        }

        // ── 9b. Resolve teacher_code untuk baris GURU ───────────
        const usedTeacherCodes = new Set<string>();
        for (const row of validRows) {
            if (row.role_type !== 'GURU') continue;
            const provided = row.teacher_code?.trim().toUpperCase();
            if (provided) usedTeacherCodes.add(provided);
        }

        for (const row of validRows) {
            if (row.role_type !== 'GURU' && !row.mengajar) {
                row.teacher_code = undefined;
                continue;
            }

            const provided = row.teacher_code?.trim().toUpperCase();
            if (provided) {
                row.teacher_code = provided;
                continue;
            }

            if (existingSet.has(row.nip_atau_nik)) {
                // Re-import tanpa teacher_code baru di CSV — jangan timpa
                // nilai yang sudah ada di DB.
                row.teacher_code = undefined;
                continue;
            }

            const parts = row.nama.split(' ').filter(Boolean);
            const base  = parts.map(p => p[0]).join('').toUpperCase().slice(0, 4);

            let candidate = base;
            let suffix = 1;
            while (usedTeacherCodes.has(candidate)) {
                candidate = `${base}${String(suffix).padStart(2, '0')}`;
                suffix++;
            }

            row.teacher_code = candidate;
            usedTeacherCodes.add(candidate);
        }

        // ── 10. Update existing users / provision new ones ──────
        const imported: ImportedUser[] = [];
        let updated = 0;

        for (const row of validRows) {
            if (existingSet.has(row.nip_atau_nik)) {
                // Existing account — update full_name only. Auth/password
                // and wali_kelas_class_id are intentionally left untouched.
                const updatePatch: Record<string, unknown> = {
                    full_name: row.nama,
                    role_type: row.role_type,
                };
                if (row.teacher_code) updatePatch.teacher_code = row.teacher_code;
                if (!row.teacher_code && row.role_type !== 'GURU' && !row.mengajar) updatePatch.teacher_code = null;
                if (row.wali_kelas_class_id) updatePatch.wali_kelas_class_id = row.wali_kelas_class_id;
                if (row.kaprodi_program_id) updatePatch.kaprodi_program_id = row.kaprodi_program_id;
                updatePatch.is_bk = row.is_bk ?? false;
                updatePatch.is_kepsek = row.is_kepsek ?? false;
                updatePatch.is_waka_kurikulum = row.is_waka_kurikulum ?? false;
                updatePatch.is_waka_kesiswaan = row.is_waka_kesiswaan ?? false;
                updatePatch.is_waka_humas = row.is_waka_humas ?? false;
                updatePatch.allow_parallel_teaching = row.allow_parallel_teaching ?? false;

                // Bangkitkan baris yang ada di Recycle Bin: undelete + reaktifkan.
                // Tanpa ini, re-impor/tambah-ulang hanya meng-update baris terhapus
                // secara senyap dan datanya tetap tak muncul (bug yang membingungkan).
                // Hanya berlaku untuk baris SOFT-DELETED — yang sekadar dinonaktifkan
                // sengaja (is_active=false tanpa deleted_at) tidak disentuh.
                const isRevived = revivedAuthByIdentifier.has(row.nip_atau_nik);
                if (isRevived) {
                    updatePatch.deleted_at = null;
                    updatePatch.is_active  = true;
                }

                const { error: updateErr } = await admin
                    .from('users')
                    .update(updatePatch)
                    .eq('login_identifier', row.nip_atau_nik)
                    .eq('school_id', user.school_id);

                if (updateErr) {
                    errors.push({
                        row: row.rowNumber,
                        message: `Gagal memperbarui data pengguna: ${updateErr.message}`,
                    });
                    continue;
                }

                // Un-ban akun Auth yang di-ban saat soft-delete, agar bisa login lagi.
                if (isRevived) {
                    const authId = revivedAuthByIdentifier.get(row.nip_atau_nik);
                    if (authId) {
                        const { error: unbanErr } = await admin.auth.admin
                            .updateUserById(authId, { ban_duration: 'none' });
                        if (unbanErr && !unbanErr.message?.includes('not found') && !unbanErr.message?.includes('User not found')) {
                            // Baris DB sudah dipulihkan; kegagalan unban tidak fatal
                            // (admin bisa reset dari Recycle Bin). Catat saja.
                            console.error(`[bulk-import-users] unban saat revive gagal untuk ${row.nip_atau_nik}:`, unbanErr);
                        }
                    }
                }
                updated++;
                continue;
            }

            const identifierType: IdentifierType = row.role_type === 'DUDI' ? 'NAMA_USAHA'
                : row.role_type === 'STAKEHOLDER' ? 'KODE_KHUSUS' : 'NIP';
            // Email internal HARUS di-namespace dengan school_id prefix: Auth Supabase
            // bersifat GLOBAL antar-sekolah, sedangkan NIP tidak unik lintas-sekolah
            // (dua sekolah bisa punya guru ber-NIP sama, mis. mengajar di dua tempat,
            // atau NIP placeholder). Tanpa prefix, createUser sekolah kedua gagal
            // "email already registered" dan guru itu senyap tak terbuat. Login tetap
            // aman karena fn_resolve_login_email membaca email dari baris users
            // berdasarkan (login_identifier, school_id) — bukan merangkai ulang di klien.
            const schoolPrefix  = user.school_id.replace(/-/g, '').substring(0, 8);
            const internalEmail  = row.email ?? (
                row.role_type === 'STAKEHOLDER'
                    ? `${row.nip_atau_nik.trim().toLowerCase()}@${schoolPrefix}.stakeholder`
                    : toInternalEmail(
                        identifierType === 'NAMA_USAHA' ? row.nama : row.nip_atau_nik,
                        identifierType,
                        user.school_id,
                    )
            );
            // Semua role termasuk STAKEHOLDER: password acak terpisah dari kode login.
            // Kode (login_identifier) = identitas, password = rahasia yang berbeda.
            // Wizard menampilkan keduanya sekali kepada admin setelah berhasil dibuat.
            const tempPassword = generateTempPassword();

            const { data: authUser, error: authErr } = await admin.auth.admin.createUser({
                email:         internalEmail,
                password:      tempPassword,
                email_confirm: true,
            });

            if (authErr || !authUser?.user) {
                errors.push({
                    row: row.rowNumber,
                    message: `Gagal membuat akun Auth: ${authErr?.message ?? 'unknown error'}`,
                });
                continue;
            }

            const { error: insertErr } = await admin.from('users').insert({
                auth_user_id:        authUser.user.id,
                full_name:           row.nama,
                email:               internalEmail,
                login_identifier:    row.nip_atau_nik,
                identifier_type:     identifierType,
                role_type:           row.role_type,
                school_id:           user.school_id,
                program_id:          row.program_id ?? null,
                wali_kelas_class_id: row.wali_kelas_class_id ?? null,
                dudi_org_name:       row.role_type === 'DUDI' ? row.nama : null,
                teacher_code:        row.teacher_code ?? null,
                kaprodi_program_id:  row.kaprodi_program_id ?? null,
                is_bk:               row.is_bk ?? false,
                is_kepsek:           row.is_kepsek ?? false,
                is_waka_kurikulum:   row.is_waka_kurikulum ?? false,
                is_waka_kesiswaan:   row.is_waka_kesiswaan ?? false,
                is_waka_humas:       row.is_waka_humas ?? false,
                allow_parallel_teaching: row.allow_parallel_teaching ?? false,
                must_change_password: true,
            });

            if (insertErr) {
                // Roll back the orphaned Auth user so retries don't collide
                await admin.auth.admin.deleteUser(authUser.user.id);
                errors.push({
                    row: row.rowNumber,
                    message: `Gagal menyimpan data pengguna: ${insertErr.message}`,
                });
                continue;
            }

            imported.push({
                row:              row.rowNumber,
                login_identifier: row.nip_atau_nik,
                full_name:        row.nama,
                role_type:        row.role_type,
                temp_password:    tempPassword,
            });
        }

        // ── 11. Response ──────────────────────────────────────
        return ok({
            total:   rows.length,
            success: imported.length,
            updated,
            failed:  rows.length - imported.length - updated,
            errors,
            imported, // includes temp_password — show once to admin, then discard
        });

    } catch (err) {
        return internalError(err);
    }
});
