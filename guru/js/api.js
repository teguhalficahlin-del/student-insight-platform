/**
 * @file guru/js/api.js
 * Supabase wrapper untuk Portal Guru (semua peran staf sekolah).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { saveObservation, saveJournalEntry, saveCase } from './offline.js';

// Diekspor agar offline.js dapat memakainya di postEdgeFn tanpa membuat
// client Supabase duplikat (regresi 6ded3e5: konstanta ini pernah terhapus
// bersama client duplikat, membuat postEdgeFn lempar ReferenceError → semua
// submit edge-function guru gagal senyap dan mengantre selamanya).
export const SUPABASE_URL      = 'https://xovvuuwexoweoqyltepq.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhvdnZ1dXdleG93ZW9xeWx0ZXBxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMDk0NzUsImV4cCI6MjA5Nzc4NTQ3NX0.mFwmVfSqYM7ITURtLC143BsurK6Yr31WFViJe5PFGN8';

try {
    const _mk = 'sb-xovvuuwexoweoqyltepq-auth-token';
    const _lv = localStorage.getItem(_mk);
    if (_lv && !sessionStorage.getItem(_mk)) { sessionStorage.setItem(_mk, _lv); localStorage.removeItem(_mk); }
} catch { /* private mode */ }

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: true, persistSession: true, storage: sessionStorage },
});

// Semua role_type yang boleh masuk portal ini
export const GURU_ROLES = ['GURU','WALI_KELAS','BK','KAPRODI','KEPSEK','WAKA_KURIKULUM','WAKA_KESISWAAN','WAKA_HUMAS'];

export async function loginWithIdentifier(identifier, password, schoolId = null) {
    const { data: email, error: resolveErr } = await supabase
        .rpc('fn_resolve_login_email', { p_identifier: identifier, p_school_id: schoolId });
    if (resolveErr) throw new Error('Gagal menghubungi server. Coba lagi.');
    if (!email) throw new Error('NIP/NIK tidak ditemukan di sekolah ini. Hubungi admin untuk memastikan akun sudah dibuat.');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
        if (error.status === 429 || /rate limit|too many/i.test(error.message || ''))
            throw new Error('Terlalu banyak percobaan login. Tunggu ±15 menit lalu coba lagi.');
        throw new Error('Password salah. Jika baru pertama login, gunakan password default dari admin.');
    }
}

export async function logout() {
    await supabase.auth.signOut();
}

