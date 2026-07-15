/**
 * @file admin/js/api.js
 *
 * Single wrapper for every Supabase / Edge Function call used by
 * the admin console. All other admin/js files go through here —
 * they never call supabase-js or fetch() directly.
 *
 * CONFIG:
 *   Fill in SUPABASE_URL and SUPABASE_ANON_KEY below before
 *   deploying. These are public (anon) values — safe to ship in
 *   client code; RLS enforces actual access control server-side.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL      = 'https://xovvuuwexoweoqyltepq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhvdnZ1dXdleG93ZW9xeWx0ZXBxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMDk0NzUsImV4cCI6MjA5Nzc4NTQ3NX0.mFwmVfSqYM7ITURtLC143BsurK6Yr31WFViJe5PFGN8';
export { SUPABASE_URL };

// Migrasi sesi dari localStorage ke sessionStorage (satu kali pasca deploy)
try {
    const _mk = 'sb-xovvuuwexoweoqyltepq-auth-token';
    const _lv = localStorage.getItem(_mk);
    if (_lv && !sessionStorage.getItem(_mk)) { sessionStorage.setItem(_mk, _lv); localStorage.removeItem(_mk); }
} catch { /* private mode */ }

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        autoRefreshToken: true,
        persistSession:   true,
        storage:          sessionStorage,
    },
});

// ─────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────

/**
 * Resolves login_identifier (NIP/NIS/NIK) -> internal email, then
 * signs in with Supabase Auth. Throws with a user-facing message
 * on failure.
 */
export async function loginWithIdentifier(identifier, password, schoolId = null) {
    const { data: email, error: resolveErr } = await supabase
        .rpc('fn_resolve_login_email', { p_identifier: identifier, p_school_id: schoolId });

    if (resolveErr) throw new Error('Gagal menghubungi server. Coba lagi.');
    if (!email) throw new Error('Identifier tidak ditemukan di sekolah ini. Hubungi superadmin jika akun belum dibuat.');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
        if (error.status === 429 || /rate limit|too many/i.test(error.message || ''))
            throw new Error('Terlalu banyak percobaan login. Tunggu ±15 menit lalu coba lagi.');
        throw new Error('Password salah. Jika baru pertama login, gunakan password sementara dari superadmin.');
    }

    return data.user;
}

export async function getCurrentUserRow(authUser = null) {
    const user = authUser ?? (await supabase.auth.getUser()).data?.user;
    if (!user) return null;

    const { data, error } = await supabase
        .from('users')
        .select('user_id, school_id, full_name, role_type, login_identifier, identifier_type, must_change_password')
        .eq('auth_user_id', user.id)
        .maybeSingle();

    if (error) throw error;
    return data;
}

export async function logout() {
    await supabase.auth.signOut();
}

/**
 * Batalkan buka tahun ajaran terakhir (4.3) via edge fn cancel-academic-year.
 * Mengembalikan school_config, hapus periode + enrollment tahun baru,
 * pulihkan enrollment tahun lama untuk siswa yang naik kelas.
 */
export async function cancelAcademicYear(configId) {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) throw new Error('Sesi login tidak ditemukan. Silakan login ulang.');

    const res = await fetch(`${SUPABASE_URL}/functions/v1/cancel-academic-year`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body:    JSON.stringify({ config_id: configId }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body?.error?.message ?? body?.message ?? 'Gagal membatalkan tahun ajaran');
    return body.data;
}

/**
 * Rekap lengkap seorang alumnus untuk dokumen/surat keterangan (10.2/10.3):
 * identitas, rekap kehadiran (per status), rekap observasi (positif/perhatian),
 * dan riwayat PKL. Semua mengecualikan entri yang di-void.
 */
export async function getAlumniRecap(studentId) {
    const [stuRes, attRes, obsRes, pklRes] = await Promise.all([
        supabase.from('students')
            .select(`full_name, nis, graduated_academic_year, graduated_at, student_status,
                program:programs ( name ),
                enrollment:class_enrollments ( academic_year, class:classes ( name ) )`)
            .eq('student_id', studentId).maybeSingle(),
        supabase.from('attendance').select('status').eq('student_id', studentId).eq('is_void', false),
        supabase.from('observations').select('sentiment').eq('student_id', studentId).eq('is_void', false),
        supabase.from('pkl_placements')
            .select('start_date, end_date, is_active, dudi_user_id')
            .eq('student_id', studentId).order('start_date', { ascending: false }),
    ]);

    if (stuRes.error) throw stuRes.error;
    const student = stuRes.data;
    if (!student) throw new Error('Data siswa tidak ditemukan.');

    const attendance = {};
    for (const r of (attRes.data ?? [])) attendance[r.status] = (attendance[r.status] ?? 0) + 1;

    let obsPositif = 0, obsPerhatian = 0;
    for (const o of (obsRes.data ?? [])) {
        if (o.sentiment === 'POSITIF') obsPositif++; else obsPerhatian++;
    }

    // Nama DUDI untuk tiap penempatan PKL (lookup terpisah agar tak bergantung nama FK)
    const placements = pklRes.data ?? [];
    const dudiIds = [...new Set(placements.map(p => p.dudi_user_id).filter(Boolean))];
    const dudiNames = {};
    if (dudiIds.length) {
        const { data: dudis } = await supabase.from('v_users_staff_directory')
            .select('user_id, full_name, dudi_org_name').in('user_id', dudiIds);
        for (const d of (dudis ?? [])) dudiNames[d.user_id] = d.dudi_org_name || d.full_name;
    }
    const pkl = placements.map(p => ({
        org:       dudiNames[p.dudi_user_id] ?? '—',
        start_date: p.start_date,
        end_date:   p.end_date,
        completed:  !p.is_active && !!p.end_date,
    }));

    return { student, attendance, obsPositif, obsPerhatian, pkl };
}

