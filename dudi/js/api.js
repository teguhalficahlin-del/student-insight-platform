/**
 * @file dudi/js/api.js
 * Supabase wrapper untuk Portal DUDI (input absensi PKL & observasi).
 * Login pakai slug nama usaha (login_identifier), role_type = 'DUDI'.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL      = 'https://xovvuuwexoweoqyltepq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhvdnZ1dXdleG93ZW9xeWx0ZXBxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMDk0NzUsImV4cCI6MjA5Nzc4NTQ3NX0.mFwmVfSqYM7ITURtLC143BsurK6Yr31WFViJe5PFGN8';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: true, persistSession: true, storage: localStorage },
});

// Tanggal lokal dalam format YYYY-MM-DD. TIDAK memakai toISOString() yang
// berbasis UTC — di WIB (UTC+7) antara pukul 00:00-07:00, toISOString()
// mengembalikan tanggal KEMARIN, sehingga nilai yang ditulis ke DB (observed_at)
// tersimpan salah secara permanen. Sengaja diduplikasi dari dateToLocalStr() di
// dudi/js/dashboard.js agar api.js tidak punya dependency ke lapisan UI.
function localDateStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export async function loginWithIdentifier(identifier, password, schoolId = null) {
    const { data: email, error: resolveErr } = await supabase
        .rpc('fn_resolve_login_email', { p_identifier: identifier, p_school_id: schoolId });

    if (resolveErr) throw new Error('Gagal menghubungi server. Coba lagi.');
    if (!email) throw new Error('ID login tidak ditemukan. Hubungi admin sekolah untuk memastikan akun sudah dibuat.');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
        if (error.status === 429 || /rate limit|too many/i.test(error.message || ''))
            throw new Error('Terlalu banyak percobaan login. Tunggu ±15 menit lalu coba lagi.');
        throw new Error('Password salah. Kalau ini login pertama Anda, gunakan password awal 12345678. Kalau lupa password, minta admin sekolah mengembalikannya ke 12345678 lewat tombol Reset PW.');
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
 * Penempatan milik DUDI, termasuk yang selesai, dengan identitas siswa terbatas.
 */
export async function fetchMyPlacements() {
    const { data, error } = await supabase.rpc('fn_dudi_placements');
    if (error) throw error;
    return data || [];
}

/**
 * Absensi siswa-siswa untuk tanggal tertentu.
 * Mengembalikan Map<placement_id, record> agar riwayat siswa pindahan tidak tercampur.
 */
export async function fetchAttendanceForDate(placementIds, date) {
    if (!placementIds.length) return new Map();

    const { data, error } = await supabase
        .from('pkl_attendance')
        .select('pkl_attendance_id, placement_id, student_id, status, notes, check_in_time, check_out_time')
        .in('placement_id', placementIds)
        .eq('attendance_date', date);

    if (error) throw error;

    return new Map((data || []).map(r => [r.placement_id, r]));
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
export async function fetchRecentAttendance(placementIds, days = 14) {
    if (!placementIds.length) return [];

    const since = new Date();
    since.setDate(since.getDate() - days);
    // DUD-09-UTC: pakai tanggal LOKAL, bukan toISOString() yang berbasis UTC.
    // Di WIB (UTC+7) pukul 00:00-07:00, toISOString() mengembalikan tanggal
    // KEMARIN sehingga window query melebar satu hari. Pola sama dengan
    // localDateStr() di atas; helper itu tidak bisa dipakai langsung karena
    // tidak menerima parameter Date.
    const sinceStr = `${since.getFullYear()}-${String(since.getMonth()+1).padStart(2,'0')}-${String(since.getDate()).padStart(2,'0')}`;

    const { data, error } = await supabase
        .from('pkl_attendance')
        .select('pkl_attendance_id, placement_id, student_id, attendance_date, status, notes')
        .in('placement_id', placementIds)
        .gte('attendance_date', sinceStr)
        .lte('attendance_date', localDateStr())
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

    const { data: userRow, error: userError } = await supabase
        .from('users')
        .select('user_id')
        .eq('auth_user_id', authData.user.id)
        .maybeSingle();

    if (userError) throw userError;
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

export async function saveObservation({ studentId, sentiment, dimension, content, userId, schoolId }) {
    content = content.trim();
    if ([...content].length < 10 || [...content].length > 1000) {
        throw new Error('Catatan harus berisi 10 sampai 1000 karakter.');
    }
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
            observed_at:    localDateStr(),
        });

    if (error) throw error;
    return {};
}
