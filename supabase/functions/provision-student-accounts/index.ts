/**
 * @file provision-student-accounts/index.ts
 * @edge-function provision-student-accounts
 * @version 1.0.0
 *
 * Membuatkan akun login SISWA untuk siswa yang SUDAH ada di tabel
 * `students` tapi belum punya akun (students.user_id IS NULL).
 * Berbeda dari bulk-import-students (yang mengimpor siswa BARU dari
 * CSV) — fungsi ini hanya menambah akun + menautkannya ke baris
 * students yang sudah ada.
 *
 * Untuk tiap siswa tanpa user_id:
 *   - email   = {nis}@siswa.internal   (toInternalEmail)
 *   - password= {nis}!SMK              (sama pola dgn ORTU/DUDI)
 *   - users   : role_type=SISWA, login_identifier=nis, identifier_type=NIS
 *   - students.user_id := user_id baru
 *
 * IDEMPOTEN & BATCHED:
 *   - Hanya memproses siswa user_id IS NULL → aman dijalankan ulang.
 *   - Jika baris users login_identifier=nis sudah ada (sisa run gagal
 *     sebelumnya), gunakan ulang user_id itu lalu cukup tautkan.
 *   - Memproses maksimal `limit` siswa per panggilan (default 200,
 *     cap 400) agar tidak kena timeout. Kembalikan `remaining` agar
 *     UI bisa memanggil berulang sampai 0.
 *
 * CONTRACT:
 *   POST /functions/v1/provision-student-accounts
 *   Body (opsional JSON): { "limit": number }
 *   Caller harus authenticated sebagai role_type = ADMINISTRATIVE.
 *   Response: { total_unlinked, processed, created, linked_existing,
 *               failed, remaining, errors[] }
 */

import { handleCors, corsHeaders }     from '../_shared/cors.ts';
import { ok, forbidden, internalError,
         checkSchemaVersion }          from '../_shared/response.ts';
import { resolveAuth, isAuthError }    from '../_shared/auth.ts';
import { getAdminClient }              from '../_shared/db.ts';
import { toInternalEmail }             from '../_shared/identifier.ts';

interface StudentRow {
    student_id: string;
    nis:        string;
    full_name:  string;
}

interface ProvisionError {
    nis:     string;
    message: string;
}

const DEFAULT_LIMIT = 200;
const MAX_LIMIT      = 400;

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
            return forbidden('Hanya akun ADMINISTRATIVE yang dapat membuat akun siswa massal');
        }

        // ── Tentukan ukuran batch ───────────────────────────────
        let limit = DEFAULT_LIMIT;
        try {
            const body = await req.json();
            if (body && typeof body.limit === 'number' && body.limit > 0) {
                limit = Math.min(Math.floor(body.limit), MAX_LIMIT);
            }
        } catch { /* body kosong/ bukan JSON → pakai default */ }

        // ── Hitung total siswa belum punya akun (progress) ──────
        const { count: totalUnlinked, error: countErr } = await admin
            .from('students')
            .select('student_id', { count: 'exact', head: true })
            .eq('school_id', user.school_id)
            .is('user_id', null);
        if (countErr) return internalError(countErr);

        // ── Ambil satu batch siswa belum tertaut ────────────────
        const { data: students, error: stuErr } = await admin
            .from('students')
            .select('student_id, nis, full_name')
            .eq('school_id', user.school_id)
            .is('user_id', null)
            .order('nis')
            .limit(limit);
        if (stuErr) return internalError(stuErr);

        const batch = (students ?? []) as StudentRow[];
        const errors: ProvisionError[] = [];
        const createdAccounts: { nis: string; full_name: string; temp_password: string }[] = [];
        let created        = 0;
        let linkedExisting = 0;

        if (batch.length > 0) {
            // Reuse akun yatim (users.login_identifier = nis) bila ada
            const nisList = batch.map(s => s.nis);
            const { data: existingUsers, error: euErr } = await admin
                .from('users')
                .select('user_id, login_identifier')
                .eq('school_id', user.school_id)   // WAJIB: NIS lokal per-sekolah,
                .in('login_identifier', nisList);  // tanpa ini bisa tertaut akun sekolah lain
            if (euErr) return internalError(euErr);

            const nisToUserId = new Map<string, string>(
                (existingUsers ?? []).map((u: { user_id: string; login_identifier: string }) =>
                    [u.login_identifier, u.user_id]),
            );

            for (const s of batch) {
                if (!s.nis?.trim()) {
                    errors.push({ nis: s.nis ?? '(kosong)', message: 'NIS kosong, dilewati' });
                    continue;
                }

                // 1. Akun sudah ada (yatim) → cukup tautkan
                let userId = nisToUserId.get(s.nis) ?? null;

                // 2. Belum ada → buat Auth user + baris users
                if (!userId) {
                    let internalEmail: string;
                    try {
                        internalEmail = toInternalEmail(s.nis, 'NIS', user.school_id);
                    } catch (e) {
                        errors.push({ nis: s.nis, message: `NIS tidak valid: ${(e as Error).message}` });
                        continue;
                    }

                    const tempPassword = '12345678';

                    const { data: authUser, error: authErr } = await admin.auth.admin.createUser({
                        email:         internalEmail,
                        password:      tempPassword,
                        email_confirm: true,
                    });
                    if (authErr || !authUser?.user) {
                        errors.push({ nis: s.nis, message: `Gagal buat akun auth: ${authErr?.message ?? 'unknown'}` });
                        continue;
                    }

                    const { data: insertedUser, error: insErr } = await admin
                        .from('users')
                        .insert({
                            auth_user_id:      authUser.user.id,
                            full_name:         s.full_name,
                            email:             internalEmail,
                            login_identifier:  s.nis,
                            identifier_type:   'NIS',
                            role_type:         'SISWA',
                            school_id:         user.school_id,
                            must_change_password: true,
                        })
                        .select('user_id')
                        .single();

                    if (insErr || !insertedUser) {
                        // Rollback Auth user yatim agar retry tak bentrok
                        await admin.auth.admin.deleteUser(authUser.user.id);
                        errors.push({ nis: s.nis, message: `Gagal insert users: ${insErr?.message ?? 'unknown'}` });
                        continue;
                    }
                    userId = insertedUser.user_id;
                    createdAccounts.push({ nis: s.nis, full_name: s.full_name, temp_password: tempPassword });
                }

                // 3. Tautkan ke students
                const { error: linkErr } = await admin
                    .from('students')
                    .update({ user_id: userId })
                    .eq('student_id', s.student_id);
                if (linkErr) {
                    errors.push({ nis: s.nis, message: `Gagal menautkan ke siswa: ${linkErr.message}` });
                    continue;
                }

                if (nisToUserId.has(s.nis)) linkedExisting++;
                else created++;
            }
        }

        const processed = created + linkedExisting;
        const remaining = Math.max((totalUnlinked ?? 0) - processed, 0);

        return ok({
            total_unlinked:  totalUnlinked ?? 0,
            processed,
            created,
            linked_existing: linkedExisting,
            failed:          errors.length,
            remaining,
            errors,
            created_accounts: createdAccounts, // temp_password per akun baru — tampilkan sekali ke admin
        });

    } catch (err) {
        return internalError(err);
    }
});