// ─────────────────────────────────────────────────────────────
// ALUMNI (10.4–10.6)
// ─────────────────────────────────────────────────────────────

/** 10.4 — Simpan jalur karir alumnus */
export async function updateAlumniCareer(studentId, track, note) {
    const { error } = await supabase
        .from('students')
        .update({ alumni_career_track: track || null, alumni_career_note: note || null })
        .eq('student_id', studentId);
    if (error) throw error;
}

/** 10.5 — Tandai siswa aktif sebagai KELUAR */
export async function markStudentKeluar(studentId, note) {
    const { error } = await supabase
        .from('students')
        .update({ student_status: 'KELUAR', keluar_at: new Date().toISOString(), keluar_note: note || null })
        .eq('student_id', studentId)
        .in('student_status', ['AKTIF', 'PKL']);
    if (error) throw error;
}

/** 10.5 — Re-enroll siswa KELUAR kembali ke AKTIF */
export async function reEnrollStudent(studentId) {
    const { error } = await supabase
        .from('students')
        .update({ student_status: 'AKTIF', keluar_at: null, keluar_note: null })
        .eq('student_id', studentId)
        .eq('student_status', 'KELUAR');
    if (error) throw error;
}

/** 10.6 — Ambil daftar alumni yang graduated_academic_year <= batas retensi */
/**
 * Daftar siswa LULUS atau KELUAR yang sudah melewati masa retensi 6 bulan.
 * Kandidat untuk penghapusan permanen (item 7).
 */
export async function getRetentionCandidates() {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 6);
    const cutoffISO = cutoff.toISOString();

    const [lulus, keluar] = await Promise.all([
        supabase
            .from('students')
            .select('student_id, full_name, nis, graduated_at, graduated_academic_year, student_status')
            .eq('student_status', 'LULUS')
            .not('graduated_at', 'is', null)
            .lt('graduated_at', cutoffISO)
            .order('graduated_at'),
        supabase
            .from('students')
            .select('student_id, full_name, nis, keluar_at, student_status')
            .eq('student_status', 'KELUAR')
            .not('keluar_at', 'is', null)
            .lt('keluar_at', cutoffISO)
            .order('keluar_at'),
    ]);

    if (lulus.error) throw lulus.error;
    if (keluar.error) throw keluar.error;
    return [...(lulus.data ?? []), ...(keluar.data ?? [])];
}

/** Hapus permanen siswa yang sudah melewati masa retensi 6 bulan. */
export async function purgeExpiredStudents(studentIds) {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) throw new Error('Sesi login tidak ditemukan. Silakan login ulang.');

    const res = await fetch(`${SUPABASE_URL}/functions/v1/purge-expired-students`, {
        method:  'DELETE',
        headers: {
            'Authorization':    `Bearer ${token}`,
            'Content-Type':     'application/json',
            'x-schema-version': '1.0.0',
        },
        body: JSON.stringify({ student_ids: studentIds }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body?.error?.message ?? 'Gagal menghapus data siswa');
    return body.data;
}

/**
 * Batalkan (void) sebuah observasi yang salah — soft-delete.
 * Baris tetap tersimpan untuk audit; disembunyikan dari siswa/ortu/DUDI
 * lewat RLS. Hanya ADMINISTRATIVE/KEPSEK yang diizinkan (RLS + di sini).
 * @param {string} observationId
 * @param {string} reason - alasan pembatalan (wajib, untuk jejak audit)
 */
export async function voidObservation(observationId, reason) {
    const me = await getCurrentUserRow();
    if (!me) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');

    const { data, error } = await supabase
        .from('observations')
        .update({
            is_void:     true,
            void_reason: reason?.trim() || null,
            voided_by:   me.user_id,
            voided_at:   new Date().toISOString(),
        })
        .eq('observation_id', observationId)
        .eq('is_void', false)   // idempoten: hanya yang belum dibatalkan
        .select('observation_id')
        .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error('Observasi tidak ditemukan atau sudah dibatalkan.');
    return data;
}

export function requireAdministrativeOrRedirect(userRow) {
    if (!userRow || userRow.role_type !== 'ADMINISTRATIVE') {
        window.location.replace('index.html');
        return false;
    }
    return true;
}

// ─────────────────────────────────────────────────────────────
// SCHOOL CONFIG
// ─────────────────────────────────────────────────────────────

export async function getSchoolConfig() {
    const { data, error } = await supabase
        .from('school_config')
        .select('*')
        .maybeSingle();
    if (error) throw error;
    return data;
}

export async function upsertSchoolConfig(patch) {
    const existing = await getSchoolConfig();
    if (existing) {
        const { data, error } = await supabase
            .from('school_config')
            .update(patch)
            .eq('config_id', existing.config_id)
            .select()
            .single();
        if (error) throw error;
        return data;
    }
    const { data, error } = await supabase
        .from('school_config')
        .insert(patch)
        .select()
        .single();
    if (error) throw error;
    return data;
}

export async function markSetupCompleted() {
    return upsertSchoolConfig({ setup_completed: true });
}

export async function updateSchoolBranding({ name, npsn, address, phone, logo_url, primary_color, secondary_color }) {
    const { error } = await supabase.rpc('fn_update_school_branding', {
        p_name:            name            ?? '',
        p_npsn:            npsn            ?? '',
        p_address:         address         ?? '',
        p_phone:           phone           ?? '',
        p_logo_url:        logo_url        ?? '',
        p_primary_color:   primary_color   ?? '',
        p_secondary_color: secondary_color ?? '',
    });
    if (error) throw error;
}

export async function getSchoolBranding() {
    const { data, error } = await supabase
        .from('schools')
        .select('name, npsn, address, phone, logo_url, primary_color, secondary_color, slug')
        .single();
    if (error) throw error;
    return data;
}

export async function changePassword(newPassword) {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
    await upsertSchoolConfig({ password_changed: true });
}

/** Admin reset password user lain. User akan diminta ganti saat login berikutnya. */
export async function adminResetUserPassword(user_id, new_password) {
    return callEdge('POST', 'set-user-password', { user_id, new_password });
}

// ─────────────────────────────────────────────────────────────
// PAGINATION
// ─────────────────────────────────────────────────────────────

/**
 * Membaca SELURUH baris yang cocok dengan men-paginasi lewat .range(),
 * menembus batas default PostgREST (db-max-rows, biasanya 1000). Tanpa ini,
 * daftar siswa/orang tua ribuan hanya tampil 1000 baris pertama dan jumlahnya
 * salah (mentok di 1000). Sekolah bisa punya ribuan siswa & orang tua, jadi
 * tidak boleh ada plafon implisit.
 *
 * @param build  (query) => query  — terima builder `supabase.from(table)`,
 *               pasang .select()/.eq()/.order() yang diperlukan, kembalikan.
 *               JANGAN pasang .range() di dalamnya; helper ini yang mengatur.
 * @param pageSize  ukuran halaman (default 1000).
 * @returns array berisi semua baris yang cocok.
 */
export async function fetchAllRows(table, build, pageSize = 1000) {
    const all = [];
    for (let from = 0; ; from += pageSize) {
        const query = build(supabase.from(table)).range(from, from + pageSize - 1);
        const { data, error } = await query;
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < pageSize) break; // halaman terakhir
    }
    return all;
}

