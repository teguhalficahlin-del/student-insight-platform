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
    let q = supabase
        .from('student_exits')
        .select(`
            exit_id, exit_date, exit_time, return_time, reason,
            student:students(full_name, nis,
                class_enrollment:class_enrollments(class:classes(name))),
            recorder:users!student_exits_recorded_by_fkey(full_name)
        `)
        .order('exit_date', { ascending: false })
        .order('exit_time', { ascending: true });

    // Null guard: tanpa ini, dateStart/dateEnd bernilai null membuat filter rusak
    // dan hasilnya nol baris alih-alih semua data. Pola sama dengan
    // fetchLateArrivals() di atas.
    if (dateStart) q = q.gte('exit_date', dateStart);
    if (dateEnd)   q = q.lte('exit_date', dateEnd);

    const { data, error } = await q;
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

// ─── Forum Sekolah ────────────────────────────────────────────

export async function getForumSekolahPosts(schoolId, userId, limit = 20, offset = 0) {
    const { data, error } = await supabase
        .from('forum_posts')
        .select(`
            post_id, title, body, attachment_url, attachment_name,
            is_edited, created_at, updated_at,
            author_user_id,
            author:users!forum_posts_author_user_id_fkey(user_id, full_name, role_type),
            acknowledgements:forum_post_acknowledgements(user_id),
            forum_post_audience!inner(user_id)
        `)
        .eq('scope_type', 'SEKOLAH')
        .eq('school_id', schoolId)
        .is('deleted_at', null)
        .eq('forum_post_audience.user_id', userId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
    if (error) throw error;
    return (data ?? []).map(({ forum_post_audience: _a, ...rest }) => rest);
}

export async function getForumSekolahSentPosts(schoolId, userId, limit = 20, offset = 0) {
    const { data, error } = await supabase
        .from('forum_posts')
        .select(`
            post_id, title, body, attachment_url, attachment_name,
            is_edited, created_at, updated_at,
            author_user_id,
            acknowledgements:forum_post_acknowledgements(user_id),
            audience:forum_post_audience(user_id)
        `)
        .eq('scope_type', 'SEKOLAH')
        .eq('school_id', schoolId)
        .eq('author_user_id', userId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
    if (error) throw error;
    return data ?? [];
}

export async function getForumSekolahComments(postId) {
    const { data, error } = await supabase
        .from('forum_post_comments')
        .select(`
            comment_id, body, created_at,
            author_user_id,
            author:users!forum_post_comments_author_user_id_fkey(user_id, full_name, role_type)
        `)
        .eq('post_id', postId)
        .order('created_at', { ascending: true });
    if (error) throw error;
    return data ?? [];
}

export async function addForumSekolahComment(postId, body, schoolId) {
    const { error } = await supabase
        .from('forum_post_comments')
        .insert({ post_id: postId, body, school_id: schoolId });
    if (error) throw error;
}

export async function addForumSekolahAck(postId, userId, schoolId) {
    const { error } = await supabase
        .from('forum_post_acknowledgements')
        .upsert(
            { post_id: postId, user_id: userId, school_id: schoolId },
            { onConflict: 'post_id,user_id', ignoreDuplicates: true }
        );
    if (error) throw error;
}

export async function createForumSekolahPost(title, body, recipientUserIds, academicYear) {
    const { data, error } = await supabase.rpc('fn_create_forum_post', {
        p_class_id:            null,
        p_academic_year:       academicYear,
        p_content:             body,
        p_category_code:       null,
        p_subject_student_ids: [],
        p_audience_type:       'ORANG_TERTENTU',
        p_specific_user_ids:   recipientUserIds,
        p_audience_type_2:     null,
        p_specific_user_ids_2: [],
        p_scope_type:          'SEKOLAH',
        p_title:               title,
    });
    if (error) throw error;
    return data;
}

export async function updateForumSekolahPost(postId, newTitle, newBody) {
    const { error } = await supabase
        .from('forum_posts')
        .update({
            title:      newTitle,
            body:       newBody,
            is_edited:  true,
            edited_at:  new Date().toISOString(),
            updated_at: new Date().toISOString(),
        })
        .eq('post_id', postId);
    if (error) throw error;
}

export async function deleteForumSekolahPost(postId) {
    const { error } = await supabase
        .from('forum_posts')
        .update({ deleted_at: new Date().toISOString() })
        .eq('post_id', postId);
    if (error) throw error;
}

export async function getForumRecipientCandidates(
    targetGroup, { programId = null, classId = null, dayOfWeek = null, academicYear = null } = {}
) {
    const { data, error } = await supabase.rpc('fn_get_forum_recipient_candidates', {
        p_target_group:  targetGroup,
        p_program_id:    programId,
        p_class_id:      classId,
        p_day_of_week:   dayOfWeek,
        p_academic_year: academicYear,
    });
    if (error) throw error;
    return data ?? [];
}
