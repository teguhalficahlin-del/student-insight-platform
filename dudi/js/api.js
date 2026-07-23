/**
 * @file dudi/js/api.js
 * Supabase wrapper untuk Portal DUDI (input absensi PKL & observasi).
 * Login pakai slug nama usaha (login_identifier), role_type = 'DUDI'.
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

export async function loginWithIdentifier(identifier, password, schoolId = null) {
    const { data: email, error: resolveErr } = await supabase
        .rpc('fn_resolve_login_email', { p_identifier: identifier, p_school_id: schoolId });

    if (resolveErr) throw new Error('Gagal menghubungi server. Coba lagi.');
    if (!email) throw new Error('ID login tidak ditemukan. Hubungi admin sekolah untuk memastikan akun sudah dibuat.');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
        if (error.status === 429 || /rate limit|too many/i.test(error.message || ''))
            throw new Error('Terlalu banyak percobaan login. Tunggu ±15 menit lalu coba lagi.');
        throw new Error('Password salah. Jika baru pertama login, hubungi admin sekolah untuk password sementara Anda.');
    }
}

export async function getCurrentUserRow(authUser = null) {
    const user = authUser ?? (await supabase.auth.getUser()).data?.user;
    if (!user) return null;

    const { data, error } = await supabase
        .from('users')
        .select('user_id, school_id, full_name, role_type, login_identifier, dudi_org_name, is_active, must_change_password, last_seen_at, last_seen_ua')
        .eq('auth_user_id', user.id)
        .maybeSingle();

    if (error) throw error;
    return data;
}

export function isDudi(userRow) {
    return !!userRow && userRow.role_type === 'DUDI';
}

export async function logout() {
    await supabase.auth.signOut();
}

/**
 * Daftar siswa PKL yang ditugaskan ke DUDI ini (penempatan aktif).
 * RLS rls_pkl_read_dudi membatasi ke dudi_user_id = current user.
 */
export async function fetchMyStudents() {
    const { data, error } = await supabase
        .from('pkl_placements')
        .select(`
            placement_id,
            start_date,
            end_date,
            student:students!pkl_placements_student_id_fkey (
                student_id, nis, full_name
            )
        `)
        .eq('is_active', true)
        .order('start_date', { ascending: true });

    if (error) throw error;

    return (data || []).map(p => ({
        placement_id: p.placement_id,
        start_date:   p.start_date,
        end_date:     p.end_date,
        student_id:   p.student.student_id,
        nis:          p.student.nis,
        full_name:    p.student.full_name,
    }));
}

/**
 * Absensi siswa-siswa untuk tanggal tertentu.
 * Mengembalikan Map<student_id, record> untuk lookup cepat.
 */
export async function fetchAttendanceForDate(studentIds, date) {
    if (!studentIds.length) return new Map();

    const { data, error } = await supabase
        .from('pkl_attendance')
        .select('pkl_attendance_id, placement_id, student_id, status, notes, check_in_time, check_out_time')
        .in('student_id', studentIds)
        .eq('attendance_date', date);

    if (error) throw error;

    return new Map((data || []).map(r => [r.student_id, r]));
}

/**
 * Simpan (upsert) absensi satu siswa untuk satu tanggal.
 * UNIQUE constraint: (placement_id, attendance_date) → upsert by conflict.
 */
export async function saveAttendance({ placementId, studentId, date, status, notes, userId, schoolId }) {
    const payload = {
        placement_id:        placementId,
        student_id:          studentId,
        attendance_date:     date,
        status,
        notes:               notes || null,
        recorded_by_user_id: userId,
        school_id:           schoolId,
    };

    const { error } = await supabase
        .from('pkl_attendance')
        .upsert(payload, { onConflict: 'placement_id,attendance_date' });

    if (error) throw error;
}

/**
 * Riwayat absensi N hari terakhir untuk daftar siswa.
 */
