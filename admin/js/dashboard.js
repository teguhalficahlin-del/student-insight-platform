/**
 * @file admin/js/dashboard.js
 *
 * Dashboard read-only — menampilkan data yang sudah diinput di wizard.
 * Tidak ada edit, insert, delete. Untuk mengubah data, kembali ke wizard.
 */

import { getCurrentUserRow, requireAdministrativeOrRedirect, getSchoolConfig, logout, getPrograms, getClasses, fetchAllRows } from './api.js';
import { supabase } from './api.js';

const panelContent = document.getElementById('panel-content');

const PANEL_RENDERERS = {
    setup:              renderSetupPanel,
    programs:           renderProgramsPanel,
    classes:            renderClassesPanel,
    staff:              renderStaffPanel,
    students:           renderStudentsPanel,
    parents:            renderParentsPanel,
    dudi:               renderDudiPanel,
    stakeholders:       renderStakeholdersPanel,
    'schedules-active': renderSchedulesPanel,
    'schedule-builder': renderScheduleBuilderPanel,
    substitutes:        renderSubstitutesPanel,
    tutupsemester:      renderComingSoon,
    'academic-year':    renderComingSoon,
    export:             renderComingSoon,
    'activity-log':     renderComingSoon,
};

document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
        document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('is-active'));
        link.classList.add('is-active');
        const panel = link.dataset.panel;
        (PANEL_RENDERERS[panel] ?? renderComingSoon)(panel);
    });
});

document.getElementById('logout-btn').addEventListener('click', async () => {
    await logout();
    window.location.href = 'index.html';
});

function renderComingSoon(panel) {
    panelContent.innerHTML = `<p class="hint">Panel "${panel}" belum diimplementasikan.</p>`;
}

// ─────────────────────────────────────────────────────────────
// SETUP OVERVIEW
// ─────────────────────────────────────────────────────────────

async function renderSetupPanel() {
    const [
        { count: programCount },
        { count: classCount },
        { count: stafCount },
        { count: siswaCount },
        { count: ortuCount },
        { count: dudiCount },
        { count: stakeholderCount },
        { count: jadwalCount },
    ] = await Promise.all([
        supabase.from('programs').select('*', { count: 'exact', head: true }),
        supabase.from('classes').select('*', { count: 'exact', head: true }),
        supabase.from('users').select('*', { count: 'exact', head: true }).not('role_type', 'in', '("SISWA","ORTU","DUDI","ADMINISTRATIVE","STAKEHOLDER")'),
        supabase.from('students').select('*', { count: 'exact', head: true }),
        supabase.from('users').select('*', { count: 'exact', head: true }).eq('role_type', 'ORTU'),
        supabase.from('users').select('*', { count: 'exact', head: true }).eq('role_type', 'DUDI'),
        supabase.from('users').select('*', { count: 'exact', head: true }).eq('role_type', 'STAKEHOLDER'),
        supabase.from('schedule_templates').select('*', { count: 'exact', head: true }),
    ]);

    const items = [
        { label: 'Program Keahlian', count: programCount, panel: 'programs' },
        { label: 'Kelas & Rombel', count: classCount, panel: 'classes' },
        { label: 'Staf & Peran', count: stafCount, panel: 'staff' },
        { label: 'Siswa', count: siswaCount, panel: 'students' },
        { label: 'Orang Tua', count: ortuCount, panel: 'parents' },
        { label: 'DUDI', count: dudiCount, panel: 'dudi' },
        { label: 'Stakeholder', count: stakeholderCount, panel: 'stakeholders' },
        { label: 'Jadwal', count: jadwalCount, panel: 'schedules-active' },
    ];

    panelContent.innerHTML = `
        <h3>Ringkasan Data Sekolah</h3>
        <p class="hint">Untuk mengubah data, kembali ke <a href="wizard.html">Setup Wizard</a>.</p>
        <table class="table">
            <thead><tr><th>Data</th><th>Jumlah</th></tr></thead>
            <tbody>${items.map(i => `
                <tr style="cursor:pointer" class="setup-row" data-panel="${i.panel}">
                    <td>${i.label}</td>
                    <td><span class="badge ${i.count > 0 ? 'badge-success' : 'badge-muted'}">${i.count ?? 0}</span></td>
                </tr>
            `).join('')}</tbody>
        </table>
    `;

    panelContent.querySelectorAll('.setup-row').forEach(row => {
        row.addEventListener('click', () => {
            const navLink = document.querySelector(`.nav-link[data-panel="${row.dataset.panel}"]`);
            if (navLink) navLink.click();
        });
    });
}

