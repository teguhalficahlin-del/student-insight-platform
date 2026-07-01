/**
 * @file guru/js/api.js
 * Supabase wrapper untuk Portal Guru (semua peran staf sekolah).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL      = 'https://xovvuuwexoweoqyltepq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhvdnZ1dXdleG93ZW9xeWx0ZXBxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMDk0NzUsImV4cCI6MjA5Nzc4NTQ3NX0.mFwmVfSqYM7ITURtLC143BsurK6Yr31WFViJe5PFGN8';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: true, persistSession: true },
});

// Semua role_type yang boleh masuk portal ini
export const GURU_ROLES = ['GURU','WALI_KELAS','BK','KAPRODI','KEPSEK','WAKA_KURIKULUM','WAKA_KESISWAAN'];

export async function loginWithIdentifier(identifier, password) {
    const { data: email, error: resolveErr } = await supabase
        .rpc('fn_resolve_login_email', { p_identifier: identifier });
    if (resolveErr || !email) throw new Error('NIP/NIK atau password salah');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error('NIP/NIK atau password salah');
}

export async function logout() {
    await supabase.auth.signOut();
}

export async function getCurrentUserRow() {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return null;
    const { data, error } = await supabase
        .from('users')
        .select(`
            user_id, full_name, role_type, login_identifier, teacher_code,
            wali_kelas_class_id, kaprodi_program_id,
            is_bk, is_kepsek, is_waka_kurikulum, is_waka_kesiswaan
        `)
        .eq('auth_user_id', auth.user.id)
        .maybeSingle();
    if (error) throw error;
    return data;
}

/**
 * Kembalikan daftar jabatan aktif user berdasarkan role_type + flag tambahan.
 * Dipakai untuk menentukan tab mana yang muncul di dashboard.
 */
export function getJabatan(u) {
    if (!u) return [];
    const j = [];
    if (u.role_type === 'WALI_KELAS' || u.wali_kelas_class_id) j.push('wali_kelas');
    if (u.role_type === 'BK'         || u.is_bk)               j.push('bk');
    if (u.role_type === 'KAPRODI'    || u.kaprodi_program_id)   j.push('kaprodi');
    if (u.role_type === 'WAKA_KESISWAAN' || u.is_waka_kesiswaan) j.push('waka_kesiswaan');
    if (u.role_type === 'WAKA_KURIKULUM' || u.is_waka_kurikulum) j.push('waka_kurikulum');
    if (u.role_type === 'KEPSEK'     || u.is_kepsek)            j.push('kepsek');
    return j;
}

export function jabatanLabel(key) {
    return {
        wali_kelas:    'Wali Kelas',
        bk:            'BK',
        kaprodi:       'Kaprodi',
        waka_kesiswaan:'Waka Kesiswaan',
        waka_kurikulum:'Waka Kurikulum',
        kepsek:        'Kepala Sekolah',
    }[key] ?? key;
}

// ─── JADWAL GURU ────────────────────────────────────────────

export async function getSchoolConfig() {
    const { data } = await supabase.from('school_config').select('current_academic_year, current_semester').single();
    return data;
}

/**
 * Jadwal mengajar guru pada tanggal tertentu.
 * Filter langsung via scheduled_teacher_id (tidak perlu join ke assignments).
 */
export async function getMyScheduleForDate(userId, date) {
    const { data, error } = await supabase
        .from('teaching_schedules')
        .select(`
            schedule_id, session_date, session_start, session_end,
            class:classes ( class_id, name )
        `)
        .eq('session_date', date)
        .eq('scheduled_teacher_id', userId)
        .order('session_start');
    if (error) throw error;
    return data ?? [];
}

// ─── SISWA & KEHADIRAN ───────────────────────────────────────

/**
 * Daftar siswa aktif di suatu kelas (via class_enrollments, tidak withdrawn).
 */
export async function getEnrolledStudents(classId, academicYear) {
    const { data, error } = await supabase
        .from('class_enrollments')
        .select('student:students ( student_id, nis, full_name, student_status )')
        .eq('class_id', classId)
        .eq('academic_year', academicYear)
        .is('withdrawn_at', null)
        .order('student(full_name)');
    if (error) throw error;
    return (data ?? []).map(r => r.student).filter(Boolean)
        .sort((a, b) => a.full_name.localeCompare(b.full_name, 'id'));
}

