/**
 * @file tu/js/api.js
 * Supabase wrapper untuk portal Tata Usaha.
 * Akses dibatasi hanya SELECT — RLS mengatur isolasi tenant.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL      = 'https://xovvuuwexoweoqyltepq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhvdnZ1dXdleG93ZW9xeWx0ZXBxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMDk0NzUsImV4cCI6MjA5Nzc4NTQ3NX0.mFwmVfSqYM7ITURtLC143BsurK6Yr31WFViJe5PFGN8';

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

export async function loginWithIdentifier(identifier, password, schoolId = null) {
    const { data: email, error: resolveErr } = await supabase
        .rpc('fn_resolve_login_email', { p_identifier: identifier, p_school_id: schoolId });

    if (resolveErr) throw new Error('Gagal menghubungi server. Coba lagi.');
    if (!email) throw new Error('Username / NIK tidak ditemukan. Hubungi admin sekolah.');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
        if (error.status === 429 || /rate limit|too many/i.test(error.message || ''))
            throw new Error('Terlalu banyak percobaan login. Tunggu ±15 menit lalu coba lagi.');
        throw new Error('Password salah. Hubungi admin sekolah jika belum pernah login.');
    }
    return data.user;
}

export async function getCurrentUserRow(authUser = null) {
    const user = authUser ?? (await supabase.auth.getUser()).data?.user;
    if (!user) return null;
    const { data, error } = await supabase
        .from('users')
        .select('user_id, school_id, full_name, role_type, login_identifier, identifier_type, is_active, must_change_password')
        .eq('auth_user_id', user.id)
        .maybeSingle();
    if (error) throw error;
    return data;
}

export async function logout() {
    await supabase.auth.signOut();
}

export async function fetchSchoolConfig() {
    const { data, error } = await supabase
        .from('school_config')
        .select('current_academic_year, current_semester')
        .single();
    if (error) throw error;
    return data;
}

/**
 * Ambil semua jadwal piket aktif untuk sekolah, tahun ajaran, dan semester tertentu.
 * duty_schedules.semester adalah INT (1 atau 2), bukan enum semester.
 */
export async function fetchDutySchedules(academicYear, semester) {
    let q = supabase
        .from('duty_schedules')
        .select(`
            duty_id,
            day_of_week,
            academic_year,
            semester,
            teacher:users!duty_schedules_user_id_fkey ( user_id, full_name )
        `)
        .eq('is_active', true)
        .order('day_of_week');

    if (academicYear) q = q.eq('academic_year', academicYear);
    if (semester)     q = q.eq('semester', Number(semester));

    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map(r => ({
        duty_id:       r.duty_id,
        day_of_week:   r.day_of_week,
        academic_year: r.academic_year,
        semester:      r.semester,
        teacher_name:  r.teacher?.full_name ?? '—',
    }));
}

/**
 * Ambil catatan keterlambatan dalam rentang tanggal.
 * Diurutkan: tanggal terbaru dulu, jam datang terlambat duluan.
 */
export async function fetchLateArrivals(dateStart, dateEnd) {
    let q = supabase
        .from('late_arrivals')
        .select(`
            late_id,
            late_date,
            arrival_time,
            reason,
            student:students!late_arrivals_student_id_fkey ( full_name, nis )
        `)
        .order('late_date', { ascending: false })
        .order('arrival_time', { ascending: false });

    if (dateStart) q = q.gte('late_date', dateStart);
    if (dateEnd)   q = q.lte('late_date', dateEnd);

    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map(r => ({
        late_id:      r.late_id,
        date:         r.late_date,
        arrival_time: r.arrival_time?.slice(0, 5) ?? '—',
        student_name: r.student?.full_name ?? '—',
        nis:          r.student?.nis ?? '—',
        reason:       r.reason ?? '',
    }));
}

export async function getExitsByRange(dateStart, dateEnd) {
    const { data, error } = await supabase
        .from('student_exits')
        .select(`
            exit_id, exit_date, exit_time, return_time, reason,
            student:students(full_name, nis,
                class_enrollment:class_enrollments(class:classes(name))),
            recorder:users!student_exits_recorded_by_fkey(full_name)
        `)
        .gte('exit_date', dateStart)
        .lte('exit_date', dateEnd)
        .order('exit_date', { ascending: false })
        .order('exit_time', { ascending: true });
    if (error) throw error;
    return (data ?? []).map(r => {
        const enrollment = r.student?.class_enrollment ?? [];
        const latest = enrollment[enrollment.length - 1];
        return {
            exit_id:      r.exit_id,
            date:         r.exit_date,
            exit_time:    r.exit_time,
            return_time:  r.return_time,
            reason:       r.reason ?? '',
            student_name: r.student?.full_name ?? '—',
            nis:          r.student?.nis ?? '—',
            class_name:   latest?.class?.name ?? '—',
            recorder:     r.recorder?.full_name ?? '—',
        };
    });
}

/**
 * Ambil rekap kehadiran tidak hadir (ALPA, IZIN, SAKIT) dalam rentang tanggal.
 * Query via teaching_schedules agar bisa filter by session_date.
 * RLS rls_attendance_read_tu + rls_schedules_read_tu memastikan isolasi tenant.
 *
 * @param {string|null} dateStart
 * @param {string|null} dateEnd
 * @param {string[]} statuses - subset dari ['ALPA','IZIN','SAKIT']
 * @returns {Array} satu baris per (blok pertemuan, siswa) — JP dalam blok yang sama digabung
 */
export async function fetchAttendanceSummary(dateStart, dateEnd, statuses = ['ALPA', 'IZIN', 'SAKIT']) {
    let q = supabase
        .from('teaching_schedules')
        .select(`
            block_group_id,
            session_date,
            class:classes!teaching_schedules_class_id_fkey ( name ),
            attendance!inner (
                attendance_id,
                status,
                notes,
                student:students!attendance_student_id_fkey ( full_name, nis )
            )
        `)
        .in('attendance.status', statuses)
        .eq('attendance.is_void', false)
        .order('session_date', { ascending: false });

    if (dateStart) q = q.gte('session_date', dateStart);
    if (dateEnd)   q = q.lte('session_date', dateEnd);

    const { data, error } = await q;
    if (error) throw error;

    // Deduplikasi per blok per siswa — beberapa JP dalam satu blok tidak boleh menghasilkan baris ganda
    const seen = new Set();
    const rows = [];
    for (const sched of (data ?? [])) {
        const className = sched.class?.name ?? '—';
        const blockKey  = sched.block_group_id ?? sched.session_date;
        for (const att of (sched.attendance ?? [])) {
            const key = `${blockKey}|${att.student?.nis ?? att.attendance_id}`;
            if (seen.has(key)) continue;
            seen.add(key);
            rows.push({
                date:         sched.session_date,
                student_name: att.student?.full_name ?? '—',
                nis:          att.student?.nis ?? '—',
                class_name:   className,
                status:       att.status,
                notes:        att.notes ?? '',
            });
        }
    }
    return rows;
}