// ─────────────────────────────────────────────────────────────
// READ-ONLY PANELS
// ─────────────────────────────────────────────────────────────

async function renderProgramsPanel() {
    const programs = await getPrograms();
    panelContent.innerHTML = `
        <h3>Program Keahlian (${programs.length})</h3>
        <table class="table">
            <thead><tr><th>Kode</th><th>Nama</th></tr></thead>
            <tbody>${programs.map(p => `<tr><td>${p.code}</td><td>${p.name}</td></tr>`).join('')}</tbody>
        </table>
    `;
}

async function renderClassesPanel() {
    const [classes, programs] = await Promise.all([getClasses(), getPrograms()]);
    const pm = new Map(programs.map(p => [p.program_id, p.code]));
    panelContent.innerHTML = `
        <h3>Kelas & Rombel (${classes.length})</h3>
        <table class="table">
            <thead><tr><th>Nama Kelas</th><th>Program</th><th>Tingkat</th></tr></thead>
            <tbody>${classes.map(c => `<tr><td>${c.name}</td><td>${pm.get(c.program_id) ?? '—'}</td><td>${c.grade_level}</td></tr>`).join('')}</tbody>
        </table>
    `;
}

function buildJabatan(u) {
    const j = [];
    if (u.role_type === 'GURU') j.push('Guru');
    if (u.wali_kelas_class_id) j.push('Wali Kelas');
    if (u.is_bk) j.push('BK');
    if (u.kaprodi_program_id) j.push('Kaprodi');
    if (u.is_kepsek) j.push('Kepsek');
    if (u.is_waka_kurikulum) j.push('Waka Kurikulum');
    if (u.is_waka_kesiswaan) j.push('Waka Kesiswaan');
    if (u.role_type === 'KEPSEK' && !j.length) j.push('Kepsek');
    if (u.role_type === 'BK' && !j.includes('BK')) j.push('BK');
    if (u.role_type === 'WAKA_KURIKULUM' && !j.includes('Waka Kurikulum')) j.push('Waka Kurikulum');
    if (u.role_type === 'WAKA_KESISWAAN' && !j.includes('Waka Kesiswaan')) j.push('Waka Kesiswaan');
    return j.join(', ') || u.role_type;
}

async function renderStaffPanel() {
    const { data: users } = await supabase
        .from('users')
        .select('full_name, login_identifier, teacher_code, role_type, is_bk, is_kepsek, is_waka_kurikulum, is_waka_kesiswaan, wali_kelas_class_id, kaprodi_program_id')
        .not('role_type', 'in', '("SISWA","ORTU","DUDI","ADMINISTRATIVE","STAKEHOLDER")')
        .order('full_name');
    panelContent.innerHTML = `
        <h3>Staf & Peran (${(users ?? []).length})</h3>
        <table class="table">
            <thead><tr><th>Nama</th><th>NIP/NIK</th><th>Kode</th><th>Jabatan</th></tr></thead>
            <tbody>${(users ?? []).map(u => `<tr><td>${u.full_name}</td><td>${u.login_identifier}</td><td>${u.teacher_code ?? '—'}</td><td>${buildJabatan(u)}</td></tr>`).join('')}</tbody>
        </table>
    `;
}

async function renderStudentsPanel() {
    const data = await fetchAllRows('students', q => q.select('full_name, nis, student_status').order('full_name'));
    panelContent.innerHTML = `
        <h3>Siswa (${data.length})</h3>
        <table class="table">
            <thead><tr><th>Nama</th><th>NIS</th><th>Status</th></tr></thead>
            <tbody>${data.map(s => `<tr><td>${s.full_name}</td><td>${s.nis}</td><td>${s.student_status}</td></tr>`).join('')}</tbody>
        </table>
    `;
}

