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

try {
    const _mk = 'sb-xovvuuwexoweoqyltepq-auth-token';
    const _lv = localStorage.getItem(_mk);
    if (_lv && !sessionStorage.getItem(_mk)) { sessionStorage.setItem(_mk, _lv); localStorage.removeItem(_mk); }
} catch { /* private mode */ }

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: true, persistSession: true, storage: sessionStorage },
});

// Role yang boleh masuk portal ini
export const STUDENT_ROLES = ['SISWA'];

// Status siswa yang masih boleh mengakses Portal Siswa.
// LULUS (alumni) & KELUAR (mutasi) diblokir; PKL tetap aktif (sedang magang).
export const ACTIVE_STUDENT_STATUSES = ['AKTIF', 'PKL'];

export async function loginWithIdentifier(identifier, password, schoolId = null) {
    const { data: email, error: resolveErr } = await supabase
        .rpc('fn_resolve_login_email', { p_identifier: identifier, p_school_id: schoolId });
    if (resolveErr) throw new Error('Gagal menghubungi server. Coba lagi.');
    if (!email) throw new Error(
        'NIS tidak ditemukan. Pastikan Anda membuka portal via link resmi dari admin sekolah Anda. ' +
        'Jika sudah menggunakan link yang benar, hubungi admin untuk memastikan akun sudah dibuat.'
    );
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
        if (error.status === 429 || /rate limit|too many/i.test(error.message || ''))
            throw new Error('Terlalu banyak percobaan login. Tunggu ±15 menit lalu coba lagi.');
        throw new Error('Password salah. Jika baru pertama login, hubungi admin sekolah untuk password sementara Anda.');
    }
}

export async function logout() {
    await supabase.auth.signOut();
}

export async function getCurrentUserRow(authUser = null) {
    const user = authUser ?? (await supabase.auth.getUser()).data?.user;
    if (!user) return null;
    const { data, error } = await supabase
        .from('users')
        .select('user_id, school_id, full_name, role_type, login_identifier, is_active, must_change_password, last_seen_at, last_seen_ua')
        .eq('auth_user_id', user.id)
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
    let q = supabase
        .from('teaching_schedules')
        .select(`
            schedule_id,
            block_group_id,
            session_date,
            session_start,
            session_end,
            subject:subjects ( name ),
            teacher:users!teaching_schedules_scheduled_teacher_id_fkey ( full_name ),
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

    // Group by block_group_id
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

export async function getMyCases(studentId) {
    const { data, error } = await supabase
        .from('coaching_cases')
        .select(`
            case_id, title, description, status, created_at,
            current_handler_user_id,
            handler:users!coaching_cases_current_handler_user_id_fkey ( full_name ),
            events:coaching_case_events (
                event_id, event_type, payload, created_at, is_visible_to_student,
                author:users!coaching_case_events_author_user_id_fkey ( full_name )
            )
        `)
        .eq('student_id', studentId)
        .eq('is_shared_to_student', true)
        .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(c => ({
        ...c,
        events: (c.events ?? [])
            .filter(e => e.is_visible_to_student === true)
            .sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
    }));
}

/**
 * Catatan siswa yang boleh dilihat siswa ini.
 * RLS rls_observations_read_student membatasi ke visibility
 * SISWA_SAJA atau SISWA_DAN_ORTU untuk student_id yang cocok.
 */
export async function getMyObservations(studentId, dateStart = null, dateEnd = null) {
    let query = supabase
        .from('observations')
        .select(`
            observation_id, dimension, sentiment, content, observed_at, created_at,
            author:users!observations_author_user_id_fkey ( full_name )
        `)
        .eq('student_id', studentId)
        .order('observed_at', { ascending: false })
        .limit(100);
    if (dateStart) query = query.gte('observed_at', dateStart);
    if (dateEnd)   query = query.lte('observed_at', dateEnd + 'T23:59:59');
    const { data, error } = await query;
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
        .select('attendance_date, status, notes')
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
        .select('notification_id, type, title, body, is_read, case_id, forum_post_id, late_arrival_id, created_at')
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

export async function addForumSekolahAck(postId, userId, schoolId) {
    const { error } = await supabase
        .from('forum_post_acknowledgements')
        .upsert(
            { post_id: postId, user_id: userId, school_id: schoolId },
            { onConflict: 'post_id,user_id', ignoreDuplicates: true }
        );
    if (error) throw error;
}

export async function getMyLateArrivals(studentId) {
    try {
        const { data, error } = await supabase
            .from('late_arrivals')
            .select('late_id, late_date, arrival_time, reason')
            .eq('student_id', studentId)
            .order('late_date', { ascending: false })
            .order('arrival_time', { ascending: false });
        if (error) { console.warn('[late] getMyLateArrivals error:', error.message); return []; }
        return (data ?? []).map(r => ({
            late_id:      r.late_id,
            date:         r.late_date,
            arrival_time: r.arrival_time,
            reason:       r.reason ?? '',
        }));
    } catch (e) {
        console.warn('[late] getMyLateArrivals exception:', e);
        return [];
    }
}

export async function getMyExits(studentId) {
    try {
        const { data, error } = await supabase
            .from('student_exits')
            .select('exit_id, exit_date, exit_time, return_time, reason')
            .eq('student_id', studentId)
            .order('exit_date', { ascending: false })
            .order('exit_time', { ascending: false });
        if (error) { console.warn('[exits] getMyExits error:', error.message); return []; }
        return data ?? [];
    } catch (e) { console.warn('[exits] getMyExits exception:', e); return []; }
}
