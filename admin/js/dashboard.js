/**
 * @file admin/js/dashboard.js
 *
 * Dashboard read-only — menampilkan data yang sudah diinput di wizard.
 * Tidak ada edit, insert, delete. Untuk mengubah data, kembali ke wizard.
 */

import { getCurrentUserRow, requireAdministrativeOrRedirect, getSchoolConfig, logout, getPrograms, getClasses, fetchAllRows } from './api.js';
import { supabase } from './api.js';
import { mountSemesterPanel } from './semester.js';

const panelContent = document.getElementById('panel-content');

const PANEL_RENDERERS = {
    setup:              renderSetupPanel,
    programs:           renderProgramsPanel,
    classes:            renderClassesPanel,
    staff:              renderStaffPanel,
    students:           renderStudentsPanel,
    alumni:             renderAlumniPanel,
    parents:            renderParentsPanel,
    dudi:               renderDudiPanel,
    stakeholders:       renderStakeholdersPanel,
    jadwal:             renderJadwalPanel,
    tutupsemester:      () => mountSemesterPanel(panelContent),
    'academic-year':    () => { window.location.href = 'tutup-tahun.html'; },
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

// Hamburger menu toggle (mobile)
const sidebar = document.querySelector('.sidebar');
const menuToggle = document.getElementById('menu-toggle');
menuToggle?.addEventListener('click', () => {
    sidebar.classList.add('open');
    const backdrop = document.createElement('div');
    backdrop.className = 'sidebar-backdrop';
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', () => {
        sidebar.classList.remove('open');
        backdrop.remove();
    });
});

// Close sidebar when nav link clicked (mobile)
document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
        sidebar.classList.remove('open');
        document.querySelector('.sidebar-backdrop')?.remove();
    });
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
        supabase.from('students').select('*', { count: 'exact', head: true }).eq('student_status', 'AKTIF'),
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
        { label: 'Jadwal', count: jadwalCount, panel: 'jadwal' },
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

// Render daftar yang dikelompokkan per grup (mis. program keahlian) sebagai
// accordion <details>. Pola sama dengan pengelompokan alumni per tahun di
// panel Siswa/Orang Tua. Grup yang diawali "Tanpa" selalu ditaruh paling bawah.
function renderGroupedTable(items, groupOf, headers, rowOf) {
    const groups = new Map();
    for (const it of items) {
        const g = groupOf(it);
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(it);
    }
    const keys = [...groups.keys()].sort((a, b) => {
        const na = /^Tanpa/i.test(a), nb = /^Tanpa/i.test(b);
        if (na !== nb) return na ? 1 : -1;
        return a.localeCompare(b, 'id');
    });
    if (keys.length === 0) return '<p class="hint">Belum ada data.</p>';
    const head = headers.map(h => `<th>${h}</th>`).join('');
    return keys.map(g => {
        const list = groups.get(g);
        return `
            <details style="margin-bottom:8px">
                <summary style="cursor:pointer;font-weight:600">${g} (${list.length})</summary>
                <table class="table" style="margin-top:4px">
                    <thead><tr>${head}</tr></thead>
                    <tbody>${list.map(rowOf).join('')}</tbody>
                </table>
            </details>`;
    }).join('');
}

