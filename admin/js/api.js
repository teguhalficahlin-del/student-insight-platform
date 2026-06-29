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

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        autoRefreshToken: true,
        persistSession:   true,
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
export async function loginWithIdentifier(identifier, password) {
    const { data: email, error: resolveErr } = await supabase
        .rpc('fn_resolve_login_email', { p_identifier: identifier });

    if (resolveErr || !email) {
        throw new Error('Identifier atau password salah');
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error('Identifier atau password salah');

    return data.user;
}

export async function getCurrentUserRow() {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData?.user) return null;

    const { data, error } = await supabase
        .from('users')
        .select('user_id, full_name, role_type, login_identifier, identifier_type')
        .eq('auth_user_id', authData.user.id)
        .maybeSingle();

    if (error) throw error;
    return data;
}

export async function logout() {
    await supabase.auth.signOut();
}

export function requireAdministrativeOrRedirect(userRow) {
    if (!userRow || userRow.role_type !== 'ADMINISTRATIVE') {
        window.location.href = 'index.html';
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

export async function changePassword(newPassword) {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
    await upsertSchoolConfig({ password_changed: true });
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

    const body = await res.json();
    if (!res.ok) {
        const message = body?.error?.message ?? 'Impor gagal';
        const details = body?.error?.details ?? [];
        const err = new Error(message);
        err.details = details;
        throw err;
    }
    return body.data;
}

export function importUsers(csvText)     { return callBulkImport('bulk-import-users', csvText); }
export function importPrograms(csvText)  { return callBulkImport('bulk-import-programs', csvText); }
export function importClasses(csvText)   { return callBulkImport('bulk-import-classes', csvText); }
export function importStudents(csvText)  { return callBulkImport('bulk-import-students', csvText); }
export function importSchedules(csvText) { return callBulkImport('bulk-import-schedules', csvText); }
export function importParents(csvText)   { return callBulkImport('bulk-import-parents', csvText); }
export function importDudi(csvText)      { return callBulkImport('bulk-import-dudi', csvText); }

// ─────────────────────────────────────────────────────────────
// EDGE FUNCTIONS — delete-user
// ─────────────────────────────────────────────────────────────

async function callEdgeDelete(functionName, body) {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    if (!token) throw new Error('Sesi login tidak ditemukan. Silakan login ulang.');

    const res = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
        method:  'DELETE',
        headers: {
            'Content-Type':     'application/json',
            'Authorization':    `Bearer ${token}`,
            'x-schema-version': '1.0.0',
        },
        body: JSON.stringify(body),
    });

    const resBody = await res.json();
    if (!res.ok) {
        const message = resBody?.error?.message ?? 'Hapus gagal';
        throw new Error(message);
    }
    return resBody.data;
}

/**
 * Hapus user beserta Auth account-nya.
 * Harus lewat Edge Function — bukan REST DELETE langsung.
 */
export async function deleteUserWithAuth(user_id) {
    return callEdgeDelete('delete-user', { user_id });
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
    class_enrollments:    'enrollment siswa',
    teaching_assignments: 'penugasan mengajar',
    teaching_schedules:   'sesi jadwal',
    attendance:           'record absensi',
    observations:         'catatan observasi',
    achievements:         'catatan prestasi',
    cases:                'kasus siswa',
    student_parents:      'data orang tua',
    substitute_schedules: 'jadwal guru pengganti',
};

const DEPENDENCY_MAP = {
    programs: [
        { table: 'classes', column: 'program_id' },
    ],
    classes: [
        { table: 'class_enrollments',    column: 'class_id' },
        { table: 'teaching_assignments', column: 'class_id' },
        { table: 'teaching_schedules',   column: 'class_id' },
        { table: 'observations',         column: 'class_id' },
    ],
    users: [
        { table: 'teaching_assignments', column: 'user_id' },
        { table: 'teaching_schedules',   column: 'scheduled_teacher_id' },
        { table: 'attendance',           column: 'recorded_by_user_id' },
        { table: 'observations',         column: 'author_user_id' },
    ],
    students: [
        { table: 'class_enrollments', column: 'student_id' },
        { table: 'attendance',        column: 'student_id' },
        { table: 'observations',      column: 'student_id' },
        { table: 'achievements',      column: 'student_id' },
        { table: 'cases',             column: 'student_id' },
        { table: 'student_parents',   column: 'student_id' },
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
        if (error) throw error;
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

/** Hapus satu baris dari `table` berdasarkan primary key. */
export async function deleteRecord(table, id) {
    // Tabel users harus lewat Edge Function
    // karena perlu hapus Auth account sekaligus
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
