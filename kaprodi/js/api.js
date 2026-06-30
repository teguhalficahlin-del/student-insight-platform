/**
 * @file kaprodi/js/api.js
 *
 * Supabase wrapper untuk dashboard Kaprodi (PKL).
 * Proyek Supabase sama dengan admin/portal lain — RLS yang menegakkan akses.
 *
 * Scoping program dilakukan di lapisan query ini (lihat fetchPklStudents):
 * RLS memberi Kaprodi baca semua, dashboard menyaring per program-nya —
 * pola sama dengan pkl_placements / students.
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
        throw new Error('NIP atau password salah');
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error('NIP atau password salah');

    return data.user;
}

/**
 * Ambil baris users milik akun yang login, termasuk dua kolom program:
 *   - program_id          : dipakai saat role_type = 'KAPRODI' (impor staf)
 *   - kaprodi_program_id   : penanda Kaprodi multi-peran (mis. guru + kaprodi)
 * Kaprodi efektif = kaprodi_program_id ?? program_id.
 */
export async function getCurrentUserRow() {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData?.user) return null;

    const { data, error } = await supabase
        .from('users')
        .select('user_id, full_name, role_type, login_identifier, program_id, kaprodi_program_id')
        .eq('auth_user_id', authData.user.id)
        .maybeSingle();

    if (error) throw error;
    return data;
}

/** Kaprodi = role KAPRODI, atau peran rangkap lewat kaprodi_program_id. */
export function isKaprodi(userRow) {
    return !!userRow && (userRow.role_type === 'KAPRODI' || !!userRow.kaprodi_program_id);
}

/** Program yang dikepalai (UUID), atau null bila bukan kaprodi. */
export function effectiveProgramId(userRow) {
    if (!userRow) return null;
    return userRow.kaprodi_program_id ?? userRow.program_id ?? null;
}

/**
 * Mitra DUDI yang ditautkan ke program ini (users.program_id = program
 * Kaprodi, role DUDI). Linkage diisi saat impor DUDI lewat kolom
 * kode_program. RLS mengizinkan Kaprodi membaca baris users DUDI.
 */
export async function fetchDudiPartners(programId) {
    const { data, error } = await supabase
        .from('users')
        .select('user_id, full_name, dudi_org_name, login_identifier')
        .eq('role_type', 'DUDI')
        .eq('program_id', programId)
        .order('dudi_org_name', { ascending: true });

    if (error) throw error;
    return (data || []).map(u => ({
        user_id:    u.user_id,
        org_name:   u.dudi_org_name ?? u.full_name,
        pic_name:   u.full_name,
        login:      u.login_identifier,
    }));
}

export async function getProgram(programId) {
    if (!programId) return null;
    const { data, error } = await supabase
        .from('programs')
        .select('program_id, code, name')
        .eq('program_id', programId)
        .maybeSingle();
    if (error) throw error;
    return data;
}

export async function logout() {
    await supabase.auth.signOut();
}

/**
 * Siswa di program ini yang BELUM berstatus PKL (kandidat penempatan baru).
 */
export async function fetchNonPklStudents(programId) {
    const { data, error } = await supabase
        .from('students')
        .select('student_id, nis, full_name, student_status')
        .eq('program_id', programId)
        .neq('student_status', 'PKL')
        .in('student_status', ['ACTIVE'])
        .order('full_name', { ascending: true });

    if (error) throw error;
    return data || [];
}

/**
 * Tambah satu penempatan PKL:
 *   1. INSERT pkl_placements
 *   2. UPDATE students.student_status = 'PKL'
 * Keduanya pakai session Kaprodi (RLS izinkan KAPRODI tulis keduanya).
 */
export async function createPlacement({ studentId, dudiUserId, startDate, endDate }) {
    const { error: plErr } = await supabase
        .from('pkl_placements')
        .insert({
            student_id:   studentId,
            dudi_user_id: dudiUserId,
            start_date:   startDate,
            end_date:     endDate,
            is_active:    true,
        });
    if (plErr) throw plErr;

    const { error: stuErr } = await supabase
        .from('students')
        .update({ student_status: 'PKL' })
        .eq('student_id', studentId);
    if (stuErr) throw stuErr;
}

