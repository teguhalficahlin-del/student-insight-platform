/**
 * @file parent/js/api.js
 *
 * Supabase wrapper for the parent portal.
 * Same Supabase project as admin — RLS enforces access.
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
    if (!email) throw new Error('NIK tidak ditemukan. Hubungi admin sekolah untuk memastikan akun sudah dibuat.');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
        if (error.status === 429 || /rate limit|too many/i.test(error.message || ''))
            throw new Error('Terlalu banyak percobaan login. Tunggu ±15 menit lalu coba lagi.');
        throw new Error('Password salah. Jika baru pertama login, hubungi admin sekolah untuk password sementara Anda.');
    }

    return data.user;
}

export async function getCurrentUserRow(authUser = null) {
    const user = authUser ?? (await supabase.auth.getUser()).data?.user;
    if (!user) return null;

    const { data, error } = await supabase
        .from('users')
        .select('user_id, school_id, full_name, role_type, login_identifier, identifier_type, is_active, must_change_password, last_seen_at, last_seen_ua')
        .eq('auth_user_id', user.id)
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
            teacher:users ( full_name )
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

export async function fetchWeekSchedule(classId) {
    if (!classId) return [];
    const today  = new Date();
    const dow    = today.getDay();
    const diff   = dow === 0 ? -6 : 1 - dow;
    const monday = new Date(today);
    monday.setDate(today.getDate() + diff);

    const days = Array.from({ length: 5 }, (_, i) => {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        return d.toISOString().slice(0, 10);
    });

    const results = await Promise.all(
        days.map(date =>
            fetchSchedule(classId, date)
                .then(rows => ({ date, rows }))
                .catch(() => ({ date, rows: [] }))
        )
    );
    return results;
}

export async function fetchAttendance(studentId, dateStart, dateEnd) {
    let q = supabase
        .from('teaching_schedules')
        .select(`
            schedule_id,
            block_group_id,
            session_date,
            session_start,
            session_end,
            subject:subjects ( name ),
            teacher:users ( full_name ),
            attendance!inner ( attendance_id, status, is_void, notes )
        `)
        .eq('attendance.student_id', studentId)
        .eq('attendance.is_void', false)
        .order('session_date', { ascending: false })
        .order('session_start', { ascending: true });

    if (dateStart) q = q.gte('session_date', dateStart);
    if (dateEnd)   q = q.lte('session_date', dateEnd);

    const { data, error } = await q;
    if (error) throw error;

    const blockMap = new Map();
    for (const sched of (data ?? [])) {
        const att = (sched.attendance ?? [])[0];
        if (!att) continue;
        const key = sched.block_group_id ?? `${sched.session_date}_${sched.session_start}`;
        if (!blockMap.has(key)) {
            blockMap.set(key, {
                block_group_id:  key,
                date:            sched.session_date,
                subject:         sched.subject?.name ?? 'KBM',
                teacher:         sched.teacher?.full_name ?? '—',
                slots:           [],
            });
        }
        blockMap.get(key).slots.push({
            start:  sched.session_start?.slice(0, 5),
            end:    sched.session_end?.slice(0, 5),
            status: att.status === 'EKSKUL' ? 'HADIR' : att.status,
            notes:  att.notes ?? '',
        });
    }

    return Array.from(blockMap.values()).map(block => {
        const statuses = block.slots.map(s => s.status);
        const unique   = [...new Set(statuses)];
        const summary  = unique.length === 1 ? unique[0] : 'CAMPURAN';
        const first    = block.slots[0];
        const last     = block.slots[block.slots.length - 1];
        return {
            ...block,
            time_range:     `${first.start} – ${last.end}`,
            summary_status: summary,
        };
    });
}

export async function fetchObservations(studentId, dateStart = null, dateEnd = null) {
    let query = supabase
        .from('observations')
        .select(`
            observation_id,
            sentiment,
            dimension,
            content,
            visibility,
            observed_at,
            author:users!observations_author_user_id_fkey ( full_name )
        `)
        .eq('student_id', studentId)
        .order('observed_at', { ascending: false })
        .limit(50);

    if (dateStart) query = query.gte('observed_at', dateStart);
    if (dateEnd)   query = query.lte('observed_at', dateEnd + 'T23:59:59');

    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(r => ({
        id:        r.observation_id,
        sentiment: r.sentiment,
        dimension: r.dimension,
        content:   r.content,
        author:    r.author?.full_name ?? '-',
        date:      r.observed_at,
    }));
}

export async function fetchCases(studentId) {
    const { data, error } = await supabase
        .from('cases')
        .select(`
            case_id, title, description, status, created_at, current_handler_role,
            events:case_events (
                event_id, event_type, payload, created_at, privacy_level,
                author:users!case_events_author_user_id_fkey ( full_name )
            )
        `)
        .eq('student_id', studentId)
        .eq('audience', 'RESTRICTED')
        .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(c => ({
        ...c,
        events: (c.events ?? [])
            .filter(e => e.privacy_level === 'STUDENT_VISIBLE')
            .sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
    }));
}

export async function fetchPklPlacement(studentId) {
    const { data, error } = await supabase
        .from('pkl_placements')
        .select(`
            placement_id, start_date, end_date,
            dudi:users!pkl_placements_dudi_user_id_fkey ( full_name, dudi_org_name )
        `)
        .eq('student_id', studentId)
        .eq('is_active', true)
        .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
        placement_id: data.placement_id,
        start_date:   data.start_date,
        end_date:     data.end_date,
        dudi_name:    data.dudi?.dudi_org_name ?? data.dudi?.full_name ?? '-',
    };
}

export async function fetchPklAttendanceSummary(studentId) {
    const { data, error } = await supabase
        .from('pkl_attendance')
        .select('pkl_attendance_id, attendance_date, status, notes')
        .eq('student_id', studentId)
        .order('attendance_date', { ascending: false });
    if (error) throw error;
    return data ?? [];
}

export async function getUnreadNotifCount() {
    const { data, error } = await supabase.rpc('fn_count_unread_notifications');
    if (error) throw error;
    return Number(data ?? 0);
}

export async function getRecentNotifications(limit = 15) {
    const { data, error } = await supabase
        .from('notifications')
        .select('notification_id, type, title, body, is_read, case_id, created_at')
        .eq('is_read', false)
        .order('created_at', { ascending: false })
        .limit(limit);
    if (error) throw error;
    return data ?? [];
}

export async function markNotificationsRead(ids) {
    if (!ids?.length) return;
    const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .in('notification_id', ids);
    if (error) throw error;
}

export async function getMyChildren() {
    const { data: config } = await supabase
        .from('school_config')
        .select('current_academic_year')
        .single();
    const academicYear = config?.current_academic_year ?? null;

    const { data, error } = await supabase
        .from('student_parents')
        .select(`
            student:students (
                student_id, full_name, nis,
                enrollment:class_enrollments (
                    class_id, academic_year,
                    class:classes ( name )
                )
            )
        `);
    if (error) throw error;
    const result = [];
    for (const row of data ?? []) {
        const s = row.student;
        if (!s) continue;
        const enr = (s.enrollment ?? []).find(e =>
            e.academic_year === academicYear && e.class_id
        );
        result.push({
            student_id:    s.student_id,
            full_name:     s.full_name,
            nis:           s.nis,
            class_id:      enr?.class_id ?? null,
            class_name:    enr?.class?.name ?? '',
            academic_year: enr?.academic_year ?? academicYear,
        });
    }
    return result;
}

export async function getForumPosts(classId, academicYear, userId, schoolId, limit = 20, offset = 0) {
    const { data, error } = await supabase
        .from('forum_posts')
        .select(`
            post_id, title, body, visibility, is_pinned, created_at, updated_at,
            author_user_id,
            category:communication_categories ( category_code, label_sekolah, polarity ),
            author:users!forum_posts_author_user_id_fkey ( user_id, full_name ),
            subjects:forum_post_subjects (
                student:students ( student_id, full_name, nis )
            ),
            acknowledgements:forum_post_acknowledgements ( user_id ),
            comments:forum_post_comments (
                comment_id, body, created_at,
                author:users!forum_post_comments_author_user_id_fkey ( user_id, full_name )
            ),
            forum_post_audience!inner ( user_id )
        `)
        .eq('class_id', classId)
        .eq('academic_year', academicYear)
        .eq('school_id', schoolId)
        .eq('forum_post_audience.user_id', userId)
        .order('is_pinned', { ascending: false })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
    if (error) throw error;
    return (data ?? []).map(p => {
        const { forum_post_audience: _aud, ...rest } = p;
        return rest;
    });
}

export async function addForumAck(postId, userId, schoolId) {
    const { error } = await supabase
        .from('forum_post_acknowledgements')
        .upsert(
            { post_id: postId, user_id: userId, school_id: schoolId },
            { onConflict: 'post_id,user_id', ignoreDuplicates: true }
        );
    if (error) throw error;
}

export async function addForumComment(postId, userId, schoolId, body) {
    const { data, error } = await supabase
        .from('forum_post_comments')
        .insert({ post_id: postId, author_user_id: userId, school_id: schoolId, body })
        .select('comment_id, body, created_at, author:users!forum_post_comments_author_user_id_fkey ( user_id, full_name )')
        .single();
    if (error) throw error;
    return data;
}