/**
 * Kehadiran yang sudah ada untuk satu sesi jadwal.
 * Returns Map: student_id → { attendance_id, status, notes }
 */
export async function getAttendanceForSession(scheduleId) {
    const { data, error } = await supabase
        .from('attendance')
        .select('attendance_id, student_id, status, notes')
        .eq('schedule_id', scheduleId);
    if (error) throw error;
    const map = new Map();
    for (const r of data ?? []) map.set(r.student_id, r);
    return map;
}

/**
 * Simpan kehadiran satu sesi. rows = [{ student_id, status, notes? }].
 * Upsert on (schedule_id, student_id).
 */
export async function upsertAttendance(scheduleId, rows) {
    const payload = rows.map(r => ({
        schedule_id: scheduleId,
        student_id:  r.student_id,
        status:      r.status,
        source:      'TEACHER_DECLARED',
        notes:       r.notes ?? null,
    }));
    const { error } = await supabase
        .from('attendance')
        .upsert(payload, { onConflict: 'schedule_id,student_id', ignoreDuplicates: false });
    if (error) throw error;
}

// ─── OBSERVASI ───────────────────────────────────────────────

/**
 * Semua siswa di kelas-kelas yang diajar guru ini (untuk selector observasi).
 * Ambil via teaching_assignments aktif periode berjalan.
 */
export async function getMyStudents(userId, academicYear, semester) {
    const { data, error } = await supabase
        .from('teaching_assignments')
        .select('class:classes ( class_id, name, enrollments:class_enrollments ( student:students ( student_id, nis, full_name ) ) )')
        .eq('user_id', userId)
        .eq('academic_year', academicYear)
        .eq('semester', semester)
        .eq('is_active', true);
    if (error) throw error;

    const seen = new Set();
    const students = [];
    for (const ta of data ?? []) {
        for (const en of ta.class?.enrollments ?? []) {
            const s = en.student;
            if (s && !seen.has(s.student_id)) {
                seen.add(s.student_id);
                students.push({ ...s, class_name: ta.class?.name });
            }
        }
    }
    return students.sort((a, b) => a.full_name.localeCompare(b.full_name, 'id'));
}

/**
 * Pencarian siswa sisi-server untuk observer berjangkauan luas
 * (BK / Kaprodi / Waka Kesiswaan / Kepsek) yang mungkin tidak mengajar
 * sehingga getMyStudents (berbasis teaching_assignments) kosong.
 * Cakupan hasil dibatasi RLS sesuai peran pemanggil.
 */
export async function searchStudents(query) {
    const q = (query ?? '').trim();
    if (q.length < 2) return [];
    const term = `%${q}%`;
    const { data, error } = await supabase
        .from('students')
        .select('student_id, nis, full_name, student_status')
        .or(`full_name.ilike.${term},nis.ilike.${term}`)
        .in('student_status', ['AKTIF', 'PKL'])
        .order('full_name')
        .limit(15);
    if (error) throw error;
    return (data ?? []).map(s => ({ ...s, class_name: '' }));
}

/**
 * Simpan observasi baru.
 */
export async function insertObservation({ authorId, studentId, dimension, sentiment, visibility, content }) {
    const { error } = await supabase.from('observations').insert({
        author_user_id: authorId,
        student_id:     studentId,
        dimension,
        sentiment,
        visibility,
        content,
        observed_at:    new Date().toISOString(),
    });
    if (error) throw error;
}

// ─── WALI KELAS ──────────────────────────────────────────────

export async function getWaliKelasInfo(classId) {
    if (!classId) return null;
    const { data } = await supabase
        .from('classes')
        .select('class_id, name, grade_level')
        .eq('class_id', classId)
        .maybeSingle();
    return data;
}

/**
 * Rekap kehadiran per siswa di kelas wali kelas (untuk dashboard wali).
 * Returns [{ student_id, full_name, nis, HADIR, TIDAK_HADIR, IZIN, SAKIT, EKSKUL, total }]
 */