/**
 * Impor penempatan PKL massal via edge function bulk-import-pkl.
 * csvText: isi file CSV (string).
 */
export async function bulkImportPkl(csvText) {
    const { data: authData } = await supabase.auth.getSession();
    const token = authData?.session?.access_token;
    if (!token) throw new Error('Sesi tidak valid. Silakan login ulang.');

    const res = await fetch(
        `${SUPABASE_URL}/functions/v1/bulk-import-pkl`,
        {
            method:  'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type':  'text/csv',
            },
            body: csvText,
        }
    );

    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
    return json.data;
}

/**
 * Siswa berstatus PKL pada program Kaprodi, beserta penempatan aktif
 * (DUDI / tempat usaha + periode). Disaring per program di sini.
 */
export async function fetchPklStudents(programId) {
    const { data, error } = await supabase
        .from('students')
        .select(`
            student_id,
            nis,
            full_name,
            student_status,
            placements:pkl_placements (
                placement_id,
                start_date,
                end_date,
                is_active,
                dudi:users!pkl_placements_dudi_user_id_fkey ( user_id, full_name, dudi_org_name )
            )
        `)
        .eq('program_id', programId)
        .eq('student_status', 'PKL')
        .order('full_name', { ascending: true });

    if (error) throw error;

    return (data || []).map(s => {
        const placements = Array.isArray(s.placements) ? s.placements : [];
        const active = placements.find(p => p.is_active) ?? placements[0] ?? null;
        return {
            student_id:   s.student_id,
            nis:          s.nis,
            full_name:    s.full_name,
            placement_id: active?.placement_id ?? null,
            dudi_name:    active?.dudi?.dudi_org_name ?? active?.dudi?.full_name ?? '—',
            start_date:   active?.start_date ?? null,
            end_date:     active?.end_date ?? null,
            has_placement: !!active,
        };
    });
}

/**
 * Rekap absensi PKL untuk sekumpulan siswa dalam rentang tanggal.
 * Mengembalikan array baris mentah; agregasi per-siswa dilakukan di dashboard.
 */
export async function fetchPklAttendance(studentIds, dateStart, dateEnd) {
    if (!studentIds || studentIds.length === 0) return [];

    let query = supabase
        .from('pkl_attendance')
        .select('pkl_attendance_id, student_id, attendance_date, status, check_in_time, check_out_time, notes')
        .in('student_id', studentIds)
        .order('attendance_date', { ascending: false });

    if (dateStart) query = query.gte('attendance_date', dateStart);
    if (dateEnd)   query = query.lte('attendance_date', dateEnd);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
}

/**
 * Observasi yang ditulis DUDI untuk siswa PKL pada program ini.
 * RLS mengizinkan Kaprodi baca semua observasi; di sini disaring ke
 * student_id program + penulis berperan DUDI.
 */
export async function fetchDudiObservations(studentIds) {
    if (!studentIds || studentIds.length === 0) return [];

    const { data, error } = await supabase
        .from('observations')
        .select(`
            observation_id,
            student_id,
            sentiment,
            dimension,
            content,
            observed_at,
            created_at,
            author:users!observations_author_user_id_fkey ( full_name, role_type, dudi_org_name )
        `)
        .in('student_id', studentIds)
        .order('created_at', { ascending: false })
        .limit(200);

    if (error) throw error;

    return (data || [])
        .filter(r => r.author?.role_type === 'DUDI')
        .map(r => ({
            id:         r.observation_id,
            student_id: r.student_id,
            sentiment:  r.sentiment,
            dimension:  r.dimension,
            content:    r.content,
            author:     r.author?.dudi_org_name ?? r.author?.full_name ?? '—',
            date:       r.observed_at ?? r.created_at,
        }));
}