// ─────────────────────────────────────────────────────────────
// SCHEDULE BUILDER
// ─────────────────────────────────────────────────────────────

export async function getTimeSlots(academicYear, semester, dayOfWeek) {
    const { data, error } = await supabase
        .from('schedule_time_slots')
        .select('*')
        .eq('academic_year', academicYear)
        .eq('semester', semester)
        .eq('day_of_week', dayOfWeek)
        .order('slot_number');
    if (error) throw error;
    return data ?? [];
}

export async function saveTimeSlots(academicYear, semester, dayOfWeek, slots) {
    // Hapus slot lama untuk hari ini, lalu insert baru
    const { error: delErr } = await supabase
        .from('schedule_time_slots')
        .delete()
        .eq('academic_year', academicYear)
        .eq('semester', semester)
        .eq('day_of_week', dayOfWeek);
    if (delErr) throw delErr;

    if (slots.length === 0) return;

    const rows = slots.map((s, i) => ({
        academic_year: academicYear,
        semester,
        day_of_week: dayOfWeek,
        slot_number: i + 1,
        start_time: s.start_time,
        end_time: s.end_time,
        is_break: s.is_break ?? false,
        break_label: s.break_label ?? null,
    }));

    const { error: insErr } = await supabase
        .from('schedule_time_slots').insert(rows);
    if (insErr) throw insErr;
}

export async function getScheduleTemplates(academicYear, semester, dayOfWeek) {
    return fetchAllRows('schedule_templates',
        q => q.select('template_id, start_time, end_time, class_id, teacher_id, subject_label')
              .eq('academic_year', academicYear)
              .eq('semester', semester)
              .eq('day_of_week', dayOfWeek));
}

export async function saveScheduleTemplates(academicYear, semester, dayOfWeek, templates) {
    // Hapus template lama untuk hari ini, lalu insert baru
    const { error: delErr } = await supabase
        .from('schedule_templates')
        .delete()
        .eq('academic_year', academicYear)
        .eq('semester', semester)
        .eq('day_of_week', dayOfWeek);
    if (delErr) throw delErr;

    if (templates.length === 0) return;

    const rows = templates.map(t => ({
        academic_year: academicYear,
        semester,
        day_of_week: dayOfWeek,
        start_time: t.start_time,
        end_time: t.end_time,
        class_id: t.class_id,
        teacher_id: t.teacher_id,
        subject_label: t.subject_label || null,
    }));

    const CHUNK = 200;
    for (let i = 0; i < rows.length; i += CHUNK) {
        const { error: insErr } = await supabase
            .from('schedule_templates').insert(rows.slice(i, i + CHUNK));
        if (insErr) throw insErr;
    }
}

export async function getTeacherList() {
    const { data, error } = await supabase
        .from('v_users_staff_directory')
        .select('user_id, full_name, teacher_code')
        .eq('role_type', 'GURU')
        .order('teacher_code');
    if (error) throw error;
    return data ?? [];
}

