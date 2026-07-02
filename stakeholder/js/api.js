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
    auth: { autoRefreshToken: true, persistSession: true },
});

// Role yang boleh masuk portal ini
export const STAKEHOLDER_ROLES = ['STAKEHOLDER'];

export async function loginWithIdentifier(identifier, password, schoolId = null) {
    const { data: email, error: resolveErr } = await supabase
        .rpc('fn_resolve_login_email', { p_identifier: identifier, p_school_id: schoolId });
    if (resolveErr || !email) throw new Error('Kode akses atau password salah');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error('Kode akses atau password salah');
}

export async function logout() {
    await supabase.auth.signOut();
}

export async function getCurrentUserRow() {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return null;
    const { data, error } = await supabase
        .from('users')
        .select('user_id, full_name, role_type, login_identifier, is_active')
        .eq('auth_user_id', auth.user.id)
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