// Render daftar alumni sebagai accordion per tahun kelulusan (terbaru di atas).
function renderYearGrouped(items, yearOf, headers, rowOf) {
    const byYear = new Map();
    for (const it of items) {
        const y = yearOf(it);
        if (!byYear.has(y)) byYear.set(y, []);
        byYear.get(y).push(it);
    }
    const years = [...byYear.keys()].sort().reverse();
    if (years.length === 0) return '<p class="hint">Belum ada data.</p>';
    const head = headers.map(h => `<th>${h}</th>`).join('');
    return years.map(year => {
        const list = byYear.get(year);
        return `
            <details style="margin-bottom:8px">
                <summary style="cursor:pointer;font-weight:600">Lulusan ${year} (${list.length})</summary>
                <table class="table" style="margin-top:4px">
                    <thead><tr>${head}</tr></thead>
                    <tbody>${list.map(rowOf).join('')}</tbody>
                </table>
            </details>`;
    }).join('');
}

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
    const pn = new Map(programs.map(p => [p.program_id, p.name]));
    const grouped = renderGroupedTable(
        classes,
        c => pn.get(c.program_id) ?? 'Tanpa Program',
        ['Nama Kelas', 'Tingkat'],
        c => `<tr><td>${c.name}</td><td>${c.grade_level}</td></tr>`,
    );
    panelContent.innerHTML = `
        <h3>Kelas & Rombel (${classes.length})</h3>
        ${grouped}
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
    const aktif = await fetchAllRows('students',
        q => q.select('full_name, nis, student_status, program:programs ( name )')
              .eq('student_status', 'AKTIF')
              .order('full_name'));

    const aktifHtml = renderGroupedTable(
        aktif,
        s => s.program?.name ?? 'Tanpa Program',
        ['Nama', 'NIS'],
        s => `<tr><td>${s.full_name}</td><td>${s.nis}</td></tr>`,
    );

    panelContent.innerHTML = `
        <h3>Siswa Aktif (${aktif.length})</h3>
        <p class="hint" style="margin-bottom:12px">Alumni ada di menu <strong>Alumni</strong>.</p>
        ${aktifHtml}
    `;
}

async function renderParentsPanel() {
    const parents = await fetchAllRows('users', q => q.select('user_id, full_name, login_identifier').eq('role_type', 'ORTU').order('full_name'));
    const links = await fetchAllRows('student_parents',
        q => q.select('parent_user_id, students ( student_status, program:programs ( name ) )'));

    const childMap = new Map();
    for (const l of links) {
        if (!childMap.has(l.parent_user_id)) childMap.set(l.parent_user_id, []);
        if (l.students) childMap.get(l.parent_user_id).push(l.students);
    }

    const aktif = [];
    const parentProgram = new Map();   // user_id -> nama program anak aktif
    for (const p of parents) {
        const children = childMap.get(p.user_id) ?? [];
        const hasAktif = children.some(c => c.student_status === 'AKTIF');
        if (hasAktif || children.length === 0) {
            aktif.push(p);
            const refChild = children.find(c => c.student_status === 'AKTIF') ?? children[0];
            parentProgram.set(p.user_id, refChild?.program?.name ?? 'Tanpa Program');
        }
    }

    const aktifHtml = renderGroupedTable(
        aktif,
        u => parentProgram.get(u.user_id) ?? 'Tanpa Program',
        ['Nama', 'NIK'],
        u => `<tr><td>${u.full_name}</td><td>${u.login_identifier}</td></tr>`,
    );

    panelContent.innerHTML = `
        <h3>Orang Tua Siswa Aktif (${aktif.length})</h3>
        <p class="hint" style="margin-bottom:12px">Orang tua alumni ada di menu <strong>Alumni</strong>.</p>
        ${aktifHtml}
    `;
}

// Menu khusus Alumni: siswa lulus + orang tua yang semua anaknya sudah lulus,
// keduanya dikelompokkan per tahun kelulusan.
async function renderAlumniPanel() {
    const siswaAlumni = await fetchAllRows('students',
        q => q.select('full_name, nis, graduated_academic_year')
              .eq('student_status', 'LULUS')
              .order('full_name'));

    const parents = await fetchAllRows('users',
        q => q.select('user_id, full_name, login_identifier').eq('role_type', 'ORTU').order('full_name'));
    const links = await fetchAllRows('student_parents',
        q => q.select('parent_user_id, students ( student_status, graduated_academic_year )'));

    const childMap = new Map();
    for (const l of links) {
        if (!childMap.has(l.parent_user_id)) childMap.set(l.parent_user_id, []);
        if (l.students) childMap.get(l.parent_user_id).push(l.students);
    }

    const ortuAlumni = [];
    for (const p of parents) {
        const children = childMap.get(p.user_id) ?? [];
        if (children.length === 0) continue;                       // tanpa anak → bukan alumni
        if (children.some(c => c.student_status === 'AKTIF')) continue; // masih punya anak aktif
        const year = children.map(c => c.graduated_academic_year).filter(Boolean).sort().reverse()[0] ?? 'Tidak diketahui';
        ortuAlumni.push({ ...p, _year: year });
    }

    const siswaHtml = renderYearGrouped(
        siswaAlumni,
        s => s.graduated_academic_year ?? 'Tidak diketahui',
        ['Nama', 'NIS'],
        s => `<tr><td>${s.full_name}</td><td>${s.nis}</td></tr>`,
    );
    const ortuHtml = renderYearGrouped(
        ortuAlumni,
        u => u._year,
        ['Nama', 'NIK'],
        u => `<tr><td>${u.full_name}</td><td>${u.login_identifier}</td></tr>`,
    );

    panelContent.innerHTML = `
        <h3>Siswa Alumni (${siswaAlumni.length})</h3>
        <p class="hint" style="margin-bottom:12px">Siswa yang sudah lulus, dikelompokkan per tahun kelulusan.</p>
        ${siswaHtml}
        <hr style="margin:24px 0;border:none;border-top:1px solid var(--color-border)" />
        <h3>Orang Tua Alumni (${ortuAlumni.length})</h3>
        <p class="hint" style="margin-bottom:12px">Orang tua yang semua anaknya sudah lulus, dikelompokkan per tahun kelulusan terakhir.</p>
        ${ortuHtml}
    `;
}

async function renderDudiPanel() {
    const [{ data: users }, programs] = await Promise.all([
        supabase.from('users').select('full_name, dudi_org_name, program_id').eq('role_type', 'DUDI').order('dudi_org_name'),
        getPrograms(),
    ]);
    const pn = new Map(programs.map(p => [p.program_id, p.name]));
    const grouped = renderGroupedTable(
        users ?? [],
        u => u.program_id ? (pn.get(u.program_id) ?? '—') : 'Tanpa Program / Lintas Program',
        ['Nama Usaha', 'Penanggung Jawab'],
        u => `<tr><td>${u.dudi_org_name ?? '—'}</td><td>${u.full_name}</td></tr>`,
    );
    panelContent.innerHTML = `
        <h3>DUDI (${(users ?? []).length})</h3>
        ${grouped}
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

async function renderJadwalPanel() {
    const { count } = await supabase.from('schedule_templates').select('*', { count: 'exact', head: true });
    panelContent.innerHTML = `
        <h3>Jadwal</h3>
        <p class="hint">Jadwal yang sudah disusun: <strong>${count ?? 0} slot</strong>.</p>
        <p class="hint">Untuk menyusun atau mengubah jadwal, buka <a href="wizard.html">Setup Wizard</a> langkah 10.</p>
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