export async function getClassesByGrade(academicYear, gradeLevel) {
    const { data, error } = await supabase
        .from('classes')
        .select('class_id, name, program_id, grade_level')
        .eq('academic_year', academicYear)
        .eq('grade_level', gradeLevel)
        .order('name');
    if (error) throw error;
    return data ?? [];
}

// ─────────────────────────────────────────────────────────────
// MASTER DATA
// ─────────────────────────────────────────────────────────────

export async function getPrograms() {
    const { data, error } = await supabase.from('programs').select('*').order('name');
    if (error) throw error;
    return data;
}

export async function addProgram({ code, name }) {
    const { data, error } = await supabase.from('programs').insert({ code, name }).select().single();
    if (error) throw error;
    return data;
}

export async function getClasses(academicYear = null) {
    let query = supabase.from('classes').select('*').order('name');
    if (academicYear) query = query.eq('academic_year', academicYear);
    const { data, error } = await query;
    if (error) throw error;
    return data;
}

export async function addClass({ name, program_id, academic_year, grade_level }) {
    const { data, error } = await supabase
        .from('classes')
        .insert({ name, program_id, academic_year, grade_level })
        .select()
        .single();
    if (error) throw error;
    return data;
}

// ─────────────────────────────────────────────────────────────
// INLINE EDIT — update identifier & fields langsung dari wizard
// ─────────────────────────────────────────────────────────────

export async function updateProgram(programId, { code, name }, oldCode) {
    // Ambil kode saat ini dari DB (lebih reliable daripada oldCode dari UI)
    const { data: currentProg } = await supabase.from('programs')
        .select('code').eq('program_id', programId).single();
    const dbOldCode = currentProg?.code;

    const { error } = await supabase.from('programs')
        .update({ code, name }).eq('program_id', programId);
    if (error) throw new Error(error.message);

    // Rename kelas: coba kode dari DB, lalu kode dari UI sebagai fallback
    const codesToTry = [...new Set([dbOldCode, oldCode].filter(Boolean))];
    if (codesToTry.length === 0 || codesToTry.every(c => c === code)) return [];

    const { data: classes } = await supabase.from('classes')
        .select('class_id, name')
        .eq('program_id', programId);

    const renames = [];
    for (const c of (classes ?? [])) {
        for (const tryCode of codesToTry) {
            if (tryCode !== code && c.name.includes(tryCode)) {
                const newName = c.name.replace(new RegExp(tryCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), code);
                const { error: renameErr } = await supabase.from('classes')
                    .update({ name: newName }).eq('class_id', c.class_id);
                if (!renameErr) renames.push({ from: c.name, to: newName });
                break;
            }
        }
    }
    return renames;
}

export async function updateClass(classId, { name }) {
    const { error } = await supabase.from('classes')
        .update({ name }).eq('class_id', classId);
    if (error) throw new Error(error.message);
}

export async function updateStudent(studentId, { full_name, nis }) {
    const { error } = await supabase.from('students')
        .update({ full_name, nis }).eq('student_id', studentId);
    if (error) throw new Error(error.message);
}

export async function updateUserIdentifier(userId, fields) {
    return callEdgePatch('update-user-identifier', { user_id: userId, ...fields });
}

async function callEdgePatch(functionName, body) {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) throw new Error('Sesi login tidak ditemukan. Silakan login ulang.');

    const res = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
        method:  'PATCH',
        headers: {
            'Content-Type':     'application/json',
            'Authorization':    `Bearer ${token}`,
            'x-schema-version': '1.0.0',
        },
        body: JSON.stringify(body),
    });

    const resBody = await res.json();
    if (!res.ok) throw new Error(resBody?.error?.message ?? 'Gagal memperbarui data');
    return resBody.data;
}

// ─────────────────────────────────────────────────────────────
// EDGE FUNCTIONS — bulk import
// ─────────────────────────────────────────────────────────────

/**
 * Calls a bulk-import-* Edge Function with raw CSV text in the
 * body, authenticated with the current session's access token.
 *
 * @param functionName  'bulk-import-users' | 'bulk-import-students' | 'bulk-import-schedules'
 * @param csvText        raw CSV file contents
 */
async function callBulkImport(functionName, csvText) {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) throw new Error('Sesi login tidak ditemukan. Silakan login ulang.');

    const res = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
        method:  'POST',
        headers: {
            'Content-Type':    'text/csv',
            'Authorization':   `Bearer ${token}`,
            'x-schema-version': '1.0.0',
        },
        body: csvText,
    });

    let body;
    const rawText = await res.text();
    try { body = JSON.parse(rawText); } catch { body = null; }
    console.log('[callBulkImport] status:', res.status, 'body:', rawText.slice(0, 500));
    if (!res.ok) {
        const message = body?.error?.message ?? `HTTP ${res.status}: ${rawText.slice(0, 200)}`;
        const details = body?.error?.details ?? [];
        const err = new Error(message);
        err.details = details;
        throw err;
    }
    return body?.data ?? body;
}

export function importUsers(csvText)     { return callBulkImport('bulk-import-users', csvText); }
export function importPrograms(csvText)  { return callBulkImport('bulk-import-programs', csvText); }
export function importClasses(csvText)   { return callBulkImport('bulk-import-classes', csvText); }
export function importStudents(csvText)  { return callBulkImport('bulk-import-students', csvText); }
export function importSchedules(csvText) { return callBulkImport('bulk-import-schedules', csvText); }
export function importParents(csvText)   { return callBulkImport('bulk-import-parents', csvText); }
export function importDudi(csvText)      { return callBulkImport('bulk-import-dudi', csvText); }

