/**
 * @file stakeholder/js/api.js
 * Supabase wrapper untuk Portal Stakeholder (view-only).
 *
 * Stakeholder hanya melihat ringkasan agregat sekolah (angka & %),
 * tidak ada akses row-level (tidak ada PII). Data diambil lewat RPC
 * fn_stakeholder_summary (SECURITY DEFINER) — lihat migrasi
 * 20260630190000_stakeholder_summary_rpc.sql.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL      = 'https://xovvuuwexoweoqyltepq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhvdnZ1dXdleG93ZW9xeWx0ZXBxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMDk0NzUsImV4cCI6MjA5Nzc4NTQ3NX0.mFwmVfSqYM7ITURtLC143BsurK6Yr31WFViJe5PFGN8';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: true, persistSession: true, storage: localStorage },
});

// Role yang boleh masuk portal ini
export const STAKEHOLDER_ROLES = ['STAKEHOLDER'];

export async function loginWithIdentifier(identifier, password, schoolId = null) {
    const { data: email, error: resolveErr } = await supabase
        .rpc('fn_resolve_login_email', { p_identifier: identifier, p_school_id: schoolId });
    if (resolveErr) throw new Error('Gagal menghubungi server. Coba lagi.');
    if (!email) throw new Error('Kode login tidak dikenali. Pastikan yang dimasukkan adalah KODE LOGIN (contoh: KOMITE01), bukan nama lembaga. Admin sekolah dapat melihat kode Anda di menu Stakeholder.');
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
        .select('user_id, school_id, full_name, role_type, is_active, must_change_password, last_seen_at, last_seen_ua')
        .eq('auth_user_id', user.id)
        .maybeSingle();
    if (error) throw error;
    return data;
}

/**
 * Ringkasan agregat sekolah (non-PII) via RPC SECURITY DEFINER.
 */
export async function getStakeholderSummary() {
    const { data, error } = await supabase.rpc('fn_stakeholder_summary');
    if (error) throw error;
    return data ?? {};
}

/**
 * Monitoring kehadiran — RPC yang SAMA dengan yang dipakai Kepala Sekolah
 * (guru/js/api.js: getKepsekMonitoring). Sengaja satu fungsi, bukan salinan,
 * supaya angka yang dilihat Kepsek dan Stakeholder tidak pernah melenceng.
 *
 * Payload-nya agregat murni — persentase dan hitungan, tanpa PII.
 * school_id diturunkan server-side dari auth.uid(), bukan dari klien.
 */
export async function getKepsekMonitoring(period = 'hari_ini', academicYear = null, dateStart = null, dateEnd = null) {
    const { data, error } = await supabase.rpc('fn_kepsek_monitoring', {
        p_period:        period,
        p_academic_year: academicYear,
        p_date_start:    dateStart,
        p_date_end:      dateEnd,
    });
    if (error) throw error;
    return data;
}

/**
 * Tahun ajaran aktif — dipakai untuk menghitung label "Tahun Lalu".
 * RLS school_config mengizinkan SELECT untuk setiap pengguna terautentikasi
 * di sekolah yang sama (rls_school_config_read_all), termasuk STAKEHOLDER.
 */
export async function getSchoolConfig() {
    const { data } = await supabase.from('school_config').select('current_academic_year, current_semester').single();
    return data;
}
