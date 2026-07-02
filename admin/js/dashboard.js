/**
 * @file admin/js/dashboard.js
 *
 * Dashboard read-only — menampilkan data yang sudah diinput di wizard.
 * Tidak ada edit, insert, delete. Untuk mengubah data, kembali ke wizard.
 */

import { applyBrandingById } from '../../shared/branding.js';
import { initIdleTimeout } from '../../shared/idle-timeout.js';
import { getCurrentUserRow, requireAdministrativeOrRedirect, getSchoolConfig, logout, getPrograms, getClasses, fetchAllRows, countStudentsWithoutAccount, provisionStudentAccounts, updateSchoolBranding, getSchoolBranding, setUserActive, checkTeacherScheduleDependencies, releaseTeacherFromSchedules, voidObservation, getAlumniRecap, cancelAcademicYear } from './api.js';
import { supabase } from './api.js';
import { mountSemesterPanel } from './semester.js';

function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

const panelContent = document.getElementById('panel-content');

const PANEL_RENDERERS = {
    setup:              renderSetupPanel,
    branding:           renderBrandingPanel,
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
    'academic-year':    renderAcademicYearPanel,
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
        syncBottomNav(link.dataset.panel);
    });
});

// Floating bottom nav (mobile)
function syncBottomNav(panel) {
    document.querySelectorAll('.admin-bottom-nav .nav-tab[data-panel]').forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.panel === panel);
    });
}

document.querySelectorAll('.admin-bottom-nav .nav-tab[data-panel]').forEach(btn => {
    btn.addEventListener('click', () => {
        const panel = btn.dataset.panel;
        document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('is-active'));
        document.querySelector(`.nav-link[data-panel="${panel}"]`)?.classList.add('is-active');
        (PANEL_RENDERERS[panel] ?? renderComingSoon)(panel);
        syncBottomNav(panel);
    });
});