/**
 * Jumlah siswa yang belum punya akun login (students.user_id IS NULL).
 */
export async function countStudentsWithoutAccount() {
    const { count, error } = await supabase
        .from('students')
        .select('student_id', { count: 'exact', head: true })
        .is('user_id', null);
    if (error) throw error;
    return count ?? 0;
}

/**
 * Buatkan akun login SISWA untuk satu batch siswa yang belum tertaut.
 * Dipanggil berulang oleh UI sampai remaining = 0.
 * Returns { total_unlinked, processed, created, linked_existing, failed, remaining, errors[] }.
 */
export async function provisionStudentAccounts(limit = 150) {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) throw new Error('Sesi login tidak ditemukan. Silakan login ulang.');

    const res = await fetch(`${SUPABASE_URL}/functions/v1/provision-student-accounts`, {
        method:  'POST',
        headers: {
            'Content-Type':     'application/json',
            'Authorization':    `Bearer ${token}`,
            'x-schema-version': '1.0.0',
        },
        body: JSON.stringify({ limit }),
    });

    const body = await res.json();
    if (!res.ok) throw new Error(body?.error?.message ?? 'Gagal membuat akun siswa');
    return body.data;
}

/**
 * Terapkan template jadwal yang sudah tersimpan menjadi teaching_schedules
 * untuk seluruh rentang academic_periods aktif.
 */
export async function reapplyScheduleTemplates() {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) throw new Error('Sesi login tidak ditemukan. Silakan login ulang.');

    const res = await fetch(`${SUPABASE_URL}/functions/v1/apply-schedule-templates?mode=reapply`, {
        method:  'POST',
        headers: {
            'Authorization':    `Bearer ${token}`,
            'x-schema-version': '1.0.0',
        },
    });

    const body = await res.json();
    if (!res.ok) throw new Error(body?.error?.message ?? 'Gagal menerapkan ulang jadwal');
    return body.data;
}

export async function applyScheduleTemplates() {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) throw new Error('Sesi login tidak ditemukan. Silakan login ulang.');

    const res = await fetch(`${SUPABASE_URL}/functions/v1/apply-schedule-templates`, {
        method:  'POST',
        headers: {
            'Authorization':    `Bearer ${token}`,
            'x-schema-version': '1.0.0',
        },
    });

    const body = await res.json();
    if (!res.ok) throw new Error(body?.error?.message ?? 'Gagal menerapkan jadwal');
    return body.data;
}

// ─────────────────────────────────────────────────────────────
// EDGE FUNCTIONS — delete / restore / purge user
// ─────────────────────────────────────────────────────────────

async function callEdge(method, functionName, body) {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) throw new Error('Sesi login tidak ditemukan. Silakan login ulang.');

    const res = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
        method,
        headers: {
            'Content-Type':     'application/json',
            'Authorization':    `Bearer ${token}`,
            'x-schema-version': '1.0.0',
        },
        body: JSON.stringify(body),
    });

    const resBody = await res.json();
    if (!res.ok) {
        throw new Error(resBody?.error?.message ?? `${functionName} gagal`);
    }
    return resBody.data;
}

/** Soft-delete user — ban Auth + set deleted_at. Bisa di-restore dalam 30 hari. */
export async function deleteUserWithAuth(user_id) {
    return callEdge('DELETE', 'delete-user', { user_id });
}

/**
 * Reset semua data siswa sekolah via SECURITY DEFINER server-side.
 * Menghapus attendance, observasi, kasus, guru_wali, dll. sebelum
 * menghapus siswa — melewati batasan RLS client-side.
 * Kembalikan { deleted_students, auth_user_ids } — pemanggil wajib
 * memanggil deleteUserWithAuth untuk tiap auth_user_id.
 */
export async function wizardResetStudents(schoolId, studentIds = null) {
    const { data, error } = await supabase.rpc('fn_wizard_reset_students', {
        p_school_id:   schoolId,
        p_student_ids: studentIds,
    });
    if (error) throw error;
    return data;
}

/**
 * Reset semua data jadwal sekolah via SECURITY DEFINER server-side.
 * Menghapus attendance/substitute terkait sesi, lalu teaching_schedules,
 * schedule_templates, dan teaching_assignments.
 */
export async function wizardResetSchedules(schoolId) {
    const { data, error } = await supabase.rpc('fn_wizard_reset_schedules', {
        p_school_id: schoolId,
    });
    if (error) throw error;
    return data;
}

/** Pulihkan user yang di-soft-delete (dalam 30 hari). */
export async function restoreUser(user_id) {
    return callEdge('POST', 'restore-user', { user_id });
}

/** Hard-delete permanen — hanya untuk user yang sudah di-soft-delete. */
export async function purgeUser(user_id) {
    return callEdge('DELETE', 'purge-user', { user_id });
}

