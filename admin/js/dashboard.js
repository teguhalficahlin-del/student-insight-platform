/**
 * @file admin/js/dashboard.js
 *
 * Dashboard read-only — menampilkan data yang sudah diinput di wizard.
 * Tidak ada edit, insert, delete. Untuk mengubah data, kembali ke wizard.
 */

import { applyBrandingById } from '../../shared/branding.js';
import { getCurrentUserRow, requireAdministrativeOrRedirect, getSchoolConfig, logout, getPrograms, getClasses, fetchAllRows, countStudentsWithoutAccount, provisionStudentAccounts } from './api.js';
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
    export:             renderExportPanel,
    'activity-log':     renderActivityLogPanel,
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

// Nama kelas terakhir alumni: enrolment di tahun kelulusannya, atau enrolment
// terbaru bila tidak ketemu.
function alumniClassName(enrollment, gradYear) {
    const enrolls = Array.isArray(enrollment) ? enrollment : (enrollment ? [enrollment] : []);
    if (enrolls.length === 0) return 'Tanpa Kelas';
    const match = enrolls.find(e => e.academic_year === gradYear);
    const pick = match ?? [...enrolls].sort((a, b) => (a.academic_year ?? '').localeCompare(b.academic_year ?? '')).pop();
    return pick?.class?.name ?? 'Tanpa Kelas';
}