export async function getWaliAttendanceSummary(classId, academicYear, dateStart, dateEnd) {
    // 1. Ambil daftar siswa
    const students = await getEnrolledStudents(classId, academicYear);
    if (students.length === 0) return [];
    const ids = students.map(s => s.student_id);

    // 2. Ambil kehadiran dalam rentang berdasarkan TANGGAL SESI (session_date),
    //    bukan created_at (waktu input). Mulai dari teaching_schedules lalu
    //    !inner ke attendance (PostgREST tak bisa filter kolom embedded non-inner).
    let q = supabase
        .from('teaching_schedules')
        .select('session_date, attendance!inner ( student_id, status, is_void )')
        .in('attendance.student_id', ids)
        .eq('attendance.is_void', false);
    if (dateStart) q = q.gte('session_date', dateStart);
    if (dateEnd)   q = q.lte('session_date', dateEnd);
    const { data, error } = await q;
    if (error) throw error;

    const map = new Map(students.map(s => [s.student_id, { ...s, HADIR: 0, TIDAK_HADIR: 0, IZIN: 0, SAKIT: 0, EKSKUL: 0, total: 0 }]));
    for (const sched of data ?? []) {
        for (const r of sched.attendance ?? []) {
            const agg = map.get(r.student_id);
            if (!agg) continue;
            if (agg[r.status] !== undefined) agg[r.status]++;
            agg.total++;
        }
    }
    return [...map.values()];
}

// ─── KAPRODI (pindahan dari /kaprodi/) ───────────────────────

export async function getProgram(programId) {
    if (!programId) return null;
    const { data, error } = await supabase.from('programs').select('program_id, code, name').eq('program_id', programId).maybeSingle();
    if (error) throw error;
    return data;
}

export async function fetchPklStudents(programId) {
    const { data, error } = await supabase
        .from('students')
        .select(`
            student_id, nis, full_name, student_status,
            placements:pkl_placements (
                placement_id, start_date, end_date, is_active,
                dudi:users!pkl_placements_dudi_user_id_fkey ( user_id, full_name, dudi_org_name )
            )
        `)
        .eq('program_id', programId)
        .eq('student_status', 'PKL')
        .order('full_name');
    if (error) throw error;
    return (data ?? []).map(s => {
        const active = (s.placements ?? []).find(p => p.is_active) ?? s.placements?.[0] ?? null;
        return {
            student_id:   s.student_id, nis: s.nis, full_name: s.full_name,
            placement_id: active?.placement_id ?? null,
            dudi_name:    active?.dudi?.dudi_org_name ?? active?.dudi?.full_name ?? '—',
            start_date:   active?.start_date ?? null, end_date: active?.end_date ?? null,
            has_placement: !!active,
        };
    });
}

export async function fetchNonPklStudents(programId) {
    const { data, error } = await supabase
        .from('students')
        .select('student_id, nis, full_name')
        .eq('program_id', programId)
        .in('student_status', ['AKTIF'])
        .order('full_name');
    if (error) throw error;
    return data ?? [];
}

export async function fetchDudiPartners(programId) {
    const { data, error } = await supabase
        .from('users')
        .select('user_id, full_name, dudi_org_name')
        .eq('role_type', 'DUDI')
        .eq('program_id', programId)
        .order('dudi_org_name');
    if (error) throw error;
    return (data ?? []).map(u => ({ user_id: u.user_id, org_name: u.dudi_org_name ?? u.full_name, pic_name: u.full_name }));
}

export async function fetchPklAttendance(studentIds, dateStart, dateEnd) {
    if (!studentIds?.length) return [];
    let q = supabase.from('pkl_attendance').select('student_id, attendance_date, status').in('student_id', studentIds).order('attendance_date', { ascending: false });
    if (dateStart) q = q.gte('attendance_date', dateStart);
    if (dateEnd)   q = q.lte('attendance_date', dateEnd);
    const { data, error } = await q;
    if (error) throw error;
    return data ?? [];
}

export async function fetchDudiObservations(studentIds) {
    if (!studentIds?.length) return [];
    const { data, error } = await supabase
        .from('observations')
        .select(`observation_id, student_id, sentiment, dimension, content, observed_at, created_at, author:users!observations_author_user_id_fkey ( full_name, role_type, dudi_org_name )`)
        .in('student_id', studentIds)
        .order('created_at', { ascending: false })
        .limit(200);
    if (error) throw error;
    return (data ?? []).filter(r => r.author?.role_type === 'DUDI').map(r => ({
        id: r.observation_id, student_id: r.student_id, sentiment: r.sentiment,
        dimension: r.dimension, content: r.content,
        author: r.author?.dudi_org_name ?? r.author?.full_name ?? '—',
        date: r.observed_at ?? r.created_at,
    }));
}