/** Ambil daftar user yang soft-deleted di sekolah ini. */
export async function getDeletedUsers() {
    const { data, error } = await supabase
        .from('users')
        .select('user_id, full_name, login_identifier, role_type, deleted_at')
        .not('deleted_at', 'is', null)
        .order('deleted_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
}

// ─────────────────────────────────────────────────────────────
// DELETE / DEPENDENCY HELPERS
// ─────────────────────────────────────────────────────────────

const PK_COLUMNS = {
    programs:           'program_id',
    classes:            'class_id',
    users:              'user_id',
    students:           'student_id',
    teaching_schedules: 'schedule_id',
};

const DEPENDENCY_LABELS = {
    classes:              'kelas',
    students:             'siswa',
    class_enrollments:    'enrollment siswa',
    teaching_assignments: 'penugasan mengajar',
    teaching_schedules:   'sesi jadwal',
    attendance:           'record absensi',
    observations:         'catatan observasi',
    achievements:         'catatan prestasi',
    cases:                'kasus siswa',
    student_parents:      'data orang tua',
    substitute_schedules: 'jadwal guru pengganti',
    schedule_templates:   'template jadwal',
    pkl_placements:       'penempatan PKL',
    pkl_attendance:       'absensi PKL',
};

// Dependency check HANYA untuk tabel yang TIDAK di-cascade otomatis.
// Byproduct impor (class_enrollments, student_parents, teaching_assignments,
// schedule_templates) di-cascade oleh deleteBulk/edge function — JANGAN list di sini,
// karena checkDependencies akan salah menolak hapus yang seharusnya berhasil.
const DEPENDENCY_MAP = {
    programs: [
        { table: 'classes', column: 'program_id' },
        { table: 'students', column: 'program_id' },
    ],
    classes: [
        { table: 'teaching_schedules',   column: 'class_id' },
    ],
    users: [
        { table: 'teaching_schedules',   column: 'scheduled_teacher_id' },
        { table: 'substitute_schedules', column: 'substitute_user_id' },
    ],
    students: [
        { table: 'attendance',        column: 'student_id' },
        { table: 'observations',      column: 'student_id' },
        { table: 'cases',             column: 'student_id' },
        { table: 'pkl_placements',    column: 'student_id' },
        { table: 'pkl_attendance',    column: 'student_id' },
    ],
    teaching_schedules: [
        { table: 'attendance',           column: 'schedule_id' },
        { table: 'substitute_schedules', column: 'schedule_id' },
        { table: 'observations',         column: 'schedule_id' },
    ],
};

/**
 * Cek apakah record punya turunan (FK) sebelum dihapus.
 * Return { canDelete: boolean, items: [{ label, count }] }.
 */
export async function checkDependencies(table, id) {
    const deps = DEPENDENCY_MAP[table] ?? [];
    if (deps.length === 0) return { canDelete: true, items: [] };

    const results = await Promise.all(
        deps.map(({ table: depTable, column }) =>
            supabase
                .from(depTable)
                .select('*', { count: 'exact', head: true })
                .eq(column, id)
        )
    );

    const items = [];
    results.forEach(({ count, error }, i) => {
        // RLS bisa menolak SELECT pada tabel tertentu — skip, jangan crash
        if (error) {
            console.warn(`[checkDependencies] ${deps[i].table}:`, error.message);
            return;
        }
        if (count > 0) {
            items.push({ label: DEPENDENCY_LABELS[deps[i].table] ?? deps[i].table, count });
        }
    });

    return { canDelete: items.length === 0, items };
}

function asDeleteError(err) {
    if (err?.code === '23503') {
        return new Error('Hapus data terkait terlebih dahulu sebelum menghapus ini.');
    }
    return err instanceof Error ? err : new Error(err?.message ?? 'Gagal menghapus data');
}

/** Hapus satu baris dari `table` berdasarkan primary key.
 *  Cek dependency dulu — kalau ada, throw error dengan detail. */
export async function deleteRecord(table, id) {
    const { canDelete, items } = await checkDependencies(table, id);
    if (!canDelete) {
        const detail = items.map(i => `${i.count} ${i.label}`).join(', ');
        throw new Error(`Tidak bisa menghapus — masih ada data terkait: ${detail}.`);
    }

    if (table === 'users') {
        return deleteUserWithAuth(id);
    }

    const pkColumn = PK_COLUMNS[table];
    if (!pkColumn) throw new Error(`Tabel "${table}" tidak didukung untuk hapus.`);

    const { error } = await supabase.from(table).delete().eq(pkColumn, id);
    if (error) throw asDeleteError(error);
}

/**
 * Hapus banyak baris sekaligus.
 * Return { deleted, errors } — errors berisi { id, message } untuk baris yang gagal
 * (mis. karena FK violation pada baris tertentu).
 */
export async function deleteBulk(table, ids, onProgress) {
    if (table === 'users') {
        const CONCURRENCY = 10;
        const errors = [];
        let deleted = 0;

        for (let i = 0; i < ids.length; i += CONCURRENCY) {
            const batch = ids.slice(i, i + CONCURRENCY);
            const results = await Promise.allSettled(
                batch.map(id => deleteUserWithAuth(id))
            );
            for (let j = 0; j < results.length; j++) {
                if (results[j].status === 'fulfilled') {
                    deleted++;
                } else {
                    errors.push({ id: batch[j], message: results[j].reason?.message ?? 'Gagal' });
                }
            }
            onProgress?.(deleted + errors.length, ids.length);
        }
        return { deleted, errors };
    }

    const pkColumn = PK_COLUMNS[table];
    if (!pkColumn) throw new Error(`Tabel "${table}" tidak didukung untuk hapus.`);

    // Byproduct impor: data yang otomatis dibuat saat impor entitas induk.
    // Aman di-cascade karena bukan data transaksional/operasional.
    const IMPORT_BYPRODUCTS = {
        students: [
            { table: 'class_enrollments', fk: 'student_id' },
            { table: 'student_parents',   fk: 'student_id' },
        ],
    };

    const CHUNK = 200;
    const errors = [];
    let deleted = 0;

    for (let i = 0; i < ids.length; i += CHUNK) {
        const batch = ids.slice(i, i + CHUNK);

        // Hapus byproduct impor sebelum hapus baris utama
        const byproducts = IMPORT_BYPRODUCTS[table];
        if (byproducts) {
            for (const bp of byproducts) {
                const { error: bpErr } = await supabase
                    .from(bp.table).delete().in(bp.fk, batch);
                if (bpErr) console.error(`[deleteBulk] byproduct ${bp.table} failed:`, bpErr);
            }
        }

        const { error, count } = await supabase
            .from(table)
            .delete({ count: 'exact' })
            .in(pkColumn, batch);

        if (!error) {
            deleted += count ?? batch.length;
            onProgress?.(deleted + errors.length, ids.length);
            continue;
        }
        if (error.code !== '23503') throw asDeleteError(error);

        for (const id of batch) {
            try {
                await deleteRecord(table, id);
                deleted++;
            } catch (err) {
                errors.push({ id, message: err.message });
            }
            onProgress?.(deleted + errors.length, ids.length);
        }
    }
    return { deleted, errors };
}

/** Aktifkan atau nonaktifkan akun staf (soft-delete). */
export async function setUserActive(user_id, is_active) {
    const { error } = await supabase
        .from('users')
        .update({ is_active })
        .eq('user_id', user_id);
    if (error) throw error;
}

/**
 * Nonaktifkan staf + cabut semua jabatan struktural.
 * Riwayat (jurnal, absensi, jadwal masa lalu) tetap ada.
 */
export async function deactivateStaff(user_id) {
    const { error } = await supabase
        .from('users')
        .update({
            is_active:          false,
            is_bk:              false,
            is_kepsek:          false,
            is_waka_kurikulum:  false,
            is_waka_kesiswaan:  false,
            is_waka_humas:      false,
            wali_kelas_class_id: null,
            kaprodi_program_id:  null,
        })
        .eq('user_id', user_id);
    if (error) throw error;
}

/**
 * Cek apakah guru masih punya penugasan jadwal aktif.
 * Kembalikan { templates, sessions } — jumlah baris per tabel.
 */
export async function checkTeacherScheduleDependencies(user_id) {
    const today = new Date().toISOString().slice(0, 10);
    const [tmpl, sess] = await Promise.all([
        supabase.from('schedule_templates').select('template_id', { count: 'exact', head: true }).eq('teacher_id', user_id),
        supabase.from('teaching_schedules').select('schedule_id',  { count: 'exact', head: true }).eq('scheduled_teacher_id', user_id).gte('session_date', today),
    ]);
    return {
        templates: tmpl.count ?? 0,
        sessions:  sess.count ?? 0,
    };
}

/**
 * Hapus semua penugasan jadwal guru: template + sesi mendatang.
 * Sesi yang sudah lewat (data historis absensi) TIDAK dihapus.
 */
export async function releaseTeacherFromSchedules(user_id) {
    const today = new Date().toISOString().slice(0, 10);

    // Ambil schedule_id sesi mendatang (> hari ini) milik guru ini
    const { data: futureSessions, error: fetchErr } = await supabase
        .from('teaching_schedules')
        .select('schedule_id')
        .eq('scheduled_teacher_id', user_id)
        .gt('session_date', today);
    if (fetchErr) throw fetchErr;

    const ids = (futureSessions ?? []).map(s => s.schedule_id);

    // Hapus substitute_schedules dulu (FK RESTRICT ke teaching_schedules)
    if (ids.length > 0) {
        const { error: e0 } = await supabase
            .from('substitute_schedules')
            .delete()
            .in('schedule_id', ids);
        if (e0) throw e0;
    }

    // Hapus template jadwal mingguan
    const { error: e1 } = await supabase
        .from('schedule_templates')
        .delete()
        .eq('teacher_id', user_id);
    if (e1) throw e1;

    // Hapus sesi mendatang (> hari ini) — sesi hari ini & lampau dibiarkan
    if (ids.length > 0) {
        const { error: e2 } = await supabase
            .from('teaching_schedules')
            .delete()
            .in('schedule_id', ids);
        if (e2) throw e2;
    }
}

// ─── Forum Kelas: penugasan BK & Guru Wali ───────────────

/** Ambil semua staf dengan role BK aktif di sekolah ini. */
export async function getForumBkStaff() {
    const { data, error } = await supabase
        .from('v_users_staff_directory')
        .select('user_id, full_name, role_type')
        .eq('role_type', 'BK')
        .eq('is_active', true)
        .order('full_name');
    if (error) throw error;
    return data ?? [];
}

/** Ambil semua staf non-admin aktif sebagai kandidat Guru Wali. */
export async function getForumGuruWaliCandidates() {
    const INTERNAL_ROLES = [
        'GURU','BK','WALI_KELAS','KAPRODI','KEPSEK',
        'WAKA_KURIKULUM','WAKA_KESISWAAN','WAKA_HUMAS',
    ];
    const { data, error } = await supabase
        .from('v_users_staff_directory')
        .select('user_id, full_name, role_type')
        .in('role_type', INTERNAL_ROLES)
        .order('full_name');
    if (error) throw error;
    return data ?? [];
}

/** Ambil penugasan BK aktif untuk semua kelas di tahun ajaran ini. */
export async function getBkAssignments(academicYear) {
    const { data, error } = await supabase
        .from('bk_class_assignments')
        .select('assignment_id, class_id, bk_user_id, is_active')
        .eq('academic_year', academicYear)
        .eq('is_active', true);
    if (error) throw error;
    return data ?? [];
}

/** Ambil penugasan Guru Wali aktif untuk semua siswa di tahun ajaran ini. */
export async function getGuruWaliAssignments(academicYear) {
    const { data, error } = await supabase
        .from('guru_wali_assignments')
        .select('assignment_id, student_id, guru_user_id, is_active')
        .eq('academic_year', academicYear)
        .eq('is_active', true);
    if (error) throw error;
    return data ?? [];
}

/**
 * Tetapkan BK ke kelas. Jika sudah ada assignment aktif untuk
 * kombinasi (class_id, bk_user_id, academic_year), skip (idempoten).
 * Untuk mencabut: set is_active=false via updateBkAssignment.
 */
export async function assignBkToClass(classId, bkUserId, academicYear, assignedByUserId) {
    // Cek apakah sudah ada
    const { data: existing } = await supabase
        .from('bk_class_assignments')
        .select('assignment_id')
        .eq('class_id',      classId)
        .eq('bk_user_id',   bkUserId)
        .eq('academic_year', academicYear)
        .eq('is_active',     true)
        .maybeSingle();
    if (existing) return 'exists'; // idempoten — sinyal ke caller

    const { data, error } = await supabase
        .from('bk_class_assignments')
        .insert({
            class_id:           classId,
            bk_user_id:         bkUserId,
            academic_year:      academicYear,
            is_active:          true,
            assigned_by_user_id: assignedByUserId,
        })
        .select('assignment_id')
        .single();
    if (error) throw error;
    return data.assignment_id;
}

/** Cabut penugasan BK dari kelas (soft-delete via is_active=false). */
export async function revokeBkFromClass(assignmentId) {
    const { error } = await supabase
        .from('bk_class_assignments')
        .update({ is_active: false })
        .eq('assignment_id', assignmentId);
    if (error) throw error;
}

/**
 * Tetapkan Guru Wali ke siswa. Idempoten — skip jika sudah ada.
 */
export async function assignGuruWaliToStudent(
    studentId, guruUserId, academicYear, assignedByUserId
) {
    const { data: existing } = await supabase
        .from('guru_wali_assignments')
        .select('assignment_id')
        .eq('student_id',    studentId)
        .eq('guru_user_id',  guruUserId)
        .eq('academic_year', academicYear)
        .eq('is_active',     true)
        .maybeSingle();
    if (existing) return 'exists'; // idempoten — sinyal ke caller

    const { data, error } = await supabase
        .from('guru_wali_assignments')
        .insert({
            student_id:          studentId,
            guru_user_id:        guruUserId,
            academic_year:       academicYear,
            is_active:           true,
            assigned_by_user_id: assignedByUserId,
        })
        .select('assignment_id')
        .single();
    if (error) throw error;
    return data.assignment_id;
}

/** Cabut penugasan Guru Wali dari siswa. */
export async function revokeGuruWaliFromStudent(assignmentId) {
    const { error } = await supabase
        .from('guru_wali_assignments')
        .update({ is_active: false })
        .eq('assignment_id', assignmentId);
    if (error) throw error;
}

/** Kembalikan daftar GURU aktif tanpa teaching_assignment di tahun ajaran aktif. */
export async function getStaleStaff() {
    const { data, error } = await supabase.rpc('fn_get_stale_staff');
    if (error) throw error;
    return data ?? [];
}

/** Nonaktifkan semua GURU tanpa jadwal. Kembalikan jumlah yang dinonaktifkan. */
export async function deactivateStaleStaff() {
    const { data, error } = await supabase.rpc('fn_deactivate_stale_staff');
    if (error) throw error;
    return data ?? 0;
}

/**
 * Ambil daftar guru pengganti aktif (token belum kedaluwarsa).
 * Dipakai di panel Jadwal agar admin bisa menyalin & mengirim token via WA.
 */
export async function getActiveSubstitutes() {
    const { data, error } = await supabase
        .from('substitute_schedules')
        .select(`
            substitute_id,
            sync_token,
            sync_token_expires_at,
            substitute:users!substitute_schedules_substitute_user_id_fkey ( full_name ),
            schedule:teaching_schedules!substitute_schedules_schedule_id_fkey (
                session_date,
                class:classes ( name ),
                subject:subjects ( name )
            )
        `)
        .gt('sync_token_expires_at', new Date().toISOString())
        .order('sync_token_expires_at', { ascending: true });
    if (error) throw error;
    return data ?? [];
}

/** Toggle status aktif/nonaktif mata pelajaran. */
export async function toggleSubjectActive(subject_id, is_active) {
    const { data, error } = await supabase
        .from('subjects')
        .update({ is_active })
        .eq('subject_id', subject_id)
        .select()
        .single();
    if (error) throw error;
    return data;
}