// ── Peringatan login dari perangkat baru (Item 5, Opsi A) ─────
// Menghitung "sidik jari" perangkat stabil (id acak persisten di
// localStorage + userAgent) lalu mendaftarkannya lewat RPC. Bila
// perangkat belum pernah dipakai (dan bukan yang pertama), server
// menaruh notifikasi "Login dari perangkat baru" di lonceng.
// Non-blocking & fail-safe: kegagalan tidak pernah menghalangi login.
function parseDeviceLabel(ua) {
    ua = ua || '';
    let browser = 'Browser';
    if (/Edg\//.test(ua))            browser = 'Edge';
    else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
    else if (/Chrome\//.test(ua))    browser = 'Chrome';
    else if (/Firefox\//.test(ua))   browser = 'Firefox';
    else if (/Safari\//.test(ua))    browser = 'Safari';
    let os = 'perangkat';
    if (/Windows/.test(ua))                 os = 'Windows';
    else if (/Android/.test(ua))            os = 'Android';
    else if (/iPhone|iPad|iOS/.test(ua))    os = 'iOS';
    else if (/Mac OS X|Macintosh/.test(ua)) os = 'Mac';
    else if (/Linux/.test(ua))              os = 'Linux';
    return `${browser} di ${os}`;
}

export async function registerLoginDevice() {
    try {
        let devId = localStorage.getItem('sip_device_id');
        if (!devId) { devId = crypto.randomUUID(); localStorage.setItem('sip_device_id', devId); }
        const ua  = navigator.userAgent || '';
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(devId + '|' + ua));
        const hash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
        const { data, error } = await supabase.rpc('fn_register_login_device', {
            p_device_hash: hash,
            p_user_agent:  ua.slice(0, 400),
            p_label:       parseDeviceLabel(ua),
        });
        if (error) { console.warn('[login-device]', error.message); return null; }
        return data; // 'known' | 'first' | 'new'
    } catch (e) {
        console.warn('[login-device]', e);
        return null;
    }
}

export async function getCurrentUserRow() {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return null;
    const { data, error } = await supabase
        .from('users')
        .select(`
            user_id, school_id, full_name, role_type, login_identifier, teacher_code,
            wali_kelas_class_id, kaprodi_program_id,
            is_bk, is_kepsek, is_waka_kurikulum, is_waka_kesiswaan, is_waka_humas, is_active,
            must_change_password, last_seen_at, last_seen_ua
        `)
        .eq('auth_user_id', auth.user.id)
        .maybeSingle();
    if (error) throw error;
    return data;
}

/**
 * Kembalikan daftar jabatan aktif user berdasarkan role_type + flag tambahan.
 * Dipakai untuk menentukan tab mana yang muncul di dashboard.
 */
export function getJabatan(u) {
    if (!u) return [];
    const j = [];
    if (u.role_type === 'WALI_KELAS' || u.wali_kelas_class_id) j.push('wali_kelas');
    if (u.role_type === 'BK'         || u.is_bk)               j.push('bk');
    if (u.role_type === 'KAPRODI'    || u.kaprodi_program_id)   j.push('kaprodi');
    if (u.role_type === 'WAKA_KESISWAAN' || u.is_waka_kesiswaan) j.push('waka_kesiswaan');
    if (u.role_type === 'WAKA_KURIKULUM' || u.is_waka_kurikulum) j.push('waka_kurikulum');
    if (u.role_type === 'KEPSEK'     || u.is_kepsek)            j.push('kepsek');
    if (u.role_type === 'WAKA_HUMAS' || u.is_waka_humas)        j.push('waka_humas');
    return j;
}

export function jabatanLabel(key) {
    return {
        wali_kelas:    'Wali Kelas',
        bk:            'BK',
        kaprodi:       'Kaprodi',
        waka_kesiswaan:'Waka Kesiswaan',
        waka_kurikulum:'Waka Kurikulum',
        kepsek:        'Kepala Sekolah',
        waka_humas:    'Waka Humas',
    }[key] ?? key;
}

// ─── JADWAL GURU ────────────────────────────────────────────

export async function getSchoolConfig() {
    const { data } = await supabase.from('school_config').select('current_academic_year, current_semester').single();
    return data;
}

/**
 * Jadwal mengajar guru pada tanggal tertentu.
 * Filter langsung via scheduled_teacher_id (tidak perlu join ke assignments).
 */
export async function getMyScheduleForDate(userId, date) {
    const { data, error } = await supabase
        .from('teaching_schedules')
        .select(`
            schedule_id, session_date, session_start, session_end,
            class:classes ( class_id, name )
        `)
        .eq('session_date', date)
        .eq('scheduled_teacher_id', userId)
        .order('session_start');
    if (error) throw error;
    return data ?? [];
}

/**
 * Kelas unik yang diampu guru ini pada tahun ajaran + semester tertentu.
 * Dipakai untuk dropdown rekap absensi guru.
 */
export async function getMyClasses(userId, academicYear, semester) {
    const { data, error } = await supabase
        .from('teaching_assignments')
        .select('class:classes ( class_id, name )')
        .eq('user_id', userId)
        .eq('academic_year', academicYear)
        .eq('semester', semester)
        .eq('is_active', true);
    if (error) throw error;
    const seen = new Set();
    const classes = [];
    for (const ta of data ?? []) {
        const c = ta.class;
        if (c && !seen.has(c.class_id)) {
            seen.add(c.class_id);
            classes.push(c);
        }
    }
    return classes.sort((a, b) => a.name.localeCompare(b.name, 'id'));
}

// ─── SISWA & KEHADIRAN ───────────────────────────────────────

/**
 * Daftar siswa aktif di suatu kelas (via class_enrollments, tidak withdrawn).
 */
export async function getEnrolledStudents(classId, academicYear) {
    const { data, error } = await supabase
        .from('class_enrollments')
        .select('student:students ( student_id, nis, full_name, student_status )')
        .eq('class_id', classId)
        .eq('academic_year', academicYear)
        .is('withdrawn_at', null)
        .order('student(full_name)');
    if (error) throw error;
    // DROPOUT-1 (Tema I): roster kelas hanya siswa AKTIF — siswa KELUAR/LULUS/PKL
    // tak ikut diabsen di kelas (PKL diabsen via pkl_attendance). Riwayat mereka
    // tetap terlihat di tampilan lain; ini hanya menyaring daftar absen harian.
    return (data ?? []).map(r => r.student)
        .filter(s => s && s.student_status === 'AKTIF')
        .sort((a, b) => a.full_name.localeCompare(b.full_name, 'id'));
}

/**
 * Kehadiran yang sudah ada untuk satu sesi jadwal.
 * Returns Map: student_id → { attendance_id, status, notes }
 */
export async function getAttendanceForSession(scheduleId) {
    const { data, error } = await supabase
        .from('attendance')
        .select('attendance_id, student_id, status, notes')
        .eq('schedule_id', scheduleId);
    if (error) throw error;
    const map = new Map();
    for (const r of data ?? []) map.set(r.student_id, r);
    return map;
}

// Catatan (ABS-5, audit absensi 2026-07-04): fungsi upsertAttendance dihapus.
// Ia menulis langsung ke tabel attendance tanpa validasi enrolmen (yang hanya
// ada di jalur edge sync-attendance-batch) dan sudah tidak dipakai — semua
// penyimpanan absensi lewat saveAttendanceBatch → edge. Jangan hidupkan kembali
// jalur tulis langsung tanpa validasi siswa-terdaftar setara jalur edge.

// ─── OBSERVASI ───────────────────────────────────────────────

/**
 * Semua siswa di kelas-kelas yang diajar guru ini (untuk selector observasi).
 * Ambil via teaching_assignments aktif periode berjalan.
 */
export async function getMyStudents(userId, academicYear, semester) {
    const { data, error } = await supabase
        .from('teaching_assignments')
        .select('class:classes ( class_id, name, enrollments:class_enrollments ( student:students ( student_id, nis, full_name ) ) )')
        .eq('user_id', userId)
        .eq('academic_year', academicYear)
        .eq('semester', semester)
        .eq('is_active', true);
    if (error) throw error;

    const seen = new Set();
    const students = [];
    for (const ta of data ?? []) {
        for (const en of ta.class?.enrollments ?? []) {
            const s = en.student;
            if (s && !seen.has(s.student_id)) {
                seen.add(s.student_id);
                students.push({ ...s, class_name: ta.class?.name });
            }
        }
    }
    return students.sort((a, b) => a.full_name.localeCompare(b.full_name, 'id'));
}

/**
 * Pencarian siswa sisi-server untuk observer berjangkauan luas
 * (BK / Kaprodi / Waka Kesiswaan / Kepsek) yang mungkin tidak mengajar
 * sehingga getMyStudents (berbasis teaching_assignments) kosong.
 * Cakupan hasil dibatasi RLS sesuai peran pemanggil.
 */
export async function searchStudents(query) {
    const q = (query ?? '').trim();
    if (q.length < 2) return [];
    const term = `%${q}%`;
    const { data, error } = await supabase
        .from('students')
        .select('student_id, nis, full_name, student_status')
        .or(`full_name.ilike.${term},nis.ilike.${term}`)
        .in('student_status', ['AKTIF', 'PKL'])
        .order('full_name')
        .limit(15);
    if (error) throw error;
    return (data ?? []).map(s => ({ ...s, class_name: '' }));
}

/**
 * Simpan observasi baru. Offline-capable: antre ke IndexedDB bila jaringan mati.
 * @returns {{status:'synced'|'queued'|'error', error?:string}}
 */
export async function insertObservation({ authorId, studentId, dimension, sentiment, visibility, content }) {
    const payload = {
        idempotency_key: crypto.randomUUID(),
        observation_id:  crypto.randomUUID(),
        author_user_id:  authorId,
        student_id:      studentId,
        dimension,
        sentiment,
        visibility,
        content,
        observed_at:     new Date().toISOString().slice(0, 10),
    };
    return saveObservation(payload);
}

// ─── WALI KELAS ──────────────────────────────────────────────

export async function getWaliKelasInfo(classId) {
    if (!classId) return null;
    const { data } = await supabase
        .from('classes')
        .select('class_id, name, grade_level')
        .eq('class_id', classId)
        .maybeSingle();
    return data;
}

/**
 * Rekap kehadiran per siswa di kelas wali kelas (untuk dashboard wali).
 * Returns [{ student_id, full_name, nis, HADIR, TIDAK_HADIR, IZIN, SAKIT, total }]
 * Catatan: EKSKUL dihapus dari absensi → data lama berstatus EKSKUL dihitung HADIR.
 */
export async function getWaliAttendanceSummary(classId, academicYear, dateStart, dateEnd) {
    // 1. Ambil daftar siswa
    const students = await getEnrolledStudents(classId, academicYear);
    if (students.length === 0) return [];
    const ids = students.map(s => s.student_id);

    // 2. Ambil kehadiran dalam rentang berdasarkan TANGGAL SESI (session_date),
    //    bukan created_at (waktu input). Mulai dari teaching_schedules lalu
    //    !inner ke attendance (PostgREST tak bisa filter kolom embedded non-inner).
    let q = supabase
        .from('teaching_schedules')
        .select('session_date, attendance!inner ( student_id, status, is_void )')
        .in('attendance.student_id', ids)
        .eq('attendance.is_void', false);
    if (dateStart) q = q.gte('session_date', dateStart);
    if (dateEnd)   q = q.lte('session_date', dateEnd);
    const { data, error } = await q;
    if (error) throw error;

    const map = new Map(students.map(s => [s.student_id, { ...s, HADIR: 0, TIDAK_HADIR: 0, IZIN: 0, SAKIT: 0, total: 0 }]));
    for (const sched of data ?? []) {
        for (const r of sched.attendance ?? []) {
            const agg = map.get(r.student_id);
            if (!agg) continue;
            // EKSKUL dihapus dari absensi → dihitung sebagai HADIR (kompat data lama)
            const st = r.status === 'EKSKUL' ? 'HADIR' : r.status;
            if (agg[st] !== undefined) agg[st]++;
            agg.total++;
        }
    }
    return [...map.values()];
}

// ─── KAPRODI (pindahan dari /kaprodi/) ───────────────────────

export async function getProgram(programId) {
    if (!programId) return null;
    const { data, error } = await supabase.from('programs').select('program_id, code, name').eq('program_id', programId).maybeSingle();
    if (error) throw error;
    return data;
}

export async function fetchPklStudents(programId) {
    const { data, error } = await supabase
        .from('students')
        .select(`
            student_id, nis, full_name, student_status,
            placements:pkl_placements (
                placement_id, start_date, end_date, is_active,
                dudi:users!pkl_placements_dudi_user_id_fkey ( user_id, full_name, dudi_org_name )
            )
        `)
        .eq('program_id', programId)
        .eq('student_status', 'PKL')
        .order('full_name');
    if (error) throw error;
    return (data ?? []).map(s => {
        const active = (s.placements ?? []).find(p => p.is_active) ?? s.placements?.[0] ?? null;
        return {
            student_id:   s.student_id, nis: s.nis, full_name: s.full_name,
            placement_id: active?.placement_id ?? null,
            dudi_name:    active?.dudi?.dudi_org_name ?? active?.dudi?.full_name ?? '—',
            start_date:   active?.start_date ?? null, end_date: active?.end_date ?? null,
            has_placement: !!active,
        };
    });
}

export async function fetchNonPklStudents(programId) {
    const { data, error } = await supabase
        .from('students')
        .select('student_id, nis, full_name')
        .eq('program_id', programId)
        .in('student_status', ['AKTIF'])
        .order('full_name');
    if (error) throw error;
    return data ?? [];
}

export async function fetchDudiPartners(programId) {
    const { data, error } = await supabase
        .from('users')
        .select('user_id, full_name, dudi_org_name')
        .eq('role_type', 'DUDI')
        .eq('program_id', programId)
        .order('dudi_org_name');
    if (error) throw error;
    return (data ?? []).map(u => ({ user_id: u.user_id, org_name: u.dudi_org_name ?? u.full_name, pic_name: u.full_name }));
}

export async function fetchPklAttendance(studentIds, dateStart, dateEnd) {
    if (!studentIds?.length) return [];
    let q = supabase.from('pkl_attendance').select('student_id, attendance_date, status').in('student_id', studentIds).order('attendance_date', { ascending: false });
    if (dateStart) q = q.gte('attendance_date', dateStart);
    if (dateEnd)   q = q.lte('attendance_date', dateEnd);
    const { data, error } = await q;
    if (error) throw error;
    return data ?? [];
}

export async function fetchDudiObservations(studentIds) {
    if (!studentIds?.length) return [];
    const { data, error } = await supabase
        .from('observations')
        .select(`observation_id, student_id, sentiment, dimension, content, observed_at, created_at, author:users!observations_author_user_id_fkey ( full_name, role_type, dudi_org_name )`)
        .in('student_id', studentIds)
        .order('created_at', { ascending: false })
        .limit(200);
    if (error) throw error;
    return (data ?? []).filter(r => r.author?.role_type === 'DUDI').map(r => ({
        id: r.observation_id, student_id: r.student_id, sentiment: r.sentiment,
        dimension: r.dimension, content: r.content,
        author: r.author?.dudi_org_name ?? r.author?.full_name ?? '—',
        date: r.observed_at ?? r.created_at,
    }));
}

// Semua siswa PKL lintas program (untuk Waka Humas)
export async function fetchAllPklStudents() {
    const { data, error } = await supabase
        .from('students')
        .select(`
            student_id, nis, full_name, student_status,
            program:programs ( program_name ),
            placements:pkl_placements (
                placement_id, start_date, end_date, is_active,
                dudi:users!pkl_placements_dudi_user_id_fkey ( user_id, full_name, dudi_org_name )
            )
        `)
        .eq('student_status', 'PKL')
        .order('full_name');
    if (error) throw error;
    return (data ?? []).map(s => {
        const active = (s.placements ?? []).find(p => p.is_active) ?? s.placements?.[0] ?? null;
        return {
            student_id:   s.student_id, nis: s.nis, full_name: s.full_name,
            program_name: s.program?.program_name ?? '—',
            placement_id: active?.placement_id ?? null,
            dudi_name:    active?.dudi?.dudi_org_name ?? active?.dudi?.full_name ?? '—',
            start_date:   active?.start_date ?? null, end_date: active?.end_date ?? null,
            has_placement: !!active,
        };
    });
}

// Semua mitra DUDI lintas program (untuk Waka Humas)
export async function fetchAllDudiPartners() {
    const { data, error } = await supabase
        .from('users')
        .select('user_id, full_name, dudi_org_name, program:programs ( program_name )')
        .eq('role_type', 'DUDI')
        .order('dudi_org_name');
    if (error) throw error;
    return (data ?? []).map(u => ({
        user_id: u.user_id,
        org_name: u.dudi_org_name ?? u.full_name,
        pic_name: u.full_name,
        program_name: u.program?.program_name ?? '—',
    }));
}

export async function createPlacement({ studentId, dudiUserId, startDate, endDate }) {
    const { error } = await supabase.from('pkl_placements').insert({ student_id: studentId, dudi_user_id: dudiUserId, start_date: startDate, end_date: endDate, is_active: true });
    if (error) throw error;
    const today = new Date().toISOString().slice(0, 10);
    if (startDate <= today) {
        const { error: e2 } = await supabase.from('students').update({ student_status: 'PKL' }).eq('student_id', studentId);
        if (e2) throw e2;
    }
}

export async function bulkImportPkl(csvText) {
    const { data: authData } = await supabase.auth.getSession();
    const token = authData?.session?.access_token;
    if (!token) throw new Error('Sesi tidak valid. Silakan login ulang.');
    const res = await fetch(`${SUPABASE_URL}/functions/v1/bulk-import-pkl`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'text/csv' },
        body: csvText,
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
    return json.data;
}

// ─── KEPSEK / WAKA ──────────────────────────────────────────

export async function getSchoolStats(academicYear, semester) {
    const today = new Date().toISOString().slice(0, 10);
    const [studentsRes, staffRes, schedToday, attToday] = await Promise.all([
        supabase.from('students').select('student_id', { count: 'exact', head: true }).eq('student_status', 'AKTIF'),
        supabase.from('users').select('user_id', { count: 'exact', head: true }).not('role_type', 'in', '("SISWA","ORTU","DUDI","ADMINISTRATIVE","STAKEHOLDER")'),
        supabase.from('teaching_schedules').select('schedule_id, class_id', { count: 'exact' }).eq('session_date', today).eq('academic_year', academicYear),
        supabase.from('attendance').select('status', { count: 'exact' }).gte('created_at', today + 'T00:00:00').eq('status', 'HADIR'),
    ]);
    return {
        total_siswa:       studentsRes.count ?? 0,
        total_staf:        staffRes.count ?? 0,
        sesi_hari_ini:     schedToday.count ?? 0,
        kehadiran_hari_ini: attToday.count ?? 0,
    };
}

export async function getKepsekMonitoring(period = 'hari_ini', academicYear = null) {
    const { data, error } = await supabase.rpc('fn_kepsek_monitoring', {
        p_period: period,
        p_academic_year: academicYear,
    });
    if (error) throw error;
    return data;
}

export async function getAbsentTeachersToday() {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
        .from('teaching_schedules')
        .select('schedule_id, session_start, session_end, scheduled_teacher_id, class:classes(name), teacher:users(full_name)')
        .eq('session_date', today)
        .eq('meeting_status', 'GURU_TIDAK_HADIR');
    if (error) throw error;
    return data ?? [];
}

// ─── WAKA KESISWAAN ─────────────────────────────────────────

export async function getAttendanceRecapPerClass(dateStart, dateEnd) {
    let q = supabase
        .from('teaching_schedules')
        .select('class:classes(class_id, name), attendance!inner(status, is_void)')
        .eq('attendance.is_void', false);
    if (dateStart) q = q.gte('session_date', dateStart);
    if (dateEnd)   q = q.lte('session_date', dateEnd);
    const { data, error } = await q;
    if (error) throw error;

    const map = new Map();
    for (const sched of data ?? []) {
        const classId = sched.class?.class_id;
        if (!classId) continue;
        if (!map.has(classId)) {
            map.set(classId, { class_id: classId, name: sched.class?.name ?? '—',
                HADIR: 0, TIDAK_HADIR: 0, IZIN: 0, SAKIT: 0, total: 0 });
        }
        const agg = map.get(classId);
        for (const r of sched.attendance ?? []) {
            const st = r.status === 'EKSKUL' ? 'HADIR' : r.status;
            if (agg[st] !== undefined) agg[st]++;
            agg.total++;
        }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Rekap akumulasi kehadiran kelas (tabel attendance) untuk daftar student_id tertentu.
 * Dipakai Kaprodi untuk siswa AKTIF di programnya.
 */
export async function getClassStudents(classId) {
    const { data, error } = await supabase
        .from('students')
        .select('student_id, nis, full_name')
        .eq('class_id', classId)
        .eq('is_active', true)
        .order('full_name');
    if (error) throw error;
    return data ?? [];
}

export async function getAttendanceSummaryByStudents(students, dateStart, dateEnd) {
    if (!students?.length) return [];
    const ids = students.map(s => s.student_id);
    let q = supabase
        .from('teaching_schedules')
        .select('session_date, attendance!inner ( student_id, status, is_void )')
        .in('attendance.student_id', ids)
        .eq('attendance.is_void', false);
    if (dateStart) q = q.gte('session_date', dateStart);
    if (dateEnd)   q = q.lte('session_date', dateEnd);
    const { data, error } = await q;
    if (error) throw error;

    const map = new Map(students.map(s => [s.student_id, { ...s, HADIR: 0, TIDAK_HADIR: 0, IZIN: 0, SAKIT: 0, total: 0 }]));
    for (const sched of data ?? []) {
        for (const r of sched.attendance ?? []) {
            const agg = map.get(r.student_id);
            if (!agg) continue;
            const st = r.status === 'EKSKUL' ? 'HADIR' : r.status;
            if (agg[st] !== undefined) agg[st]++;
            agg.total++;
        }
    }
    return [...map.values()];
}

export async function getOpenCases() {
    const { data, error } = await supabase
        .from('cases')
        .select('case_id, title, status, track, current_handler_role, created_at, student:students(full_name, nis)')
        .neq('status', 'CLOSED')
        .order('created_at', { ascending: false })
        .limit(100);
    if (error) throw error;
    return data ?? [];
}

// ─── JURNAL MENGAJAR ─────────────────────────────────────────

export async function getJournalEntries(userId) {
    const { data, error } = await supabase
        .from('teacher_journals')
        .select('journal_id, entry_date, content, created_at')
        .eq('owner_user_id', userId)
        .order('entry_date', { ascending: false })
        .order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
}

/**
 * Simpan entri jurnal baru. Offline-capable: antre ke IndexedDB bila jaringan mati.
 * @returns {{status:'synced'|'queued'|'error', error?:string}}
 */
export async function insertJournalEntry(userId, entryDate, content) {
    const payload = {
        idempotency_key: crypto.randomUUID(),
        journal_id:      crypto.randomUUID(),
        owner_user_id:   userId,
        entry_date:      entryDate,
        content,
    };
    return saveJournalEntry(payload);
}

export async function deleteJournalEntry(journalId) {
    const { error } = await supabase
        .from('teacher_journals')
        .delete()
        .eq('journal_id', journalId);
    if (error) throw error;
}

// ─── KASUS ───────────────────────────────────────────────────

// Diganti oleh getUnreadNotifCount — tetap diekspor untuk kompatibilitas sementara
export async function countNewCaseEvents(roleType, since) {
    const { count, error } = await supabase
        .from('case_events')
        .select('case_id', { count: 'exact', head: true })
        .eq('new_handler_role', roleType)
        .gt('created_at', since);
    if (error) throw error;
    return count ?? 0;
}

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

export async function getCases() {
    const { data, error } = await supabase
        .from('cases')
        .select(`
            case_id, title, status, track, current_handler_role, is_locked,
            created_at, created_by_user_id,
            student:students(student_id, full_name, nis),
            created_by:users!cases_created_by_user_id_fkey(full_name)
        `)
        .order('created_at', { ascending: false })
        .limit(200);
    if (error) throw error;
    return data ?? [];
}

export async function getCase(caseId) {
    const { data, error } = await supabase
        .from('cases')
        .select(`
            case_id, title, description, status, track, current_handler_role, is_locked,
            created_at, initiated_by_role,
            student:students(student_id, full_name, nis),
            created_by:users!cases_created_by_user_id_fkey(full_name)
        `)
        .eq('case_id', caseId)
        .single();
    if (error) throw error;
    return data;
}

export async function getCaseEvents(caseId) {
    const { data, error } = await supabase
        .from('case_events')
        .select(`
            event_id, event_type, privacy_level,
            previous_handler_role, new_handler_role,
            previous_status, new_status, payload, created_at,
            author:users!case_events_author_user_id_fkey(full_name),
            author_role_at_time
        `)
        .eq('case_id', caseId)
        .order('created_at', { ascending: true });
    if (error) throw error;
    return data ?? [];
}

export async function createCase({ studentId, title, description, track, audience = 'PRIVATE', authorUserId, authorRole }) {
    const payload = {
        idempotency_key:    crypto.randomUUID(),
        case_id:            crypto.randomUUID(),
        student_id:         studentId,
        created_by_user_id: authorUserId,
        initiated_by_role:  authorRole,
        track,
        title,
        description,
        audience,
    };
    const r = await saveCase(payload);
    if (r.status === 'error') throw new Error(r.error);
    return { case_id: payload.case_id, _queued: r.status === 'queued' };
}

export async function updateCaseAudience({ caseId, audience }) {
    const { error } = await supabase
        .from('cases')
        .update({ audience })
        .eq('case_id', caseId);
    if (error) throw error;
}

export async function getCaseAudienceMembers(caseId) {
    const { data, error } = await supabase
        .from('case_audience_members')
        .select('user_id, users:user_id(full_name, role_type)')
        .eq('case_id', caseId);
    if (error) throw error;
    return data ?? [];
}

export async function addCaseAudienceMember({ caseId, userId, schoolId }) {
    const { error } = await supabase
        .from('case_audience_members')
        .insert({ case_id: caseId, user_id: userId, school_id: schoolId });
    if (error) throw error;
}

export async function removeCaseAudienceMember({ caseId, userId }) {
    const { error } = await supabase
        .from('case_audience_members')
        .delete()
        .eq('case_id', caseId)
        .eq('user_id', userId);
    if (error) throw error;
}

export async function searchInternalUsers(query) {
    const INTERNAL_ROLES = ['GURU','BK','WALI_KELAS','KAPRODI','WAKA_KESISWAAN','KEPSEK'];
    const { data, error } = await supabase
        .from('users')
        .select('user_id, full_name, role_type')
        .in('role_type', INTERNAL_ROLES)
        .ilike('full_name', `%${query}%`)
        .eq('is_active', true)
        .limit(10);
    if (error) throw error;
    return data ?? [];
}

export async function addCaseComment({ caseId, text, authorUserId, authorRole, privacyLevel = 'INTERNAL_SCHOOL' }) {
    const { error } = await supabase
        .from('case_events')
        .insert({
            case_id:            caseId,
            event_type:         'COMMENT_ADDED',
            author_user_id:     authorUserId,
            author_role_at_time: authorRole,
            privacy_level:      privacyLevel,
            payload:            { text },
        });
    if (error) throw error;
}

export async function escalateCase({ caseId, previousHandlerRole, newHandlerRole, note, authorUserId, authorRole, previousStatus, newStatus = 'UNDER_REVIEW' }) {
    // Bila pemanggil tidak kirim previousStatus, baca dari server agar tidak hardcode
    let prevSt = previousStatus;
    if (!prevSt) {
        const { data, error: fetchErr } = await supabase
            .from('cases')
            .select('status')
            .eq('case_id', caseId)
            .single();
        if (fetchErr) throw fetchErr;
        prevSt = data.status;
    }

    const { error } = await supabase
        .from('case_events')
        .insert({
            case_id:              caseId,
            event_type:           'DECISION_ESCALATE',
            author_user_id:       authorUserId,
            author_role_at_time:  authorRole,
            previous_handler_role: previousHandlerRole,
            new_handler_role:     newHandlerRole,
            previous_status:      prevSt,
            new_status:           newStatus,
            payload:              note ? { text: note } : {},
        });
    if (error) throw error;
}

export async function changeCaseStatus({ caseId, previousStatus, newStatus, note, authorUserId, authorRole }) {
    const { error } = await supabase
        .from('case_events')
        .insert({
            case_id:             caseId,
            event_type:          'STATUS_CHANGED',
            author_user_id:      authorUserId,
            author_role_at_time: authorRole,
            previous_status:     previousStatus,
            new_status:          newStatus,
            payload:             note ? { text: note } : {},
        });
    if (error) throw error;
}

export async function closeCase({ caseId, note, authorUserId, authorRole }) {
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

// ─── KELOLA ADMIN (kepsek only) ───────────────────────────────

export async function listSchoolAdmins() {
    const { data, error } = await supabase
        .from('users')
        .select('user_id, full_name, login_identifier')
        .eq('role_type', 'ADMINISTRATIVE')
        .order('full_name');
    if (error) throw error;
    return data ?? [];
}

async function _callManageAdmin(method, body) {
    const { data: session } = await supabase.auth.getSession();
    const token = session?.session?.access_token;
    if (!token) throw new Error('Sesi login tidak ditemukan. Silakan login ulang.');

    const res = await fetch(`${SUPABASE_URL}/functions/v1/manage-admin-account`, {
        method,
        headers: {
            'Content-Type':  'application/json',
            'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message ?? 'Permintaan gagal');
    return json.data;
}

export async function addSchoolAdmin({ full_name, login_identifier }) {
    return _callManageAdmin('POST', { full_name, login_identifier });
}

export async function removeSchoolAdmin(user_id) {
    return _callManageAdmin('DELETE', { user_id });
}
