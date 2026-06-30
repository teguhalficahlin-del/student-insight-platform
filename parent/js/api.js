/**
 * @file parent/js/api.js
 *
 * Supabase wrapper for the parent portal.
 * Same Supabase project as admin — RLS enforces access.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL      = 'https://xovvuuwexoweoqyltepq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhvdnZ1dXdleG93ZW9xeWx0ZXBxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMDk0NzUsImV4cCI6MjA5Nzc4NTQ3NX0.mFwmVfSqYM7ITURtLC143BsurK6Yr31WFViJe5PFGN8';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        autoRefreshToken: true,
        persistSession:   true,
    },
});

export async function loginWithIdentifier(identifier, password) {
    const { data: email, error: resolveErr } = await supabase
        .rpc('fn_resolve_login_email', { p_identifier: identifier });

    if (resolveErr || !email) {
        throw new Error('NIK atau password salah');
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error('NIK atau password salah');

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

export async function fetchChildren(parentUserId) {
    const { data, error } = await supabase
        .from('student_parents')
        .select(`
            student_id,
            students (
                student_id,
                nis,
                full_name,
                student_status,
                program:programs ( name ),
                enrollment:class_enrollments ( class_id, withdrawn_at, class:classes ( name ), academic_year, semester )
            )
        `)
        .eq('parent_user_id', parentUserId);

    if (error) throw error;
    return (data || []).map(r => {
        const s = r.students;
        const enrolls = Array.isArray(s.enrollment) ? s.enrollment : (s.enrollment ? [s.enrollment] : []);
        // Pilih enrollment aktif (belum withdrawn); fallback ke yang pertama.
        const active = enrolls.find(e => !e.withdrawn_at) ?? enrolls[0] ?? null;
        return {
            student_id: s.student_id,
            nis:        s.nis,
            full_name:  s.full_name,
            status:     s.student_status,
            program:    s.program?.name ?? '-',
            class_id:   active?.class_id ?? null,
            class_name: active?.class?.name ?? '-',
        };
    });
}

export async function fetchSchedule(classId, date) {
    if (!classId) return [];
    const { data, error } = await supabase
        .from('teaching_schedules')
        .select(`
            schedule_id, session_date, session_start, session_end,
            subject:subjects ( name ),
            teacher:users!teaching_schedules_scheduled_teacher_id_fkey ( full_name )
        `)
        .eq('class_id', classId)
        .eq('session_date', date)
        .order('session_start');

    if (error) throw error;
    return (data ?? []).map(r => ({
        start:   r.session_start,
        end:     r.session_end,
        subject: r.subject?.name ?? 'KBM',
        teacher: r.teacher?.full_name ?? '-',
    }));
}

export async function fetchAttendance(studentId, dateStart, dateEnd) {
    // PostgREST silently ignores filters on embedded (non-!inner) relations.
    // Flip the query: start from teaching_schedules (date filter works directly),
    // then !inner-join attendance filtered by student_id + is_void.
    let query = supabase
        .from('teaching_schedules')
        .select(`
            session_date,
            session_start,
            session_end,
            subject:subjects ( name ),
            teacher:users!teaching_schedules_scheduled_teacher_id_fkey ( full_name ),
            attendance!inner (
                attendance_id,
                status,
                is_void,
                notes
            )
        `)
        .eq('attendance.student_id', studentId)
        .eq('attendance.is_void', false)
        .order('session_date', { ascending: false });

    if (dateStart) {
        query = query.gte('session_date', dateStart);
    }
    if (dateEnd) {
        query = query.lte('session_date', dateEnd);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Reshape to match the original shape callers expect:
    // { attendance_id, status, is_void, notes, schedule: { session_date, ... } }
    const reshaped = (data ?? []).flatMap(sched =>
        (sched.attendance ?? []).map(att => ({
            attendance_id: att.attendance_id,
            status: att.status,
            is_void: att.is_void,
            notes: att.notes,
            schedule: {
                session_date: sched.session_date,
                session_start: sched.session_start,
                session_end: sched.session_end,
                subject: sched.subject,
                teacher: sched.teacher,
            },
        }))
    );

    return reshaped.map(r => ({
        date:    r.schedule.session_date,
        start:   r.schedule.session_start,
        end:     r.schedule.session_end,
        subject: r.schedule.subject?.name ?? 'KBM',
        teacher: r.schedule.teacher?.full_name ?? '-',
        status:  r.status,
        notes:   r.notes,
    }));
}

export async function fetchObservations(studentId) {
    const { data, error } = await supabase
        .from('observations')
        .select(`
            observation_id,
            sentiment,
            dimension,
            content,
            visibility,
            created_at,
            author:users!observations_author_user_id_fkey ( full_name )
        `)
        .eq('student_id', studentId)
        .eq('visibility', 'STUDENT_VISIBLE')
        .order('created_at', { ascending: false })
        .limit(50);

    if (error) throw error;
    return (data || []).map(r => ({
        id:        r.observation_id,
        sentiment: r.sentiment,
        dimension: r.dimension,
        content:   r.content,
        author:    r.author?.full_name ?? '-',
        date:      r.created_at,
    }));
}