export async function fetchRecentAttendance(studentIds, days = 14) {
    if (!studentIds.length) return [];

    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceStr = since.toISOString().slice(0, 10);

    const { data, error } = await supabase
        .from('pkl_attendance')
        .select('pkl_attendance_id, student_id, attendance_date, status, notes')
        .in('student_id', studentIds)
        .gte('attendance_date', sinceStr)
        .order('attendance_date', { ascending: false });

    if (error) throw error;
    return data || [];
}

/**
 * Observasi yang sudah ditulis DUDI ini untuk siswa PKL-nya.
 */
export async function fetchMyObservations(studentIds) {
    if (!studentIds.length) return [];

    const { data: authData } = await supabase.auth.getUser();
    if (!authData?.user) return [];

    const { data: userRow } = await supabase
        .from('users')
        .select('user_id')
        .eq('auth_user_id', authData.user.id)
        .maybeSingle();

    if (!userRow) return [];

    const { data, error } = await supabase
        .from('observations')
        .select('observation_id, student_id, sentiment, dimension, content, observed_at, created_at')
        .in('student_id', studentIds)
        .eq('author_user_id', userRow.user_id)
        .order('created_at', { ascending: false })
        .limit(100);

    if (error) throw error;
    return data || [];
}

// ─── NOTIFIKASI ──────────────────────────────────────────────
export async function getUnreadNotifCount() {
    const { data, error } = await supabase.rpc('fn_count_unread_notifications');
    if (error) throw error;
    return Number(data ?? 0);
}

export async function getRecentNotifications(limit = 20) {
    const { data, error } = await supabase
        .from('notifications')
        .select('notification_id, type, title, body, is_read, created_at')
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

// ─── CATATAN SISWA ────────────────────────────────────────────
export async function getKaprodiAndWakaHumas(schoolId) {
    try {
        const { data, error } = await supabase
            .from('users')
            .select('user_id, role_type')
            .in('role_type', ['KAPRODI', 'WAKA_HUMAS'])
            .eq('school_id', schoolId)
            .eq('is_active', true)
            .is('deleted_at', null);
        if (error) { console.warn('[dudi] getKaprodiAndWakaHumas error:', error.message); return []; }
        return data ?? [];
    } catch (e) { console.warn('[dudi] getKaprodiAndWakaHumas exception:', e); return []; }
}

export async function addObservationAudience(observationId, studentId, schoolId) {
    try {
        const { data: studentData } = await supabase
            .from('students')
            .select('user_id')
            .eq('student_id', studentId)
            .maybeSingle();

        const { data: parents } = await supabase
            .from('student_parents')
            .select('parent_user_id')
            .eq('student_id', studentId)
            .eq('school_id', schoolId);

        const staffList = await getKaprodiAndWakaHumas(schoolId);

        const audienceRows = [];
        if (studentData?.user_id) {
            audienceRows.push({ observation_id: observationId, user_id: studentData.user_id, school_id: schoolId, added_by_user_id: null });
        }
        for (const p of (parents ?? [])) {
            audienceRows.push({ observation_id: observationId, user_id: p.parent_user_id, school_id: schoolId, added_by_user_id: null });
        }
        for (const s of staffList) {
            audienceRows.push({ observation_id: observationId, user_id: s.user_id, school_id: schoolId, added_by_user_id: null });
        }

        if (audienceRows.length > 0) {
            const { error } = await supabase
                .from('observation_audience_members')
                .insert(audienceRows);
            if (error) console.warn('[dudi] addObservationAudience error:', error.message);
        }
    } catch (e) { console.warn('[dudi] addObservationAudience exception:', e); }
}

export async function saveObservation({ studentId, sentiment, dimension, content, userId, schoolId }) {
    const observationId = crypto.randomUUID();

    const { error } = await supabase
        .from('observations')
        .insert({
            observation_id: observationId,
            student_id:     studentId,
            author_user_id: userId,
            sentiment,
            dimension,
            content,
            visibility:     'RESTRICTED',
            school_id:      schoolId,
            observed_at:    new Date().toISOString().slice(0, 10),
        });

    if (error) throw error;

    await addObservationAudience(observationId, studentId, schoolId).catch(e => {
        console.warn('[dudi] addObservationAudience non-fatal:', e);
    });
}