async function renderParentsPanel() {
    const data = await fetchAllRows('users', q => q.select('full_name, login_identifier').eq('role_type', 'ORTU').order('full_name'));
    panelContent.innerHTML = `
        <h3>Orang Tua (${data.length})</h3>
        <table class="table">
            <thead><tr><th>Nama</th><th>NIK</th></tr></thead>
            <tbody>${data.map(u => `<tr><td>${u.full_name}</td><td>${u.login_identifier}</td></tr>`).join('')}</tbody>
        </table>
    `;
}

async function renderDudiPanel() {
    const { data: users } = await supabase.from('users').select('full_name, dudi_org_name').eq('role_type', 'DUDI').order('dudi_org_name');
    panelContent.innerHTML = `
        <h3>DUDI (${(users ?? []).length})</h3>
        <table class="table">
            <thead><tr><th>Nama Usaha</th><th>Penanggung Jawab</th></tr></thead>
            <tbody>${(users ?? []).map(u => `<tr><td>${u.dudi_org_name ?? '—'}</td><td>${u.full_name}</td></tr>`).join('')}</tbody>
        </table>
    `;
}

async function renderStakeholdersPanel() {
    const { data: users } = await supabase.from('users').select('full_name, login_identifier').eq('role_type', 'STAKEHOLDER').order('full_name');
    panelContent.innerHTML = `
        <h3>Stakeholder (${(users ?? []).length})</h3>
        <table class="table">
            <thead><tr><th>Nama</th><th>Kode Login</th></tr></thead>
            <tbody>${(users ?? []).map(u => `<tr><td>${u.full_name}</td><td>${u.login_identifier}</td></tr>`).join('')}</tbody>
        </table>
    `;
}

async function renderSchedulesPanel() {
    const { data: schedules } = await supabase
        .from('teaching_schedules')
        .select('session_date, session_start, session_end, meeting_status')
        .order('session_date', { ascending: false })
        .limit(50);
    panelContent.innerHTML = `
        <h3>Jadwal Aktif (50 terbaru)</h3>
        <table class="table">
            <thead><tr><th>Tanggal</th><th>Jam</th><th>Status</th></tr></thead>
            <tbody>${(schedules ?? []).map(s => `<tr><td>${s.session_date}</td><td>${s.session_start}–${s.session_end}</td><td>${s.meeting_status}</td></tr>`).join('')}</tbody>
        </table>
    `;
}

async function renderScheduleBuilderPanel() {
    panelContent.innerHTML = `
        <h3>Susun Jadwal</h3>
        <p class="hint">Kembali ke <a href="wizard.html">Setup Wizard</a> langkah 10 untuk menyusun jadwal visual.</p>
    `;
}

async function renderSubstitutesPanel() {
    const { data: subs } = await supabase
        .from('substitute_schedules')
        .select('granted_at, sync_token_expires_at')
        .order('granted_at', { ascending: false })
        .limit(50);
    panelContent.innerHTML = `
        <h3>Guru Pengganti (${(subs ?? []).length})</h3>
        <table class="table">
            <thead><tr><th>Diberikan Pada</th><th>Berlaku Sampai</th></tr></thead>
            <tbody>${(subs ?? []).map(s => `<tr><td>${s.granted_at}</td><td>${s.sync_token_expires_at}</td></tr>`).join('')}</tbody>
        </table>
    `;
}

// ─────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────

(async () => {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData?.user) { window.location.href = 'index.html'; return; }

    const userRow = await getCurrentUserRow();
    if (!requireAdministrativeOrRedirect(userRow)) return;

    const config = await getSchoolConfig();
    document.getElementById('dashboard-school-name').textContent = config?.school_name ?? 'Sekolah';
    document.getElementById('dashboard-user-name').textContent = `Masuk sebagai ${userRow.full_name}`;

    renderSetupPanel();
})();
