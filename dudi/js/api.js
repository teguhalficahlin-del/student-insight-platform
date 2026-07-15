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
export async function saveAttendance({ placementId, studentId, date, status, notes, userId }) {
    const payload = {
        placement_id:        placementId,
        student_id:          studentId,
        attendance_date:     date,
        status,
        notes:               notes || null,
        recorded_by_user_id: userId,
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

/**
 * Simpan observasi baru.
 * Visibility ditentukan trigger DB: POSITIF→STUDENT_VISIBLE, NEGATIF→INTERNAL_SCHOOL.
 */
// ─── KASUS PKL ───────────────────────────────────────────────
// DUDI hanya boleh: buat (PRIVATE, track=PKL), eskalasi ke KAPRODI, tutup, komentar.

async function _getToken() {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token ?? null;
}

export async function createDudiCase({ studentId, title, description, authorUserId, authorRole }) {
    const token = await _getToken();
    if (!token) throw new Error('Sesi tidak valid');
    const payload = {
        idempotency_key:    crypto.randomUUID(),
        case_id:            crypto.randomUUID(),
        student_id:         studentId,
        created_by_user_id: authorUserId,
        initiated_by_role:  authorRole,  // DUDI
        track:              'PKL',
        title,
        description,
        audience:           'PRIVATE',   // DUDI selalu PRIVATE
    };
    const res = await fetch(`${SUPABASE_URL}/functions/v1/sync-case`, {
        method:  'POST',
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
    return { case_id: payload.case_id };
}

export async function getDudiCases() {
    const { data, error } = await supabase
        .from('cases')
        .select('case_id, title, status, current_handler_role, created_at, student:students!cases_student_id_fkey(full_name, nis)')
        .eq('track', 'PKL')
        .order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
}

export async function getDudiCaseEvents(caseId) {
    const { data, error } = await supabase
        .from('case_events')
        .select('event_id, event_type, author_role_at_time, new_handler_role, previous_status, new_status, payload, created_at, author:users!case_events_author_user_id_fkey(full_name)')
        .eq('case_id', caseId)
        .order('created_at', { ascending: true });
    if (error) throw error;
    return data ?? [];
}

export async function addDudiCaseComment({ caseId, text, authorUserId, authorRole }) {
    const { error } = await supabase
        .from('case_events')
        .insert({
            case_id:             caseId,
            event_type:          'COMMENT_ADDED',
            author_user_id:      authorUserId,
            author_role_at_time: authorRole,
            privacy_level:       'INTERNAL_SCHOOL',
            payload:             { text },
        });
    if (error) throw error;
}

// Eskalasi DUDI hanya ke KAPRODI — ditegakkan trigger server
export async function escalateDudiCase({ caseId, note, authorUserId, authorRole }) {
    const { error } = await supabase
        .from('case_events')
        .insert({
            case_id:              caseId,
            event_type:           'DECISION_ESCALATE',
            author_user_id:       authorUserId,
            author_role_at_time:  authorRole,
            previous_handler_role: 'DUDI',
            new_handler_role:     'KAPRODI',
            previous_status:      'OPEN',
            new_status:           'UNDER_REVIEW',
            payload:              note ? { text: note } : {},
        });
    if (error) throw error;
}

export async function closeDudiCase({ caseId, note, authorUserId, authorRole }) {
    const { error } = await supabase
        .from('case_events')
        .insert({
            case_id:             caseId,
            event_type:          'DECISION_CLOSE',
            author_user_id:      authorUserId,
            author_role_at_time: authorRole,
            previous_status:     null,
            new_status:          'CLOSED',
            payload:             note ? { text: note } : {},
        });
    if (error) throw error;
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

// ─── OBSERVASI ───────────────────────────────────────────────
export async function saveObservation({ studentId, sentiment, dimension, content, userId }) {
    const visibility = sentiment === 'POSITIF' ? 'STUDENT_VISIBLE' : 'INTERNAL_SCHOOL';

    const { error } = await supabase
        .from('observations')
        .insert({
            student_id:     studentId,
            author_user_id: userId,
            sentiment,
            dimension,
            content,
            visibility,
            observed_at:    new Date().toISOString().slice(0, 10),
        });

    if (error) throw error;
}