document.getElementById('bottom-menu-btn')?.addEventListener('click', () => {
    menuToggle?.click();
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
        { count: alumniCount },
        { count: dudiCount },
        { count: stakeholderCount },
        { count: jadwalCount },
        linksRaw,
    ] = await Promise.all([
        supabase.from('programs').select('*', { count: 'exact', head: true }),
        supabase.from('classes').select('*', { count: 'exact', head: true }),
        supabase.from('users').select('*', { count: 'exact', head: true }).not('role_type', 'in', '("SISWA","ORTU","DUDI","ADMINISTRATIVE","STAKEHOLDER")'),
        supabase.from('students').select('*', { count: 'exact', head: true }).eq('student_status', 'AKTIF'),
        supabase.from('students').select('*', { count: 'exact', head: true }).eq('student_status', 'LULUS'),
        supabase.from('users').select('*', { count: 'exact', head: true }).eq('role_type', 'DUDI'),
        supabase.from('users').select('*', { count: 'exact', head: true }).eq('role_type', 'STAKEHOLDER'),
        supabase.from('schedule_templates').select('*', { count: 'exact', head: true }),
        fetchAllRows('student_parents', q => q.select('parent_user_id, students(student_status)')),
    ]);

    // Hitung orang tua siswa aktif vs orang tua alumni
    const parentStatuses = new Map();
    for (const l of linksRaw) {
        if (!parentStatuses.has(l.parent_user_id)) parentStatuses.set(l.parent_user_id, []);
        if (l.students?.student_status) parentStatuses.get(l.parent_user_id).push(l.students.student_status);
    }
    let ortuSiswaCount = 0, ortuAlumniCount = 0;
    for (const statuses of parentStatuses.values()) {
        if (statuses.some(s => s === 'AKTIF')) ortuSiswaCount++;
        else if (statuses.every(s => s === 'LULUS')) ortuAlumniCount++;
    }

    const items = [
        { label: 'Program Keahlian',  count: programCount,   panel: 'programs' },
        { label: 'Kelas & Rombel',    count: classCount,     panel: 'classes' },
        { label: 'Staf & Peran',      count: stafCount,      panel: 'staff' },
        { label: 'Siswa Aktif',       count: siswaCount,     panel: 'students' },
        { label: 'Alumni',            count: alumniCount,    panel: 'alumni' },
        { label: 'Orang Tua Siswa',   count: ortuSiswaCount, panel: 'parents' },
        { label: 'Orang Tua Alumni',  count: ortuAlumniCount,panel: 'alumni' },
        { label: 'DUDI',              count: dudiCount,      panel: 'dudi' },
        { label: 'Stakeholder',       count: stakeholderCount, panel: 'stakeholders' },
        { label: 'Jadwal',            count: jadwalCount,    panel: 'jadwal' },
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
// BRANDING PANEL
// ─────────────────────────────────────────────────────────────

async function renderBrandingPanel() {
    panelContent.innerHTML = '<p class="hint">Memuat data sekolah…</p>';

    let current = {};
    try { current = await getSchoolBranding(); } catch { /* biarkan kosong */ }

    const field = (id, label, value, type = 'text', hint = '') => `
        <div style="margin-bottom:14px">
            <label style="display:block; font-size:13px; font-weight:600; margin-bottom:4px">${label}</label>
            ${hint ? `<p class="hint" style="font-size:12px; margin:0 0 4px">${hint}</p>` : ''}
            <input class="input" id="br-${id}" type="${type}" value="${esc(value ?? '')}"
                   style="max-width:480px; width:100%" />
        </div>`;

    panelContent.innerHTML = `
        <h3>Profil &amp; Branding Sekolah</h3>
        <p class="hint" style="margin-bottom:20px">Perubahan langsung diterapkan ke semua portal saat halaman di-refresh.</p>

        <div style="max-width:560px">
            ${field('name',  'Nama Sekolah',   current.name,          'text')}
            ${field('npsn',  'NPSN',           current.npsn,          'text', 'Nomor Pokok Sekolah Nasional (8 digit)')}
            ${field('address','Alamat',        current.address,       'text')}
            ${field('phone', 'Telepon',        current.phone,         'tel')}
            ${field('logo',  'URL Logo',       current.logo_url,      'url',  'URL gambar publik (PNG/JPG, rekomendasi 200×200px)')}

            <div style="margin-bottom:14px">
                <label style="display:block; font-size:13px; font-weight:600; margin-bottom:4px">Warna Utama</label>
                <p class="hint" style="font-size:12px; margin:0 0 4px">Format hex #RRGGBB — tombol dan aksen semua portal.</p>
                <div style="display:flex; align-items:center; gap:10px">
                    <input class="input" id="br-color" type="text" value="${esc(current.primary_color ?? '#1a56db')}"
                           style="max-width:160px" maxlength="7" />
                    <input type="color" id="br-color-picker" value="${esc(current.primary_color ?? '#1a56db')}"
                           style="width:40px; height:38px; border:1px solid var(--color-border,#dde3e9); border-radius:6px; cursor:pointer; padding:2px" />
                    <span id="br-color-preview" style="display:inline-block; width:24px; height:24px; border-radius:4px; background:${esc(current.primary_color ?? '#1a56db')}"></span>
                </div>
            </div>
            <div style="margin-bottom:14px">
                <label style="display:block; font-size:13px; font-weight:600; margin-bottom:4px">Warna Sekunder</label>
                <p class="hint" style="font-size:12px; margin:0 0 4px">Format hex #RRGGBB — hover dan elemen pendukung. Kosongkan untuk auto-gelap dari warna utama.</p>
                <div style="display:flex; align-items:center; gap:10px">
                    <input class="input" id="br-color2" type="text" value="${esc(current.secondary_color ?? '')}"
                           style="max-width:160px" maxlength="7" placeholder="(opsional)" />
                    <input type="color" id="br-color2-picker" value="${esc(current.secondary_color ?? current.primary_color ?? '#1a56db')}"
                           style="width:40px; height:38px; border:1px solid var(--color-border,#dde3e9); border-radius:6px; cursor:pointer; padding:2px" />
                    <span id="br-color2-preview" style="display:inline-block; width:24px; height:24px; border-radius:4px; background:${esc(current.secondary_color ?? 'transparent')}; border:1px solid var(--color-border,#dde3e9)"></span>
                </div>
            </div>

            <div id="br-msg" style="display:none; margin-bottom:12px; font-size:13px"></div>

            <button class="btn btn-primary" id="br-save-btn">Simpan Perubahan</button>
        </div>
    `;

    // Sync color picker ↔ text input ↔ preview (helper)
    function wireColorPair(inputId, pickerId, previewId) {
        const inp  = document.getElementById(inputId);
        const pick = document.getElementById(pickerId);
        const prev = document.getElementById(previewId);
        pick.addEventListener('input', () => {
            inp.value = pick.value;
            prev.style.background = pick.value;
        });
        inp.addEventListener('input', () => {
            const v = inp.value.trim();
            if (/^#[0-9A-Fa-f]{6}$/.test(v)) {
                pick.value = v;
                prev.style.background = v;
            }
        });
    }
    wireColorPair('br-color',  'br-color-picker',  'br-color-preview');
    wireColorPair('br-color2', 'br-color2-picker', 'br-color2-preview');

    document.getElementById('br-save-btn').addEventListener('click', async () => {
        const btn   = document.getElementById('br-save-btn');
        const msgEl = document.getElementById('br-msg');
        btn.disabled = true;
        btn.textContent = 'Menyimpan…';
        msgEl.style.display = 'none';

        try {
            await updateSchoolBranding({
                name:            document.getElementById('br-name').value.trim(),
                npsn:            document.getElementById('br-npsn').value.trim(),
                address:         document.getElementById('br-address').value.trim(),
                phone:           document.getElementById('br-phone').value.trim(),
                logo_url:        document.getElementById('br-logo').value.trim(),
                primary_color:   document.getElementById('br-color').value.trim(),
                secondary_color: document.getElementById('br-color2').value.trim(),
            });
            msgEl.style.color   = 'var(--color-success,#16a34a)';
            msgEl.textContent   = '✓ Perubahan berhasil disimpan. Refresh halaman untuk melihat efek branding.';
            msgEl.style.display = 'block';
        } catch (err) {
            console.error('[branding]', err);
            msgEl.style.color   = 'var(--color-danger,#dc2626)';
            msgEl.textContent   = '✗ ' + (err.message ?? 'Gagal menyimpan.');
            msgEl.style.display = 'block';
        } finally {
            btn.disabled = false;
            btn.textContent = 'Simpan Perubahan';
        }
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

// Render accordion per kelas (termasuk kelas kosong).
// allClasses: [{class_id, name, grade_level}] sudah terurut.
// classMap: Map<class_id, item[]>
function renderClassAccordion(allClasses, classMap, headers, rowOf) {
    if (allClasses.length === 0) return '<p class="hint">Belum ada data kelas.</p>';
    const head = headers.map(h => `<th>${h}</th>`).join('');
    return allClasses.map(cls => {
        const list = classMap.get(cls.class_id) ?? [];
        const body = list.length > 0
            ? `<table class="table" style="margin-top:4px"><thead><tr>${head}</tr></thead><tbody>${list.map(rowOf).join('')}</tbody></table>`
            : `<p class="hint" style="padding:8px 0;margin:0">Belum ada siswa — menunggu PPDB.</p>`;
        return `<details style="margin-bottom:8px">
            <summary style="cursor:pointer;font-weight:600">${esc(cls.name)} (${list.length})</summary>
            ${body}
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
        q => q.select('user_id, full_name, login_identifier, teacher_code, role_type, is_bk, is_kepsek, is_waka_kurikulum, is_waka_kesiswaan, wali_kelas_class_id, kaprodi_program_id, is_active')
              .not('role_type', 'in', '("SISWA","ORTU","DUDI","ADMINISTRATIVE","STAKEHOLDER")')
              .order('full_name'));
    const aktif    = users.filter(u => u.is_active !== false);
    const nonaktif = users.filter(u => u.is_active === false);

    function staffRow(u) {
        const rowStyle = u.is_active === false ? 'opacity:.5' : '';
        const badge    = u.is_active === false
            ? '<span style="font-size:11px;background:#fef3c7;color:#92400e;border-radius:4px;padding:1px 6px;margin-left:6px">Nonaktif</span>'
            : '';
        const btn = u.is_active === false
            ? `<button class="btn btn-sm btn-secondary staff-toggle-btn" data-user-id="${u.user_id}" data-active="false" style="font-size:11px;padding:3px 8px">Aktifkan</button>`
            : `<button class="btn btn-sm staff-toggle-btn" data-user-id="${u.user_id}" data-active="true" style="font-size:11px;padding:3px 8px;background:#b45309;color:#fff;border-color:#b45309">Nonaktifkan</button>`;
        return `<tr style="${rowStyle}">
            <td>${esc(u.full_name)}${badge}</td>
            <td>${esc(u.login_identifier)}</td>
            <td>${esc(u.teacher_code ?? '—')}</td>
            <td>${buildJabatan(u)}</td>
            <td>${btn}</td>
        </tr>`;
    }

    panelContent.innerHTML = `
        <h3>Staf & Peran (${aktif.length} aktif${nonaktif.length ? `, ${nonaktif.length} nonaktif` : ''})</h3>
        <table class="table">
            <thead><tr><th>Nama</th><th>NIP/NIK</th><th>Kode</th><th>Jabatan</th><th>Aksi</th></tr></thead>
            <tbody id="staff-tbody">${users.map(staffRow).join('')}</tbody>
        </table>
        <p class="hint" style="margin-top:8px;font-size:12px">Staf nonaktif tidak bisa login. Data absensi dan catatan mereka tetap tersimpan.</p>
    `;

    document.getElementById('staff-tbody')?.addEventListener('click', async e => {
        const btn = e.target.closest('.staff-toggle-btn');
        if (!btn) return;
        const userId   = btn.dataset.userId;
        const isActive = btn.dataset.active === 'true';
        const nama     = btn.closest('tr').querySelector('td')?.textContent?.split('\n')[0]?.trim() ?? 'staf ini';

        // Aktifkan kembali — langsung, tidak perlu cek
        if (!isActive) {
            if (!confirm(`Aktifkan kembali ${nama}?\n\nStaf ini bisa login kembali ke portal.`)) return;
            btn.disabled = true;
            try {
                await setUserActive(userId, true);
                await renderStaffPanel();
            } catch (err) {
                alert(`Gagal mengaktifkan: ${err.message}`);
                btn.disabled = false;
            }
            return;
        }

        // Nonaktifkan — cek dependensi jadwal dulu
        btn.disabled = true;
        btn.textContent = 'Memeriksa…';
        try {
            const dep = await checkTeacherScheduleDependencies(userId);
            const hasSchedule = dep.templates > 0 || dep.sessions > 0;

            if (!hasSchedule) {
                // Bersih — langsung nonaktifkan
                if (!confirm(`Nonaktifkan ${nama}?\n\nStaf ini tidak bisa login sampai diaktifkan kembali.`)) {
                    btn.disabled = false; btn.textContent = 'Nonaktifkan'; return;
                }
                await setUserActive(userId, false);
                await renderStaffPanel();
                return;
            }

            // Ada penugasan jadwal — tampilkan peringatan inline
            const row = btn.closest('tr');
            const existingWarn = row.nextElementSibling?.classList.contains('staff-warn-row');
            if (existingWarn) { btn.disabled = false; btn.textContent = 'Nonaktifkan'; return; }

            const warnParts = [];
            if (dep.templates > 0) warnParts.push(`${dep.templates} template jadwal`);
            if (dep.sessions  > 0) warnParts.push(`${dep.sessions} sesi mendatang`);

            const warnRow = document.createElement('tr');
            warnRow.className = 'staff-warn-row';
            warnRow.innerHTML = `
                <td colspan="5" style="padding:10px 12px;background:#fef9c3;border-left:3px solid #ca8a04">
                    <strong style="color:#92400e">⚠ ${nama} masih punya ${warnParts.join(' dan ')}.</strong><br>
                    <span style="font-size:12px;color:#78350f">
                        Jika dinonaktifkan, semua template jadwal dan sesi yang belum berlangsung akan dihapus otomatis.
                        Data absensi yang sudah tercatat <em>tidak</em> ikut terhapus.
                    </span>
                    <div style="margin-top:8px;display:flex;gap:8px">
                        <button class="btn btn-sm staff-confirm-deactivate"
                            data-user-id="${userId}" data-nama="${esc(nama)}"
                            style="background:#b45309;color:#fff;border-color:#b45309;font-size:12px">
                            Hapus jadwal &amp; Nonaktifkan
                        </button>
                        <button class="btn btn-sm btn-secondary staff-cancel-deactivate" style="font-size:12px">Batal</button>
                    </div>
                </td>`;
            row.insertAdjacentElement('afterend', warnRow);

            warnRow.querySelector('.staff-cancel-deactivate').addEventListener('click', () => {
                warnRow.remove();
                btn.disabled = false; btn.textContent = 'Nonaktifkan';
            });
            warnRow.querySelector('.staff-confirm-deactivate').addEventListener('click', async () => {
                const confirmBtn = warnRow.querySelector('.staff-confirm-deactivate');
                confirmBtn.disabled = true; confirmBtn.textContent = 'Memproses…';
                try {
                    await releaseTeacherFromSchedules(userId);
                    await setUserActive(userId, false);
                    await renderStaffPanel();
                } catch (err) {
                    alert(`Gagal nonaktifkan: ${err.message}`);
                    warnRow.remove();
                    btn.disabled = false; btn.textContent = 'Nonaktifkan';
                }
            });

        } catch (err) {
            alert(`Gagal memeriksa jadwal: ${err.message}`);
        } finally {
            if (btn.textContent === 'Memeriksa…') {
                btn.disabled = false; btn.textContent = 'Nonaktifkan';
            }
        }
    });
}

async function renderStudentsPanel() {
    const [noAccount, config] = await Promise.all([
        countStudentsWithoutAccount().catch(() => 0),
        getSchoolConfig(),
    ]);

    // Fetch semua kelas + enrollment tahun ajaran aktif sekaligus
    const [{ data: allClasses }, { data: enrollments }] = await Promise.all([
        supabase.from('classes').select('class_id, name, grade_level')
            .order('grade_level').order('name'),
        supabase.from('class_enrollments')
            .select('class_id, student:students!inner(student_id, full_name, nis)')
            .eq('academic_year', config?.current_academic_year ?? '')
            .is('withdrawn_at', null)
            .eq('students.student_status', 'AKTIF'),
    ]);

    // classId → [siswa aktif] terurut per nama
    const classMap = new Map((allClasses ?? []).map(c => [c.class_id, []]));
    for (const e of (enrollments ?? [])) {
        if (!e.student || !classMap.has(e.class_id)) continue;
        classMap.get(e.class_id).push(e.student);
    }
    for (const list of classMap.values()) list.sort((a, b) => a.full_name.localeCompare(b.full_name, 'id'));

    const totalAktif = [...classMap.values()].reduce((s, l) => s + l.length, 0);
    const aktifHtml  = renderClassAccordion(
        allClasses ?? [],
        classMap,
        ['Nama', 'NIS'],
        s => `<tr><td>${esc(s.full_name)}</td><td>${esc(s.nis)}</td></tr>`,
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
        <h3>Siswa Aktif (${totalAktif})</h3>
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
    const [parents, links, config] = await Promise.all([
        fetchAllRows('users', q => q.select('user_id, full_name, login_identifier').eq('role_type', 'ORTU').order('full_name')),
        fetchAllRows('student_parents', q => q.select('parent_user_id, students ( student_id, student_status )')),
        getSchoolConfig(),
    ]);

    // Fetch semua kelas + enrollment tahun ajaran aktif
    const [{ data: allClasses }, { data: enrollments }] = await Promise.all([
        supabase.from('classes').select('class_id, name, grade_level')
            .order('grade_level').order('name'),
        supabase.from('class_enrollments')
            .select('student_id, class_id')
            .eq('academic_year', config?.current_academic_year ?? '')
            .is('withdrawn_at', null),
    ]);

    // Map student_id → class_id
    const studentClassId = new Map((enrollments ?? []).map(e => [e.student_id, e.class_id]));

    // Bangun childMap dan tentukan class_id orang tua dari anak aktif
    const childMap = new Map();
    for (const l of links) {
        if (!childMap.has(l.parent_user_id)) childMap.set(l.parent_user_id, []);
        if (l.students) childMap.get(l.parent_user_id).push(l.students);
    }

    // classId → [orang tua]
    const classMap = new Map((allClasses ?? []).map(c => [c.class_id, []]));
    let tanpaKelas = [];

    for (const p of parents) {
        const children = childMap.get(p.user_id) ?? [];
        const hasAktif = children.some(c => c.student_status === 'AKTIF');
        if (!hasAktif && children.length > 0) continue; // semua anak alumni, masuk menu Alumni
        const refChild = children.find(c => c.student_status === 'AKTIF');
        const clsId = refChild ? studentClassId.get(refChild.student_id) : null;
        if (clsId && classMap.has(clsId)) {
            classMap.get(clsId).push(p);
        } else {
            tanpaKelas.push(p);
        }
    }
    for (const list of classMap.values()) list.sort((a, b) => a.full_name.localeCompare(b.full_name, 'id'));

    const totalAktif = [...classMap.values()].reduce((s, l) => s + l.length, 0) + tanpaKelas.length;
    let aktifHtml = renderClassAccordion(
        allClasses ?? [],
        classMap,
        ['Nama', 'NIK'],
        u => `<tr><td>${esc(u.full_name)}</td><td>${esc(u.login_identifier)}</td></tr>`,
    );
    if (tanpaKelas.length > 0) {
        aktifHtml += `<details style="margin-bottom:8px">
            <summary style="cursor:pointer;font-weight:600">Tanpa Kelas (${tanpaKelas.length})</summary>
            <table class="table" style="margin-top:4px"><thead><tr><th>Nama</th><th>NIK</th></tr></thead>
            <tbody>${tanpaKelas.map(u => `<tr><td>${esc(u.full_name)}</td><td>${esc(u.login_identifier)}</td></tr>`).join('')}</tbody>
            </table></details>`;
    }

    panelContent.innerHTML = `
        <h3>Orang Tua Siswa Aktif (${totalAktif})</h3>
        <p class="hint" style="margin-bottom:12px">Orang tua alumni ada di menu <strong>Alumni</strong>.</p>
        ${aktifHtml}
    `;
}

// Menu khusus Alumni: siswa lulus + orang tua yang semua anaknya sudah lulus.
// Keduanya disusun accordion bersarang: Tahun Lulus → Program → Kelas.
async function renderAlumniPanel() {
    // ── Siswa alumni ──
    const siswaRaw = await fetchAllRows('students',
        q => q.select(`student_id, full_name, nis, graduated_academic_year,
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

    const siswaHtml = renderNestedYearProgramClass(siswaRows, ['Nama', 'NIS', 'Dokumen'],
        s => `<tr><td>${esc(s.full_name)}</td><td>${esc(s.nis)}</td>
            <td><button class="btn btn-sm alumni-recap-btn" data-student-id="${s.student_id}" data-name="${esc(s.full_name)}"
                style="font-size:11px;padding:3px 8px">Cetak Rekap</button></td></tr>`);
    const ortuHtml = renderNestedYearProgramClass(ortuRows, ['Nama', 'NIK'],
        u => `<tr><td>${esc(u.full_name)}</td><td>${esc(u.login_identifier)}</td></tr>`);

    panelContent.innerHTML = `
        <h3>Siswa Alumni (${siswaRows.length})</h3>
        <p class="hint" style="margin-bottom:12px">Dikelompokkan per tahun lulus → program keahlian → kelas. Tombol <strong>Cetak Rekap</strong> membuat surat keterangan rekap (kehadiran, catatan, PKL) untuk alumnus.</p>
        ${siswaHtml}
        <hr style="margin:24px 0;border:none;border-top:1px solid var(--color-border)" />
        <h3>Orang Tua Alumni (${ortuRows.length})</h3>
        <p class="hint" style="margin-bottom:12px">Mengikuti tahun lulus, program, dan kelas anak alumninya.</p>
        ${ortuHtml}
    `;

    panelContent.querySelectorAll('.alumni-recap-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            btn.disabled = true; btn.textContent = 'Memuat…';
            try {
                await printAlumniRecap(btn.dataset.studentId);
            } catch (err) {
                alert(`Gagal membuat rekap: ${err.message}`);
            } finally {
                btn.disabled = false; btn.textContent = 'Cetak Rekap';
            }
        });
    });
}

// Buka jendela cetak berisi surat keterangan rekap alumnus (10.2/10.3).
async function printAlumniRecap(studentId) {
    const recap = await getAlumniRecap(studentId);
    const s = recap.student;
    const schoolName = document.getElementById('dashboard-school-name')?.textContent?.trim() || 'Sekolah';
    const kelas = alumniClassName(s.enrollment, s.graduated_academic_year);
    const ATT_LABEL = { HADIR:'Hadir', IZIN:'Izin', SAKIT:'Sakit', TIDAK_HADIR:'Tidak Hadir', EKSKUL:'Ekskul' };
    const totalAtt = Object.values(recap.attendance).reduce((a, b) => a + b, 0);
    const hadir = recap.attendance.HADIR ?? 0;
    const pctHadir = totalAtt ? Math.round((hadir / totalAtt) * 100) : null;

    const attRows = Object.keys(ATT_LABEL)
        .filter(k => recap.attendance[k])
        .map(k => `<tr><td>${ATT_LABEL[k]}</td><td style="text-align:right">${recap.attendance[k]}</td></tr>`).join('')
        || '<tr><td colspan="2">Tidak ada data kehadiran.</td></tr>';

    const pklRows = recap.pkl.length
        ? recap.pkl.map(p => `<tr><td>${esc(p.org)}</td><td>${p.start_date ?? '—'} s.d. ${p.end_date ?? '—'}</td>
            <td>${p.completed ? '✔ Selesai' : 'Berjalan / belum selesai'}</td></tr>`).join('')
        : '<tr><td colspan="3">Tidak ada data PKL.</td></tr>';

    const today = new Date().toLocaleDateString('id-ID', { day:'numeric', month:'long', year:'numeric' });
    const html = `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8">
        <title>Rekap Alumnus — ${esc(s.full_name)}</title>
        <style>
            body{font-family:Arial,Helvetica,sans-serif;color:#111;max-width:720px;margin:32px auto;padding:0 24px;line-height:1.5}
            h1{font-size:20px;text-align:center;margin:0}
            h2{font-size:15px;border-bottom:2px solid #333;padding-bottom:4px;margin-top:28px}
            .sub{text-align:center;color:#555;margin:4px 0 0}
            table{width:100%;border-collapse:collapse;margin-top:8px;font-size:13px}
            th,td{border:1px solid #ccc;padding:6px 10px;text-align:left}
            th{background:#f3f4f6}
            .id-tbl td{border:none;padding:2px 8px}
            .foot{margin-top:40px;font-size:13px}
            @media print{button{display:none}}
        </style></head><body>
        <h1>${esc(schoolName)}</h1>
        <p class="sub">Rekap / Surat Keterangan Alumnus</p>
        <h2>Data Alumnus</h2>
        <table class="id-tbl">
            <tr><td style="width:180px">Nama</td><td>: <strong>${esc(s.full_name)}</strong></td></tr>
            <tr><td>NIS</td><td>: ${esc(s.nis ?? '—')}</td></tr>
            <tr><td>Program Keahlian</td><td>: ${esc(s.program?.name ?? '—')}</td></tr>
            <tr><td>Kelas Terakhir</td><td>: ${esc(kelas)}</td></tr>
            <tr><td>Tahun Lulus</td><td>: ${esc(s.graduated_academic_year ?? '—')}</td></tr>
        </table>
        <h2>Rekap Kehadiran</h2>
        <table><thead><tr><th>Status</th><th style="text-align:right">Jumlah</th></tr></thead>
            <tbody>${attRows}</tbody></table>
        ${pctHadir !== null ? `<p style="font-size:13px;margin-top:6px">Persentase kehadiran: <strong>${pctHadir}%</strong> (${hadir} dari ${totalAtt} sesi tercatat)</p>` : ''}
        <h2>Catatan Pembinaan</h2>
        <p style="font-size:13px">Catatan positif/prestasi: <strong>${recap.obsPositif}</strong> · Catatan perhatian: <strong>${recap.obsPerhatian}</strong></p>
        <h2>Praktik Kerja Lapangan (PKL)</h2>
        <table><thead><tr><th>Tempat (DUDI)</th><th>Periode</th><th>Status</th></tr></thead>
            <tbody>${pklRows}</tbody></table>
        <p class="foot">Dokumen ini dicetak dari sistem pada ${today}.</p>
        <div style="text-align:center;margin-top:24px"><button onclick="window.print()">Cetak</button></div>
        </body></html>`;

    const w = window.open('', '_blank');
    if (!w) throw new Error('Popup diblokir browser. Izinkan popup lalu coba lagi.');
    w.document.write(html);
    w.document.close();
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

async function renderAcademicYearPanel() {
    panelContent.innerHTML = '<p class="hint">Memuat…</p>';
    const cfg = await getSchoolConfig();

    panelContent.innerHTML = `
        <h3>Tahun Ajaran</h3>
        <div class="card" style="border:1px solid var(--color-border,#dde3e9);border-radius:12px;padding:16px;margin-bottom:16px">
            <p style="margin:0 0 4px">Tahun ajaran aktif:
                <strong>${esc(cfg?.current_academic_year ?? '—')}</strong>
                Semester <strong>${esc(String(cfg?.current_semester ?? '—'))}</strong></p>
            <p class="hint" style="margin:0 0 12px">Untuk naik kelas / kelulusan / buka tahun baru, gunakan wizard Tutup Tahun Ajaran.</p>
            <a href="tutup-tahun.html" class="btn btn-primary btn-sm">Buka Tahun Ajaran Baru (Wizard)</a>
        </div>

        <div class="card" style="border:1px solid #fecaca;background:#fef2f2;border-radius:12px;padding:16px">
            <strong style="color:#b91c1c">⚠ Batalkan Tahun Ajaran Terakhir</strong>
            <p class="hint" style="margin:6px 0 4px;color:#7f1d1d">
                Gunakan HANYA jika tahun ajaran <strong>${esc(cfg?.current_academic_year ?? '—')}</strong> baru saja dibuka dengan
                tahun/semester yang salah. Tindakan ini akan:
            </p>
            <ul class="hint" style="margin:0 0 10px;color:#7f1d1d;padding-left:20px">
                <li>Menghapus periode &amp; seluruh enrollment kenaikan kelas tahun ini</li>
                <li>Memulihkan enrollment tahun sebelumnya untuk siswa yang naik kelas</li>
                <li>Mengembalikan tahun ajaran aktif ke tahun sebelumnya</li>
            </ul>
            <p class="hint" style="margin:0 0 10px;color:#7f1d1d">Status kelulusan siswa (LULUS) <em>tidak</em> berubah — itu langkah terpisah.</p>
            <button class="btn btn-sm" id="cancel-year-btn"
                style="background:#dc2626;color:#fff;border-color:#dc2626">Batalkan Tahun Ajaran ${esc(cfg?.current_academic_year ?? '')}</button>
            <div id="cancel-year-result" class="alert" style="display:none;margin-top:10px"></div>
        </div>
    `;

    document.getElementById('cancel-year-btn').addEventListener('click', async () => {
        const yr = cfg?.current_academic_year ?? '';
        if (!confirm(`Batalkan pembukaan tahun ajaran ${yr}?\n\nKenaikan kelas tahun ini akan dihapus dan tahun ajaran dikembalikan ke sebelumnya. Tindakan ini tidak bisa di-undo.`)) return;
        const typed = prompt(`Untuk konfirmasi, ketik: BATALKAN`);
        if (typed === null) return;
        if (typed.trim().toUpperCase() !== 'BATALKAN') { alert('Konfirmasi tidak cocok. Dibatalkan.'); return; }

        const btn = document.getElementById('cancel-year-btn');
        const resultEl = document.getElementById('cancel-year-result');
        btn.disabled = true; btn.textContent = 'Memproses…';
        try {
            const r = await cancelAcademicYear(cfg.config_id);
            resultEl.className = 'alert alert-success';
            resultEl.innerHTML = `Tahun ajaran <strong>${esc(r.cancelled_year)}</strong> dibatalkan. ` +
                `Aktif kembali: <strong>${esc(r.restored_year)}</strong> Semester ${esc(String(r.restored_semester))}. ` +
                `${r.deleted_enrollments} enrollment dihapus, ${r.restored_enrollments} dipulihkan.`;
            resultEl.style.display = 'block';
            setTimeout(renderAcademicYearPanel, 2500);
        } catch (err) {
            resultEl.className = 'alert alert-danger';
            resultEl.textContent = err.message;
            resultEl.style.display = 'block';
            btn.disabled = false; btn.textContent = `Batalkan Tahun Ajaran ${yr}`;
        }
    });
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
            .select(`observation_id, dimension, sentiment, content, created_at, is_void, void_reason,
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
            <thead><tr><th>Waktu</th><th>Dimensi</th><th>Sentimen</th><th>Siswa</th><th>Oleh</th><th>Aksi</th></tr></thead>
            <tbody>${obsRows.map(o => `
                <tr style="${o.is_void ? 'opacity:.55' : ''}">
                    <td style="white-space:nowrap">${fmtTs(o.created_at)}</td>
                    <td${o.is_void ? ' style="text-decoration:line-through"' : ''}>${DIMENSION_LABELS_ADMIN[o.dimension] ?? o.dimension}</td>
                    <td>${o.sentiment === 'POSITIF' ? '✅ Positif' : '⚠ Perhatian'}</td>
                    <td>${esc(o.student?.full_name ?? '—')}</td>
                    <td>${esc(o.author?.full_name ?? '—')}</td>
                    <td>${o.is_void
                        ? `<span class="hint" title="${esc(o.void_reason ?? '')}" style="font-size:11px;color:#b45309">Dibatalkan</span>`
                        : `<button class="btn btn-sm obs-void-btn" data-obs-id="${o.observation_id}" data-obs-content="${esc((o.content ?? '').slice(0, 80))}" style="font-size:11px;padding:3px 8px;background:#b45309;color:#fff;border-color:#b45309">Batalkan</button>`}</td>
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
            <p class="hint" style="margin:0 0 8px;font-size:12px">Observasi yang salah bisa dibatalkan — akan disembunyikan dari siswa &amp; orang tua, tapi tetap tercatat untuk audit.</p>
            <div style="overflow-x:auto">${obsHtml}</div>
        </details>
    `;

    panelContent.querySelectorAll('.obs-void-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const obsId   = btn.dataset.obsId;
            const preview = btn.dataset.obsContent || '';
            const reason  = window.prompt(
                `Batalkan observasi ini?\n\n"${preview}${preview.length >= 80 ? '…' : ''}"\n\nAlasan pembatalan (wajib):`
            );
            if (reason === null) return;                 // batal di dialog
            if (!reason.trim()) { alert('Alasan pembatalan wajib diisi.'); return; }

            btn.disabled = true;
            btn.textContent = 'Memproses…';
            try {
                await voidObservation(obsId, reason);
                await renderActivityLogPanel();
            } catch (err) {
                alert(`Gagal membatalkan: ${err.message}`);
                btn.disabled = false;
                btn.textContent = 'Batalkan';
            }
        });
    });
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
    initIdleTimeout({ onIdle: async () => { await logout(); window.location.href = 'index.html'; } });
    const config = await getSchoolConfig();
    document.getElementById('dashboard-school-name').textContent = config?.school_name ?? 'Sekolah';
    document.getElementById('dashboard-user-name').textContent = `Masuk sebagai ${userRow.full_name}`;

    renderSetupPanel();
})();
