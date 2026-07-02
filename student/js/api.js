/**
 * @file student/js/api.js
 * Supabase wrapper untuk Portal Siswa.
 *
 * Identitas: siswa login pakai NIS (login_identifier di tabel users),
 * lalu user_id-nya tertaut ke baris students lewat students.user_id.
 * Semua data dibatasi RLS self-scoped (rls_*_read_student di
 * contracts/06_rls_policies.sql + migrasi SISWA read schedules/pkl).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL      = 'https://xovvuuwexoweoqyltepq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhvdnZ1dXdleG93ZW9xeWx0ZXBxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMDk0NzUsImV4cCI6MjA5Nzc4NTQ3NX0.mFwmVfSqYM7ITURtLC143BsurK6Yr31WFViJe5PFGN8';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: true, persistSession: true },
});

// Role yang boleh masuk portal ini
export const STUDENT_ROLES = ['SISWA'];

// Status siswa yang masih boleh mengakses Portal Siswa.
// LULUS (alumni) & KELUAR (mutasi) diblokir; PKL tetap aktif (sedang magang).
export const ACTIVE_STUDENT_STATUSES = ['AKTIF', 'PKL'];

export async function loginWithIdentifier(identifier, password, schoolId = null) {
    const { data: email, error: resolveErr } = await supabase
        .rpc('fn_resolve_login_email', { p_identifier: identifier, p_school_id: schoolId });
    if (resolveErr || !email) throw new Error('NIS atau password salah');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
        if (error.status === 429 || /rate limit|too many/i.test(error.message || ''))
            throw new Error('Terlalu banyak percobaan login. Tunggu ±15 menit lalu coba lagi.');
        throw new Error('NIS atau password salah');
    }
}

export async function logout() {
    await supabase.auth.signOut();
}

export async function getCurrentUserRow() {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return null;
    const { data, error } = await supabase
        .from('users')
        .select('user_id, school_id, full_name, role_type, login_identifier, is_active, must_change_password, last_seen_at, last_seen_ua')
        .eq('auth_user_id', auth.user.id)
        .maybeSingle();
    if (error) throw error;
    return data;
}

/**
 * Baris students milik user yang sedang login (lewat students.user_id).
 * Returns null jika akun SISWA belum tertaut ke data siswa.
 */
export async function getMyStudent(userId) {
    const { data, error } = await supabase
        .from('students')
        .select('student_id, nis, full_name, student_status, program:programs ( name )')
        .eq('user_id', userId)
        .maybeSingle();
    if (error) throw error;
    return data;
}

export async function getSchoolConfig() {
    const { data } = await supabase
        .from('school_config')
        .select('current_academic_year, current_semester')
        .single();
    return data;
}

/**
 * Kelas siswa pada tahun ajaran berjalan (enrollment aktif / belum withdrawn).
 */
export async function getMyClass(studentId, academicYear) {
    const { data, error } = await supabase
        .from('class_enrollments')
        .select('class_id, academic_year, class:classes ( name, grade_level )')
        .eq('student_id', studentId)
        .eq('academic_year', academicYear)
        .is('withdrawn_at', null)
        .maybeSingle();
    if (error) throw error;
    return data;
}

/**
 * Jadwal kelas siswa pada tanggal tertentu.
 * Catatan RLS: butuh kebijakan SISWA read teaching_schedules + class_enrollments
 * (migrasi 20260630180000_student_read_schedules_pkl.sql). Tanpa itu hasil kosong.
 */
export async function getScheduleForDate(classId, date) {
    if (!classId) return [];
    const { data, error } = await supabase
        .from('teaching_schedules')
        .select(`
            schedule_id, session_date, session_start, session_end,
            subject:subjects ( name ),
            teacher:users ( full_name ),
            class:classes ( name )
        `)
        .eq('class_id', classId)
        .eq('session_date', date)
        .order('session_start');
    if (error) throw error;
    return data ?? [];
}

/**
 * Kehadiran diri sendiri dalam rentang tanggal.
 * RLS rls_attendance_read_student membatasi otomatis ke student_id ini (non-void).
 */
export async function getMyAttendance(studentId, dateStart, dateEnd) {
    // Filter berdasarkan TANGGAL SESI KELAS (session_date), bukan created_at
    // (waktu input). PostgREST tak bisa memfilter kolom relasi embedded non-inner,
    // jadi mulai dari teaching_schedules lalu !inner ke attendance milik siswa ini.
    let q = supabase
        .from('teaching_schedules')
        .select(`
            session_date, session_start, session_end,
            subject:subjects ( name ),
            attendance!inner ( attendance_id, status, is_void )
        `)
        .eq('attendance.student_id', studentId)
        .eq('attendance.is_void', false)
        .order('session_date', { ascending: false });
    if (dateStart) q = q.gte('session_date', dateStart);
    if (dateEnd)   q = q.lte('session_date', dateEnd);
    const { data, error } = await q;
    if (error) throw error;
    // Reshape ke bentuk lama { status, schedule:{ session_date, subject } }.
    return (data ?? []).flatMap(sched =>
        (sched.attendance ?? []).map(att => ({
            attendance_id: att.attendance_id,
            status:        att.status,
            schedule: {
                session_date:  sched.session_date,
                session_start: sched.session_start,
                session_end:   sched.session_end,
                subject:       sched.subject,
            },
        }))
    );
}

/**
 * Observasi yang boleh dilihat siswa (STUDENT_VISIBLE).
 * RLS rls_observations_read_student sudah membatasi ke student_id + visibility.
 * Filter eksplisit di sini sebagai pertahanan berlapis.
 */
export async function getMyObservations(studentId) {
    const { data, error } = await supabase
        .from('observations')
        .select(`
            observation_id, dimension, sentiment, content, observed_at, created_at,
            author:users!observations_author_user_id_fkey ( full_name )
        `)
        .eq('student_id', studentId)
        .eq('visibility', 'STUDENT_VISIBLE')
        .order('observed_at', { ascending: false })
        .limit(100);
    if (error) throw error;
    return data ?? [];
}

/**
 * Penempatan PKL aktif siswa (jika ada).
 * RLS: butuh kebijakan SISWA read pkl_placements (migrasi yang sama).
 */
export async function getMyPklPlacement(studentId) {
    const { data, error } = await supabase
        .from('pkl_placements')
        .select(`
            placement_id, start_date, end_date, is_active,
            dudi:users!pkl_placements_dudi_user_id_fkey ( full_name, dudi_org_name )
        `)
        .eq('student_id', studentId)
        .order('is_active', { ascending: false })
        .order('start_date', { ascending: false });
    if (error) throw error;
    const list = data ?? [];
    return list.find(p => p.is_active) ?? list[0] ?? null;
}

/**
 * Rekap absensi PKL siswa.
 * RLS: butuh kebijakan SISWA read pkl_attendance (migrasi yang sama).
 */
export async function getMyPklAttendance(studentId) {
    const { data, error } = await supabase
        .from('pkl_attendance')
        .select('attendance_date, status')
        .eq('student_id', studentId)
        .order('attendance_date', { ascending: false });
    if (error) throw error;
    return data ?? [];
}
