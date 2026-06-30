/**
 * @file dudi/js/api.js
 * Supabase wrapper untuk Portal DUDI (input absensi PKL & observasi).
 * Login pakai slug nama usaha (login_identifier), role_type = 'DUDI'.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL      = 'https://xovvuuwexoweoqyltepq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhvdnZ1dXdleG93ZW9xeWx0ZXBxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMDk0NzUsImV4cCI6MjA5Nzc4NTQ3NX0.mFwmVfSqYM7ITURtLC143BsurK6Yr31WFViJe5PFGN8';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: true, persistSession: true },
});

export async function loginWithIdentifier(identifier, password) {
    const { data: email, error: resolveErr } = await supabase
        .rpc('fn_resolve_login_email', { p_identifier: identifier });

    if (resolveErr || !email) throw new Error('ID login atau password salah');

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error('ID login atau password salah');
}

export async function getCurrentUserRow() {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData?.user) return null;

    const { data, error } = await supabase
        .from('users')
        .select('user_id, full_name, role_type, login_identifier, dudi_org_name')
        .eq('auth_user_id', authData.user.id)
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