// Render alumni sebagai accordion bersarang 3 level: Tahun Lulus (terbaru di
// atas) → Program Keahlian → Kelas → tabel. rows: { year, program, kelas, item }.
function renderNestedYearProgramClass(rows, headers, rowOf) {
    const byYear = new Map();
    for (const r of rows) {
        if (!byYear.has(r.year)) byYear.set(r.year, new Map());
        const byProg = byYear.get(r.year);
        if (!byProg.has(r.program)) byProg.set(r.program, new Map());
        const byClass = byProg.get(r.program);
        if (!byClass.has(r.kelas)) byClass.set(r.kelas, []);
        byClass.get(r.kelas).push(r.item);
    }
    if (byYear.size === 0) return '<p class="hint">Belum ada data.</p>';

    const head = headers.map(h => `<th>${h}</th>`).join('');
    const progSort = (a, b) => {
        const na = /^Tanpa/i.test(a), nb = /^Tanpa/i.test(b);
        if (na !== nb) return na ? 1 : -1;
        return a.localeCompare(b, 'id');
    };
    const totalOf = (byClass) => { let t = 0; byClass.forEach(arr => t += arr.length); return t; };

    const years = [...byYear.keys()].sort().reverse();
    return years.map(year => {
        const byProg = byYear.get(year);
        let yearTotal = 0; byProg.forEach(bc => yearTotal += totalOf(bc));

        const progHtml = [...byProg.keys()].sort(progSort).map(prog => {
            const byClass = byProg.get(prog);
            const classHtml = [...byClass.keys()].sort((a, b) => a.localeCompare(b, 'id')).map(kls => {
                const list = byClass.get(kls);
                return `
                    <details style="margin:4px 0 4px 32px">
                        <summary style="cursor:pointer;font-weight:600">${kls} (${list.length})</summary>
                        <table class="table" style="margin-top:4px">
                            <thead><tr>${head}</tr></thead>
                            <tbody>${list.map(rowOf).join('')}</tbody>
                        </table>
                    </details>`;
            }).join('');
            return `
                <details style="margin:4px 0 4px 16px">
                    <summary style="cursor:pointer;font-weight:600">${prog} (${totalOf(byClass)})</summary>
                    <div style="padding:2px 0">${classHtml}</div>
                </details>`;
        }).join('');

        return `
            <details style="margin-bottom:8px">
                <summary style="cursor:pointer;font-weight:600">Lulusan ${year} (${yearTotal})</summary>
                <div style="padding:2px 0">${progHtml}</div>
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
    const users = await fetchAllRows('users',
        q => q.select('full_name, login_identifier, teacher_code, role_type, is_bk, is_kepsek, is_waka_kurikulum, is_waka_kesiswaan, wali_kelas_class_id, kaprodi_program_id')
              .not('role_type', 'in', '("SISWA","ORTU","DUDI","ADMINISTRATIVE","STAKEHOLDER")')
              .order('full_name'));
    panelContent.innerHTML = `
        <h3>Staf & Peran (${users.length})</h3>
        <table class="table">
            <thead><tr><th>Nama</th><th>NIP/NIK</th><th>Kode</th><th>Jabatan</th></tr></thead>
            <tbody>${users.map(u => `<tr><td>${u.full_name}</td><td>${u.login_identifier}</td><td>${u.teacher_code ?? '—'}</td><td>${buildJabatan(u)}</td></tr>`).join('')}</tbody>
        </table>
    `;
}

async function renderStudentsPanel() {
    const [aktif, noAccount] = await Promise.all([
        fetchAllRows('students',
            q => q.select('full_name, nis, student_status, program:programs ( name )')
                  .eq('student_status', 'AKTIF')
                  .order('full_name')),
        countStudentsWithoutAccount().catch(() => 0),
    ]);

    const aktifHtml = renderGroupedTable(
        aktif,
        s => s.program?.name ?? 'Tanpa Program',
        ['Nama', 'NIS'],
        s => `<tr><td>${s.full_name}</td><td>${s.nis}</td></tr>`,
    );

    const provisionHtml = `
        <div class="card" style="border:1px solid var(--color-border, #dde3e9); border-radius:12px; padding:16px; margin-bottom:16px">
            <strong>Akun Login Siswa</strong>
            <p class="hint" style="margin:6px 0">
                ${noAccount > 0
                    ? `<strong>${noAccount}</strong> siswa belum punya akun login. Siswa masuk ke Portal Siswa pakai <strong>NIS</strong>, password awal <code>{NIS}!SMK</code>.`
                    : '✓ Semua siswa sudah punya akun login.'}
            </p>
            ${noAccount > 0
                ? `<button class="btn btn-primary btn-sm" id="provision-students-btn">Buatkan Akun Siswa</button>`
                : ''}
            <div id="provision-status" class="hint" style="margin-top:8px"></div>
        </div>`;

    panelContent.innerHTML = `
        ${provisionHtml}
        <h3>Siswa Aktif (${aktif.length})</h3>
        <p class="hint" style="margin-bottom:12px">Alumni ada di menu <strong>Alumni</strong>.</p>
        ${aktifHtml}
    `;

    document.getElementById('provision-students-btn')?.addEventListener('click', runProvisionStudents);
}

async function runProvisionStudents() {
    const btn      = document.getElementById('provision-students-btn');
    const statusEl = document.getElementById('provision-status');
    btn.disabled = true;
    btn.textContent = 'Memproses…';

    let created = 0, linked = 0, failed = 0, guard = 0;
    const firstErrors = [];
    try {
        while (guard++ < 200) {
            const r = await provisionStudentAccounts(150);
            created += r.created;
            linked  += r.linked_existing;
            failed  += r.failed;
            for (const e of (r.errors ?? [])) if (firstErrors.length < 5) firstErrors.push(`NIS ${e.nis}: ${e.message}`);
            statusEl.textContent = `Memproses… dibuat ${created}, sisa ${r.remaining}${failed ? `, gagal ${failed}` : ''}`;
            // Berhenti jika sudah habis ATAU batch ini tak memproses apa pun (mencegah loop tak berujung)
            if (r.remaining <= 0 || r.processed === 0) break;
        }
        statusEl.innerHTML = `✓ Selesai — <strong>${created}</strong> akun dibuat`
            + (linked ? `, ${linked} ditautkan` : '')
            + (failed ? `, <span style="color:var(--color-danger,#dc2626)">${failed} gagal</span>` : '')
            + (firstErrors.length ? `<br><span class="hint">${firstErrors.join('<br>')}</span>` : '');
    } catch (err) {
        statusEl.innerHTML = `<span style="color:var(--color-danger,#dc2626)">✗ ${err.message}</span>`;
    } finally {
        btn.disabled = false;
        btn.textContent = 'Buatkan Akun Siswa';
        // Segarkan panel untuk perbarui hitungan setelah jeda singkat
        setTimeout(() => { if (document.getElementById('provision-status')) renderStudentsPanel(); }, 2000);
    }
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

// Menu khusus Alumni: siswa lulus + orang tua yang semua anaknya sudah lulus.
// Keduanya disusun accordion bersarang: Tahun Lulus → Program → Kelas.
async function renderAlumniPanel() {
    // ── Siswa alumni ──
    const siswaRaw = await fetchAllRows('students',
        q => q.select(`full_name, nis, graduated_academic_year,
            program:programs ( name ),
            enrollment:class_enrollments ( academic_year, class:classes ( name ) )
        `).eq('student_status', 'LULUS').order('full_name'));

    const siswaRows = siswaRaw.map(s => ({
        year:    s.graduated_academic_year ?? 'Tidak diketahui',
        program: s.program?.name ?? 'Tanpa Program',
        kelas:   alumniClassName(s.enrollment, s.graduated_academic_year),
        item:    s,
    }));

    // ── Orang tua alumni (semua anak sudah lulus) ──
    const parents = await fetchAllRows('users',
        q => q.select('user_id, full_name, login_identifier').eq('role_type', 'ORTU').order('full_name'));
    const links = await fetchAllRows('student_parents',
        q => q.select(`parent_user_id, students ( student_status, graduated_academic_year,
            program:programs ( name ),
            enrollment:class_enrollments ( academic_year, class:classes ( name ) )
        )`));

    const childMap = new Map();
    for (const l of links) {
        if (!childMap.has(l.parent_user_id)) childMap.set(l.parent_user_id, []);
        if (l.students) childMap.get(l.parent_user_id).push(l.students);
    }

    const ortuRows = [];
    for (const p of parents) {
        const children = childMap.get(p.user_id) ?? [];
        if (children.length === 0) continue;                       // tanpa anak → bukan alumni
        if (children.some(c => c.student_status === 'AKTIF')) continue; // masih punya anak aktif
        // anak alumni acuan = yang tahun lulusnya paling baru
        const ref = [...children].sort((a, b) => (a.graduated_academic_year ?? '').localeCompare(b.graduated_academic_year ?? '')).pop();
        ortuRows.push({
            year:    ref?.graduated_academic_year ?? 'Tidak diketahui',
            program: ref?.program?.name ?? 'Tanpa Program',
            kelas:   alumniClassName(ref?.enrollment, ref?.graduated_academic_year),
            item:    p,
        });
    }

    const siswaHtml = renderNestedYearProgramClass(siswaRows, ['Nama', 'NIS'],
        s => `<tr><td>${s.full_name}</td><td>${s.nis}</td></tr>`);
    const ortuHtml = renderNestedYearProgramClass(ortuRows, ['Nama', 'NIK'],
        u => `<tr><td>${u.full_name}</td><td>${u.login_identifier}</td></tr>`);

    panelContent.innerHTML = `
        <h3>Siswa Alumni (${siswaRows.length})</h3>
        <p class="hint" style="margin-bottom:12px">Dikelompokkan per tahun lulus → program keahlian → kelas.</p>
        ${siswaHtml}
        <hr style="margin:24px 0;border:none;border-top:1px solid var(--color-border)" />
        <h3>Orang Tua Alumni (${ortuRows.length})</h3>
        <p class="hint" style="margin-bottom:12px">Mengikuti tahun lulus, program, dan kelas anak alumninya.</p>
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
    const [{ count: tmplCount }, { count: schedCount }] = await Promise.all([
        supabase.from('schedule_templates').select('*', { count: 'exact', head: true }),
        supabase.from('teaching_schedules').select('*', { count: 'exact', head: true }),
    ]);
    panelContent.innerHTML = `
        <h3>Jadwal</h3>
        <p class="hint">Template slot tersusun: <strong>${tmplCount ?? 0} slot</strong>.</p>
        <p class="hint">Sesi jadwal ter-generate (teaching_schedules): <strong>${(schedCount ?? 0).toLocaleString('id-ID')} sesi</strong>.</p>
        <p class="hint">Untuk menyusun atau mengubah jadwal, buka <a href="wizard.html">Setup Wizard</a> langkah 10.</p>
    `;
}

// ─────────────────────────────────────────────────────────────
// LOG AKTIVITAS
// ─────────────────────────────────────────────────────────────

const EVENT_LABELS = {
    CASE_CREATE:        'Buat Kasus',
    COMMENT_ADDED:      'Tambah Komentar',
    DECISION_ESCALATE:  'Eskalasi',
    STATUS_CHANGED:     'Ubah Status',
    DECISION_CLOSE:     'Tutup Kasus',
};

const DIMENSION_LABELS_ADMIN = {
    AKADEMIK:    'Akademik',
    KEHADIRAN:   'Kehadiran',
    PERILAKU:    'Perilaku',
    SOSIAL:      'Sosial',
    AFEKTIF:     'Sikap',
    BAKAT_MINAT: 'Bakat & Minat',
    FISIK:       'Fisik',
    LAINNYA:     'Lainnya',
};

function fmtTs(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function renderActivityLogPanel() {
    panelContent.innerHTML = '<p class="hint">Memuat log aktivitas…</p>';

    const [evRes, obsRes] = await Promise.allSettled([
        supabase
            .from('case_events')
            .select(`event_type, created_at, author_role_at_time,
                case:cases ( title, student:students ( full_name ) ),
                author:users!case_events_author_user_id_fkey ( full_name )`)
            .order('created_at', { ascending: false })
            .limit(50),
        supabase
            .from('observations')
            .select(`dimension, sentiment, created_at,
                author:users!observations_author_user_id_fkey ( full_name, role_type ),
                student:students ( full_name )`)
            .order('created_at', { ascending: false })
            .limit(50),
    ]);

    const caseEvents = evRes.status  === 'fulfilled' ? (evRes.value.data  ?? []) : [];
    const obsRows    = obsRes.status === 'fulfilled' ? (obsRes.value.data ?? []) : [];

    const caseHtml = caseEvents.length === 0
        ? '<p class="hint">Belum ada aktivitas kasus.</p>'
        : `<table class="table" style="font-size:13px">
            <thead><tr><th>Waktu</th><th>Aktivitas</th><th>Kasus</th><th>Siswa</th><th>Oleh</th></tr></thead>
            <tbody>${caseEvents.map(e => `
                <tr>
                    <td style="white-space:nowrap">${fmtTs(e.created_at)}</td>
                    <td>${EVENT_LABELS[e.event_type] ?? e.event_type}</td>
                    <td>${e.case?.title ?? '—'}</td>
                    <td>${e.case?.student?.full_name ?? '—'}</td>
                    <td>${e.author?.full_name ?? '—'}<br><span class="hint" style="font-size:11px">${e.author_role_at_time ?? ''}</span></td>
                </tr>`).join('')}
            </tbody>
           </table>`;

    const obsHtml = obsRows.length === 0
        ? '<p class="hint">Belum ada observasi.</p>'
        : `<table class="table" style="font-size:13px">
            <thead><tr><th>Waktu</th><th>Dimensi</th><th>Sentimen</th><th>Siswa</th><th>Oleh</th></tr></thead>
            <tbody>${obsRows.map(o => `
                <tr>
                    <td style="white-space:nowrap">${fmtTs(o.created_at)}</td>
                    <td>${DIMENSION_LABELS_ADMIN[o.dimension] ?? o.dimension}</td>
                    <td>${o.sentiment === 'POSITIF' ? '✅ Positif' : '⚠ Perhatian'}</td>
                    <td>${o.student?.full_name ?? '—'}</td>
                    <td>${o.author?.full_name ?? '—'}</td>
                </tr>`).join('')}
            </tbody>
           </table>`;

    panelContent.innerHTML = `
        <h3>Log Aktivitas</h3>
        <p class="hint" style="margin-bottom:20px">50 entri terbaru per kategori, urut terbaru di atas.</p>

        <details open style="margin-bottom:16px">
            <summary style="cursor:pointer; font-weight:600; margin-bottom:8px">
                Aktivitas Kasus (${caseEvents.length})
            </summary>
            <div style="overflow-x:auto">${caseHtml}</div>
        </details>

        <details open>
            <summary style="cursor:pointer; font-weight:600; margin-bottom:8px">
                Observasi Siswa (${obsRows.length})
            </summary>
            <div style="overflow-x:auto">${obsHtml}</div>
        </details>
    `;
}

// ─────────────────────────────────────────────────────────────
// EXPORT DATA
// ─────────────────────────────────────────────────────────────

const EXPORT_DEFS = [
    {
        id: 'staf',
        label: 'Staf & Peran',
        hint: 'NIP/NIK, nama, kode guru, jabatan',
        filename: 'export_staf.xlsx',
        async fetch() {
            return fetchAllRows('users',
                q => q.select('full_name, login_identifier, teacher_code, role_type, is_bk, is_kepsek, is_waka_kurikulum, is_waka_kesiswaan, wali_kelas_class_id, kaprodi_program_id')
                      .not('role_type', 'in', '("SISWA","ORTU","DUDI","ADMINISTRATIVE","STAKEHOLDER")')
                      .order('full_name'));
        },
        headers: ['Nama', 'NIP/NIK', 'Kode Guru', 'Jabatan'],
        rowOf: u => [u.full_name, u.login_identifier, u.teacher_code ?? '', buildJabatan(u)],
    },
    {
        id: 'siswa',
        label: 'Siswa Aktif',
        hint: 'NIS, nama, program keahlian',
        filename: 'export_siswa_aktif.xlsx',
        async fetch() {
            return fetchAllRows('students',
                q => q.select('full_name, nis, program:programs ( name )')
                      .eq('student_status', 'AKTIF')
                      .order('full_name'));
        },
        headers: ['NIS', 'Nama', 'Program Keahlian'],
        rowOf: s => [s.nis, s.full_name, s.program?.name ?? ''],
    },
    {
        id: 'alumni',
        label: 'Alumni',
        hint: 'NIS, nama, tahun lulus, program',
        filename: 'export_alumni.xlsx',
        async fetch() {
            return fetchAllRows('students',
                q => q.select('full_name, nis, graduated_academic_year, program:programs ( name )')
                      .eq('student_status', 'LULUS')
                      .order('graduated_academic_year', { ascending: false }));
        },
        headers: ['NIS', 'Nama', 'Tahun Lulus', 'Program Keahlian'],
        rowOf: s => [s.nis, s.full_name, s.graduated_academic_year ?? '', s.program?.name ?? ''],
    },
    {
        id: 'ortu',
        label: 'Orang Tua',
        hint: 'NIK, nama',
        filename: 'export_ortu.xlsx',
        async fetch() {
            return fetchAllRows('users',
                q => q.select('full_name, login_identifier').eq('role_type', 'ORTU').order('full_name'));
        },
        headers: ['NIK', 'Nama'],
        rowOf: u => [u.login_identifier, u.full_name],
    },
    {
        id: 'dudi',
        label: 'DUDI / Mitra PKL',
        hint: 'Login, nama usaha, penanggung jawab, program',
        filename: 'export_dudi.xlsx',
        async fetch() {
            const [users, programs] = await Promise.all([
                fetchAllRows('users',
                    q => q.select('full_name, login_identifier, dudi_org_name, program_id').eq('role_type', 'DUDI').order('dudi_org_name')),
                getPrograms(),
            ]);
            const pn = new Map(programs.map(p => [p.program_id, p.name]));
            return users.map(u => ({ ...u, _program: pn.get(u.program_id) ?? '' }));
        },
        headers: ['Login', 'Nama Usaha', 'Penanggung Jawab', 'Program Keahlian'],
        rowOf: u => [u.login_identifier, u.dudi_org_name ?? '', u.full_name, u._program],
    },
];

function xlsxExport(headers, rows, sheetName, filename) {
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    // Auto-lebar kolom: karakter terpanjang per kolom
    const colWidths = headers.map((h, ci) => {
        const max = Math.max(h.length, ...rows.map(r => String(r[ci] ?? '').length));
        return { wch: Math.min(max + 2, 50) };
    });
    ws['!cols'] = colWidths;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    XLSX.writeFile(wb, filename);
}

async function renderExportPanel() {
    panelContent.innerHTML = `
        <h3>Export Data</h3>
        <p class="hint" style="margin-bottom:20px">Unduh data sekolah sebagai file Excel (.xlsx) untuk keperluan arsip atau pengolahan lanjutan.</p>
        <div id="export-cards" style="display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:12px">
            ${EXPORT_DEFS.map(d => `
                <div style="border:1px solid var(--color-border,#dde3e9); border-radius:10px; padding:16px">
                    <div style="font-weight:600; margin-bottom:4px">${d.label}</div>
                    <div class="hint" style="font-size:12px; margin-bottom:12px">${d.hint}</div>
                    <button class="btn btn-primary btn-sm" data-export-id="${d.id}">⬇ Unduh Excel</button>
                    <span class="export-status-${d.id} hint" style="display:block; margin-top:6px; font-size:12px"></span>
                </div>
            `).join('')}
        </div>
    `;

    for (const def of EXPORT_DEFS) {
        document.querySelector(`[data-export-id="${def.id}"]`).addEventListener('click', async (e) => {
            const btn    = e.currentTarget;
            const status = panelContent.querySelector(`.export-status-${def.id}`);
            btn.disabled = true;
            btn.textContent = 'Memuat…';
            status.textContent = '';
            try {
                const rows = await def.fetch();
                xlsxExport(def.headers, rows.map(def.rowOf), def.label, def.filename);
                status.textContent = `✓ ${rows.length} baris diunduh`;
            } catch (err) {
                console.error('[export]', err);
                status.style.color = 'var(--color-danger,#dc2626)';
                status.textContent = 'Gagal memuat data.';
            } finally {
                btn.disabled = false;
                btn.textContent = '⬇ Unduh Excel';
            }
        });
    }
}

// ─────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────

(async () => {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData?.user) { window.location.href = 'index.html'; return; }

    const userRow = await getCurrentUserRow();
    if (!requireAdministrativeOrRedirect(userRow)) return;

    applyBrandingById(userRow.school_id, supabase);
    const config = await getSchoolConfig();
    document.getElementById('dashboard-school-name').textContent = config?.school_name ?? 'Sekolah';
    document.getElementById('dashboard-user-name').textContent = `Masuk sebagai ${userRow.full_name}`;

    renderSetupPanel();
})();