export async function createPlacement({ studentId, dudiUserId, startDate, endDate }) {
    const { error } = await supabase.from('pkl_placements').insert({ student_id: studentId, dudi_user_id: dudiUserId, start_date: startDate, end_date: endDate, is_active: true });
    if (error) throw error;
    const today = new Date().toISOString().slice(0, 10);
    if (startDate <= today) {
        const { error: e2 } = await supabase.from('students').update({ student_status: 'PKL' }).eq('student_id', studentId);
        if (e2) throw e2;
    }
}

export async function bulkImportPkl(csvText) {
    const { data: authData } = await supabase.auth.getSession();
    const token = authData?.session?.access_token;
    if (!token) throw new Error('Sesi tidak valid. Silakan login ulang.');
    const res = await fetch(`${SUPABASE_URL}/functions/v1/bulk-import-pkl`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'text/csv' },
        body: csvText,
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
    return json.data;
}

// ─── KEPSEK / WAKA ──────────────────────────────────────────

export async function getSchoolStats(academicYear, semester) {
    const today = new Date().toISOString().slice(0, 10);
    const [studentsRes, staffRes, schedToday, attToday] = await Promise.all([
        supabase.from('students').select('student_id', { count: 'exact', head: true }).eq('student_status', 'AKTIF'),
        supabase.from('users').select('user_id', { count: 'exact', head: true }).not('role_type', 'in', '("SISWA","ORTU","DUDI","ADMINISTRATIVE","STAKEHOLDER")'),
        supabase.from('teaching_schedules').select('schedule_id, class_id', { count: 'exact' }).eq('session_date', today).eq('academic_year', academicYear),
        supabase.from('attendance').select('status', { count: 'exact' }).gte('created_at', today + 'T00:00:00').eq('status', 'HADIR'),
    ]);
    return {
        total_siswa:       studentsRes.count ?? 0,
        total_staf:        staffRes.count ?? 0,
        sesi_hari_ini:     schedToday.count ?? 0,
        kehadiran_hari_ini: attToday.count ?? 0,
    };
}

export async function getAbsentTeachersToday() {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
        .from('teaching_schedules')
        .select('schedule_id, session_start, session_end, scheduled_teacher_id, class:classes(name), teacher:users(full_name)')
        .eq('session_date', today)
        .eq('meeting_status', 'GURU_TIDAK_HADIR');
    if (error) throw error;
    return data ?? [];
}

// ─── WAKA KESISWAAN ─────────────────────────────────────────

export async function getAttendanceRecapPerClass(sessionDate) {
    const { data, error } = await supabase
        .from('teaching_schedules')
        .select('class:classes(class_id, name), attendance!inner(status, is_void)')
        .eq('session_date', sessionDate)
        .eq('attendance.is_void', false);
    if (error) throw error;

    const map = new Map();
    for (const sched of data ?? []) {
        const classId = sched.class?.class_id;
        if (!classId) continue;
        if (!map.has(classId)) {
            map.set(classId, { class_id: classId, name: sched.class?.name ?? '—',
                HADIR: 0, TIDAK_HADIR: 0, IZIN: 0, SAKIT: 0, EKSKUL: 0, total: 0 });
        }
        const agg = map.get(classId);
        for (const r of sched.attendance ?? []) {
            if (agg[r.status] !== undefined) agg[r.status]++;
            agg.total++;
        }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getOpenCases() {
    const { data, error } = await supabase
        .from('cases')
        .select('case_id, title, status, track, current_handler_role, created_at, student:students(full_name, nis)')
        .neq('status', 'CLOSED')
        .order('created_at', { ascending: false })
        .limit(100);
    if (error) throw error;
    return data ?? [];
}

// ─── JURNAL MENGAJAR ─────────────────────────────────────────

export async function getJournalEntries(userId) {
    const { data, error } = await supabase
        .from('teacher_journals')
        .select('journal_id, entry_date, content, created_at')
        .eq('owner_user_id', userId)
        .order('entry_date', { ascending: false })
        .order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
}

export async function insertJournalEntry(userId, entryDate, content) {
    const { error } = await supabase
        .from('teacher_journals')
        .insert({ owner_user_id: userId, entry_date: entryDate, content });
    if (error) throw error;
}

export async function deleteJournalEntry(journalId) {
    const { error } = await supabase
        .from('teacher_journals')
        .delete()
        .eq('journal_id', journalId);
    if (error) throw error;
}
