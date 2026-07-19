/**
 * @file admin/js/dashboard.js
 *
 * Dashboard read-only — menampilkan data yang sudah diinput di wizard.
 * Tidak ada edit, insert, delete. Untuk mengubah data, kembali ke wizard.
 */

import { applyBrandingById, getLoginUrl } from '../../shared/branding.js';
import { supabase, getCurrentUserRow, requireAdministrativeOrRedirect, getSchoolConfig, logout, getPrograms, getClasses, fetchAllRows, countStudentsWithoutAccount, provisionStudentAccounts, updateSchoolBranding, getSchoolBranding, setUserActive, deactivateStaff, checkTeacherScheduleDependencies, releaseTeacherFromSchedules, voidObservation, getAlumniRecap, cancelAcademicYear, getStaleStaff, deactivateStaleStaff, deleteUserWithAuth, restoreUser, purgeUser, getDeletedUsers, adminResetUserPassword, updateAlumniCareer, markStudentKeluar, reEnrollStudent, getRetentionCandidates, purgeExpiredStudents, getActiveSubstitutes, getScheduleTemplates, getTimeSlots, getTeacherList, getForumBkStaff, getForumGuruWaliCandidates, getBkAssignments, getGuruWaliAssignments, assignBkToClass, revokeBkFromClass, assignGuruWaliToStudent, revokeGuruWaliFromStudent } from './api.js';
import { mountSemesterPanel } from './semester.js';

function esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function generateTempPassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    const arr = new Uint8Array(12);
    crypto.getRandomValues(arr);
    return Array.from(arr, b => chars[b % chars.length]).join('');
}

function showPwModal(nama, pw) {
    const id = 'pw-result-modal';
    document.getElementById(id)?.remove();
    const el = document.createElement('div');
    el.id = id;
    el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:9999';
    el.innerHTML = `
      <div style="background:var(--color-surface,#1e293b);border:1px solid var(--color-border,#334155);border-radius:10px;padding:28px 32px;max-width:420px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,.4)">
        <h3 style="margin:0 0 8px;font-size:16px">Password berhasil direset</h3>
        <p style="margin:0 0 16px;font-size:13px;color:var(--color-text-muted,#94a3b8)">Password sementara untuk <strong>${esc(nama)}</strong>:</p>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:16px">
          <input id="pw-copy-input" type="text" value="${esc(pw)}" readonly
            style="flex:1;font-family:monospace;font-size:18px;font-weight:700;letter-spacing:2px;padding:10px 12px;border-radius:6px;border:1px solid var(--color-border,#334155);background:var(--color-bg,#0f172a);color:var(--color-text,#f1f5f9);cursor:text" />
          <button id="pw-copy-btn" class="btn btn-primary" style="white-space:nowrap">Salin</button>
        </div>
        <p style="margin:0 0 20px;font-size:12px;color:var(--color-text-muted,#94a3b8)">Catat dan bagikan ke pengguna. Password ini tidak akan ditampilkan lagi.</p>
        <button id="pw-close-btn" class="btn btn-secondary" style="width:100%">Tutup</button>
      </div>`;
    document.body.appendChild(el);
    const input = el.querySelector('#pw-copy-input');
    input.select();
    el.querySelector('#pw-copy-btn').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(pw); } catch { input.select(); document.execCommand('copy'); }
        el.querySelector('#pw-copy-btn').textContent = 'Tersalin ✓';
    });
    el.querySelector('#pw-close-btn').addEventListener('click', () => el.remove());
    el.addEventListener('click', e => { if (e.target === el) el.remove(); });
}

const panelContent = document.getElementById('panel-content');
let schoolSlug = null; // diisi saat init, dipakai panel renderers

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
    'forum-kelas':      renderForumKelasPanel,
};

function navigateToPanel(panelId) {
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('is-active'));
    const link = document.querySelector(`.nav-link[data-panel="${panelId}"]`);
    if (link) link.classList.add('is-active');
    history.replaceState(null, '', '#' + panelId);
    syncBottomNav(panelId);
    (PANEL_RENDERERS[panelId] ?? renderComingSoon)(panelId);
}

document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
        const panel = link.dataset.panel;
        navigateToPanel(panel);
    });
});

document.getElementById('logout-btn').addEventListener('click', async () => {
    await logout();
    window.location.replace(getLoginUrl());
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

// ─── Panel: Penugasan Forum Kelas ────────────────────────

async function renderForumKelasPanel() {
    panelContent.innerHTML =
        '<p class="hint">Memuat data penugasan…</p>';
    try {
        const config = await getSchoolConfig();
        const academicYear = config?.current_academic_year ?? '—';

        const [classes, programs, bkStaff, gwCandidates,
               bkAsgn, gwAsgn, enrollData] =
            await Promise.all([
                getClasses(academicYear),
                getPrograms(),
                getForumBkStaff(),
                getForumGuruWaliCandidates(),
                getBkAssignments(academicYear),
                getGuruWaliAssignments(academicYear),
                supabase
                    .from('class_enrollments')
                    .select('class_id, student:students(student_id, full_name, nis)')
                    .eq('academic_year', academicYear)
                    .is('withdrawn_at', null),
            ]);

        const programNameById = new Map(
            programs.map(p => [p.program_id, p.name])
        );

        // ── BK per Kelas ─────────────────────────────────
        const bkAsnMap = new Map();
        bkAsgn.forEach(a => {
            if (!bkAsnMap.has(a.class_id)) bkAsnMap.set(a.class_id, []);
            bkAsnMap.get(a.class_id).push(a);
        });

        // Kelompokkan kelas per program
        const byProgram = new Map();
        classes.forEach(cls => {
            const progName = programNameById.get(cls.program_id)
                ?? 'Tanpa Program';
            if (!byProgram.has(progName)) byProgram.set(progName, []);
            byProgram.get(progName).push(cls);
        });
        const progNames = [...byProgram.keys()].sort((a, b) => {
            if (/^Tanpa/i.test(a)) return 1;
            if (/^Tanpa/i.test(b)) return -1;
            return a.localeCompare(b, 'id');
        });

        const bkAccordion = progNames.map(progName => {
            const progClasses = byProgram.get(progName);
            const progRows = progClasses.map(cls => {
                const assigned = bkAsnMap.get(cls.class_id) ?? [];
                const names = assigned
                    .map(a => {
                        const bk = bkStaff.find(s => s.user_id === a.bk_user_id);
                        return bk ? esc(bk.full_name) : null;
                    })
                    .filter(Boolean);
                const cell = names.length > 0
                    ? names.join(', ')
                    : '<span style="color:var(--color-text-muted)">Belum ditugaskan</span>';
                return `<tr>
                    <td style="font-weight:500">${esc(cls.name)}</td>
                    <td>${cell}</td>
                </tr>`;
            }).join('');
            return `<details style="margin-bottom:8px">
                <summary style="cursor:pointer;font-weight:600">
                    ${esc(progName)} (${progClasses.length} kelas)
                </summary>
                <table class="table" style="width:100%;margin-top:8px;table-layout:fixed">
                    <thead><tr>
                        <th style="width:40%">Kelas</th>
                        <th style="width:60%">BK yang Ditugaskan</th>
                    </tr></thead>
                    <tbody>${progRows}</tbody>
                </table>
            </details>`;
        }).join('');

        // ── Guru Wali per Siswa ───────────────────────────
        const gwAsnMap = new Map();
        gwAsgn.forEach(a => {
            gwAsnMap.set(a.student_id, a.guru_user_id);
        });

        // class_id → [siswa]
        const classStudentMap = new Map(classes.map(c => [c.class_id, []]));
        (enrollData.data ?? []).forEach(e => {
            if (e.student && classStudentMap.has(e.class_id)) {
                classStudentMap.get(e.class_id).push(e.student);
            }
        });
        for (const list of classStudentMap.values()) {
            list.sort((a, b) => a.full_name.localeCompare(b.full_name, 'id'));
        }

        const gwAccordion = progNames.map(progName => {
            const progClasses = byProgram.get(progName);
            const progTotal = progClasses.reduce(
                (s, cls) => s + (classStudentMap.get(cls.class_id)?.length ?? 0), 0
            );
            const classHtml = progClasses.map(cls => {
                const students = classStudentMap.get(cls.class_id) ?? [];
                const clsTotal = students.length;
                const rows = students.map(stu => {
                    const gwUserId = gwAsnMap.get(stu.student_id);
                    const gw = gwCandidates.find(s => s.user_id === gwUserId);
                    return `<tr>
                        <td style="overflow:hidden;text-overflow:ellipsis;
                            white-space:nowrap">${esc(stu.full_name)}</td>
                        <td style="font-size:12px;color:var(--color-text-muted);
                            overflow:hidden;text-overflow:ellipsis;
                            white-space:nowrap">${esc(stu.nis)}</td>
                        <td style="overflow:hidden;text-overflow:ellipsis;
                            white-space:nowrap">${gw
                            ? esc(gw.full_name)
                            : '<span style="color:var(--color-text-muted)">Belum ditugaskan</span>'}
                        </td>
                    </tr>`;
                }).join('');
                return `<details style="margin:4px 0 4px 16px">
                    <summary style="cursor:pointer;font-weight:600">
                        ${esc(cls.name)} (${clsTotal})
                    </summary>
                    <table class="table" style="width:100%;margin-top:8px;table-layout:fixed">
                        <thead><tr>
                            <th style="width:45%">Siswa</th>
                            <th style="width:15%">NIS</th>
                            <th style="width:40%">Guru Wali</th>
                        </tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </details>`;
            }).join('');
            return `<details style="margin-bottom:8px">
                <summary style="cursor:pointer;font-weight:600">
                    ${esc(progName)} (${progTotal} siswa)
                </summary>
                <div style="padding:4px 0">${classHtml}</div>
            </details>`;
        }).join('');

        panelContent.innerHTML = `
            <h3>Penugasan Forum Kelas — ${esc(academicYear)}</h3>
            <p class="hint" style="margin-bottom:20px">
                Untuk mengubah penugasan, buka wizard admin.
            </p>

            <h4 style="margin:0 0 12px">BK per Kelas</h4>
            ${classes.length > 0 ? bkAccordion
                : '<p class="hint">Belum ada kelas di tahun ajaran ini.</p>'}

            <hr style="margin:24px 0;border:none;
                border-top:1px solid var(--color-border)">

            <h4 style="margin:0 0 12px">Guru Wali per Siswa</h4>
            ${classes.length > 0 ? gwAccordion
                : '<p class="hint">Belum ada kelas di tahun ajaran ini.</p>'}
        `;

        // Single-expand: saat satu accordion dibuka, tutup sibling
        panelContent.querySelectorAll('details').forEach(det => {
            det.addEventListener('toggle', () => {
                if (!det.open) return;
                const parent = det.parentElement;
                if (!parent) return;
                parent.querySelectorAll(':scope > details').forEach(sib => {
                    if (sib !== det) sib.open = false;
                });
            });
        });

    } catch (err) {
        panelContent.innerHTML =
            `<div class="alert alert-danger">${fe(err)}</div>`;
    }
}

function renderComingSoon(panel) {
    panelContent.innerHTML = `<p class="hint">Panel "${panel}" belum diimplementasikan.</p>`;
}

// ─────────────────────────────────────────────────────────────
// BAGIKAN PORTAL
// ─────────────────────────────────────────────────────────────

function renderSharePortalPanel() {
    const base = window.location.href.replace(/\/admin\/.*$/, '');
    const slug = schoolSlug ?? '';
    if (!slug) {
        panelContent.innerHTML = `<p class="hint">Data sekolah belum tersedia. Muat ulang halaman.</p>`;
        return;
    }
    const portals = [
        { label: 'Portal Guru & Staf', path: 'guru/index.html' },
        { label: 'Portal Siswa',        path: 'student/index.html' },
        { label: 'Portal Orang Tua',    path: 'parent/index.html' },
        { label: 'Portal DUDI',         path: 'dudi/index.html' },
        { label: 'Portal Stakeholder',  path: 'stakeholder/index.html' },
    ];

    const rows = portals.map(p => {
        const url = `${base}/${p.path}?school=${encodeURIComponent(slug)}`;
        return `
        <tr>
            <td style="padding:10px 8px;white-space:nowrap;font-weight:500">${p.label}</td>
            <td style="padding:10px 8px;word-break:break-all;font-size:0.82rem;color:var(--color-text-muted)">${url}</td>
            <td style="padding:10px 8px;white-space:nowrap">
                <button class="btn btn-sm btn-secondary copy-link-btn" data-url="${url}">Salin</button>
            </td>
        </tr>`;
    }).join('');

    panelContent.innerHTML = `
        <h3 style="margin-bottom:4px">Bagikan Portal</h3>
        <p class="hint" style="margin-bottom:16px">
            Salin link di bawah lalu kirim ke pengguna masing-masing (WhatsApp, email, dll).
        </p>
        <div class="card" style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse">
                <thead>
                    <tr style="border-bottom:1px solid var(--color-border)">
                        <th style="padding:8px;text-align:left;font-size:0.8rem;color:var(--color-text-muted)">Portal</th>
                        <th style="padding:8px;text-align:left;font-size:0.8rem;color:var(--color-text-muted)">Link</th>
                        <th style="padding:8px"></th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
        <p id="copy-toast" class="hint-success" style="display:none;margin-top:12px">✓ Link disalin ke clipboard!</p>
    `;

    panelContent.querySelectorAll('.copy-link-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            await navigator.clipboard.writeText(btn.dataset.url);
            btn.textContent = 'Disalin!';
            setTimeout(() => { btn.textContent = 'Salin'; }, 2000);
        });
    });
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
        supabase.from('users').select('*', { count: 'exact', head: true }).not('role_type', 'in', '("SISWA","ORTU","DUDI","ADMINISTRATIVE","STAKEHOLDER")').is('deleted_at', null),
        supabase.from('students').select('*', { count: 'exact', head: true }).eq('student_status', 'AKTIF'),
        supabase.from('students').select('*', { count: 'exact', head: true }).eq('student_status', 'LULUS'),
        supabase.from('users').select('*', { count: 'exact', head: true }).eq('role_type', 'DUDI').is('deleted_at', null),
        supabase.from('users').select('*', { count: 'exact', head: true }).eq('role_type', 'STAKEHOLDER').is('deleted_at', null),
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

    const base = window.location.href.replace(/\/admin\/.*$/, '');
    const slug = schoolSlug ? encodeURIComponent(schoolSlug) : '';
    const portalUrl = (path) => slug ? `${base}/${path}?school=${slug}` : null;

    const items = [
        { label: 'Program Keahlian',  count: programCount,     panel: 'programs',    portal: null },
        { label: 'Kelas & Rombel',    count: classCount,       panel: 'classes',     portal: null },
        { label: 'Staf & Peran',      count: stafCount,        panel: 'staff',       portal: portalUrl('guru/index.html') },
        { label: 'Siswa Aktif',       count: siswaCount,       panel: 'students',    portal: portalUrl('student/index.html') },
        { label: 'Alumni',            count: alumniCount,      panel: 'alumni',      portal: null },
        { label: 'Orang Tua Siswa',   count: ortuSiswaCount,   panel: 'parents',     portal: portalUrl('parent/index.html') },
        { label: 'Orang Tua Alumni',  count: ortuAlumniCount,  panel: 'alumni',      portal: null },
        { label: 'DUDI',              count: dudiCount,        panel: 'dudi',        portal: portalUrl('dudi/index.html') },
        { label: 'Stakeholder',       count: stakeholderCount, panel: 'stakeholders',portal: portalUrl('stakeholder/index.html') },
        { label: 'Jadwal',            count: jadwalCount,      panel: 'jadwal',      portal: null },
    ];

    panelContent.innerHTML = `
        <h3>Ringkasan Data Sekolah</h3>
        <p class="hint">Untuk mengubah data, kembali ke <a href="${schoolSlug ? `wizard.html?school=${encodeURIComponent(schoolSlug)}` : 'wizard.html'}">Setup Wizard</a>.</p>
        <table class="table">
            <thead><tr><th>Data</th><th>Jumlah</th><th>Link Portal</th></tr></thead>
            <tbody>${items.map(i => `
                <tr style="cursor:pointer" class="setup-row" data-panel="${i.panel}">
                    <td>${i.label}</td>
                    <td><span class="badge ${i.count > 0 ? 'badge-success' : 'badge-muted'}">${i.count ?? 0}</span></td>
                    <td>${i.portal ? `<button class="btn btn-sm btn-secondary copy-portal-btn" data-url="${i.portal}" onclick="event.stopPropagation()">Salin Link</button>` : ''}</td>
                </tr>
            `).join('')}</tbody>
        </table>
        <p id="copy-portal-toast" class="hint-success" style="display:none;margin-top:10px">✓ Link disalin ke clipboard!</p>
    `;

    panelContent.querySelectorAll('.setup-row').forEach(row => {
        row.addEventListener('click', () => {
            const navLink = document.querySelector(`.nav-link[data-panel="${row.dataset.panel}"]`);
            if (navLink) navLink.click();
        });
    });

    panelContent.querySelectorAll('.copy-portal-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            await navigator.clipboard.writeText(btn.dataset.url);
            btn.textContent = 'Disalin!';
            const toast = document.getElementById('copy-portal-toast');
            toast.style.display = 'block';
            setTimeout(() => { btn.textContent = 'Salin Link'; toast.style.display = 'none'; }, 2000);
        });
    });
}

// ─────────────────────────────────────────────────────────────
// BRANDING PANEL
// ─────────────────────────────────────────────────────────────

async function renderBrandingPanel() {
    panelContent.innerHTML = '<p class="hint">Memuat data sekolah…</p>';

    let current = {};
    let brandingLoadFailed = false;
    try { current = await getSchoolBranding(); } catch {
        brandingLoadFailed = true;
    }

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

            <div id="br-msg" style="display:${brandingLoadFailed ? 'block' : 'none'}; margin-bottom:12px; font-size:13px; color:red">
                ${brandingLoadFailed ? 'Gagal memuat data branding. Silakan refresh halaman sebelum menyimpan.' : ''}
            </div>

            <button class="btn btn-primary" id="br-save-btn" ${brandingLoadFailed ? 'disabled' : ''}>Simpan Perubahan</button>
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

function buildJabatan(u, classMap = new Map(), progMap = new Map()) {
    const j = [];
    if (u.role_type === 'GURU' || u.teacher_code) j.push('Guru');
    if (u.wali_kelas_class_id) {
        const kelas = classMap.get(u.wali_kelas_class_id);
        j.push(kelas ? `Wali Kelas ${kelas}` : 'Wali Kelas');
    }
    if (u.is_bk) j.push('BK');
    if (u.kaprodi_program_id) {
        const prog = progMap.get(u.kaprodi_program_id);
        j.push(prog ? `Kaprodi ${prog}` : 'Kaprodi');
    }
    if (u.is_kepsek) j.push('Kepsek');
    if (u.is_waka_kurikulum) j.push('Waka Kurikulum');
    if (u.is_waka_kesiswaan) j.push('Waka Kesiswaan');
    if (u.is_waka_humas) j.push('Waka Humas');
    if (u.role_type === 'KEPSEK' && !j.length) j.push('Kepsek');
    if (u.role_type === 'BK' && !j.includes('BK')) j.push('BK');
    if (u.role_type === 'WAKA_KURIKULUM' && !j.includes('Waka Kurikulum')) j.push('Waka Kurikulum');
    if (u.role_type === 'WAKA_KESISWAAN' && !j.includes('Waka Kesiswaan')) j.push('Waka Kesiswaan');
    if (u.role_type === 'WAKA_HUMAS' && !j.includes('Waka Humas')) j.push('Waka Humas');
    return j.join(', ') || u.role_type;
}

async function renderStaffPanel() {
    const [users, classRows, progRows] = await Promise.all([
        fetchAllRows('users',
            q => q.select('user_id, full_name, login_identifier, teacher_code, role_type, is_bk, is_kepsek, is_waka_kurikulum, is_waka_kesiswaan, is_waka_humas, wali_kelas_class_id, kaprodi_program_id, is_active, must_change_password')
                  .not('role_type', 'in', '("SISWA","ORTU","DUDI","ADMINISTRATIVE","STAKEHOLDER")')
                  .is('deleted_at', null)
                  .order('full_name')),
        fetchAllRows('classes',       q => q.select('class_id, name')),
        fetchAllRows('programs', q => q.select('program_id, code, name')),
    ]);
    const classMap = new Map(classRows.map(c => [c.class_id, c.name]));
    const progMap  = new Map(progRows.map(p => [p.program_id, p.code ?? p.name]));

    const aktif    = users.filter(u => u.is_active !== false);
    const nonaktif = users.filter(u => u.is_active === false);

    function staffRow(u) {
        const rowStyle = u.is_active === false ? 'opacity:.5' : '';
        const badge    = u.is_active === false
            ? '<span class="badge badge-warning" style="margin-left:6px">Nonaktif</span>'
            : '';
        const btn = u.is_active === false
            ? `<button class="btn btn-sm btn-secondary staff-toggle-btn" data-user-id="${u.user_id}" data-active="false">Aktifkan</button>`
            : `<button class="btn btn-sm btn-warning staff-toggle-btn" data-user-id="${u.user_id}" data-active="true">Nonaktifkan</button>`;
        const resetBtn = u.must_change_password
            ? `<span class="badge badge-muted" style="margin-left:4px" title="Menunggu pengguna ganti password">Menunggu ganti PW</span>`
            : `<button class="btn btn-sm btn-secondary staff-reset-pw-btn" data-user-id="${u.user_id}" data-nama="${esc(u.full_name)}" style="margin-left:4px">Reset PW</button>`;
        return `<tr style="${rowStyle}">
            <td>${esc(u.full_name)}${badge}</td>
            <td>${esc(u.login_identifier)}</td>
            <td>${esc(u.teacher_code ?? '—')}</td>
            <td>${buildJabatan(u, classMap, progMap)}</td>
            <td style="white-space:nowrap">${btn}${resetBtn}</td>
        </tr>`;
    }

    panelContent.innerHTML = `
        <h3>Staf & Peran (${aktif.length} aktif${nonaktif.length ? `, ${nonaktif.length} nonaktif` : ''})</h3>
        <table class="table">
            <thead><tr><th>Nama</th><th>NIP/NIK</th><th>Kode</th><th>Jabatan</th><th>Aksi</th></tr></thead>
            <tbody id="staff-tbody">${users.map(staffRow).join('')}</tbody>
        </table>
        <p class="hint" style="margin-top:8px;font-size:12px">Staf nonaktif tidak bisa login. Data absensi dan catatan mereka tetap tersimpan.</p>
        <div style="margin-top:12px;border-top:1px solid var(--color-border);padding-top:12px;display:flex;gap:8px;flex-wrap:wrap">
            <button id="btn-stale-staff" class="btn btn-secondary btn-sm">Cek Staf Tanpa Jadwal Aktif…</button>
            <button id="btn-recycle-bin" class="btn btn-secondary btn-sm">🗑 Recycle Bin</button>
        </div>
        <div id="stale-staff-panel"  style="display:none;margin-top:10px"></div>
        <div id="recycle-bin-panel"  style="display:none;margin-top:10px"></div>
    `;

    document.getElementById('btn-stale-staff')?.addEventListener('click', async () => {
        const btn   = document.getElementById('btn-stale-staff');
        const panel = document.getElementById('stale-staff-panel');
        btn.disabled = true; btn.textContent = 'Memeriksa…';
        try {
            const stale = await getStaleStaff();
            if (stale.length === 0) {
                panel.innerHTML = '<p class="hint-success">✓ Semua guru aktif memiliki jadwal di tahun ajaran ini.</p>';
            } else {
                panel.innerHTML = `
                    <div class="alert alert-warning" style="display:block;margin-bottom:10px">
                        <strong>${stale.length} guru</strong> aktif tidak memiliki jadwal mengajar di tahun ajaran saat ini.
                        Mereka bisa dinonaktifkan agar tidak bisa login.
                    </div>
                    <table class="table" style="margin-bottom:10px">
                        <thead><tr><th>Nama</th><th>NIP/NIK</th><th>Kode</th></tr></thead>
                        <tbody>${stale.map(u => `<tr><td>${esc(u.full_name)}</td><td>${esc(u.login_identifier)}</td><td>${esc(u.teacher_code ?? '—')}</td></tr>`).join('')}</tbody>
                    </table>
                    <button id="btn-stale-confirm" class="btn btn-sm btn-warning">
                        Nonaktifkan ${stale.length} staf ini
                    </button>
                    <button id="btn-stale-cancel" class="btn btn-sm btn-secondary" style="margin-left:8px">Batal</button>
                `;
                document.getElementById('btn-stale-cancel')?.addEventListener('click', () => {
                    panel.style.display = 'none';
                    btn.disabled = false; btn.textContent = 'Cek Staf Tanpa Jadwal Aktif…';
                });
                document.getElementById('btn-stale-confirm')?.addEventListener('click', async () => {
                    const confirmBtn = document.getElementById('btn-stale-confirm');
                    confirmBtn.disabled = true; confirmBtn.textContent = 'Memproses…';
                    try {
                        const count = await deactivateStaleStaff();
                        panel.innerHTML = `<p class="hint-success">✓ ${count} staf berhasil dinonaktifkan.</p>`;
                        await renderStaffPanel();
                    } catch (err) {
                        panel.innerHTML = `<div class="alert alert-danger">Gagal: ${esc(err.message)}</div>`;
                    }
                });
            }
            panel.style.display = 'block';
        } catch (err) {
            panel.innerHTML = `<div class="alert alert-danger">Gagal memeriksa: ${esc(err.message)}</div>`;
            panel.style.display = 'block';
        } finally {
            btn.disabled = false; btn.textContent = 'Cek Staf Tanpa Jadwal Aktif…';
        }
    });

    document.getElementById('btn-recycle-bin')?.addEventListener('click', async () => {
        const btn   = document.getElementById('btn-recycle-bin');
        const panel = document.getElementById('recycle-bin-panel');
        // toggle
        if (panel.style.display !== 'none') { panel.style.display = 'none'; return; }
        btn.disabled = true;
        try {
            const deleted = await getDeletedUsers();
            if (deleted.length === 0) {
                panel.innerHTML = '<p class="hint-success">✓ Tidak ada pengguna dalam recycle bin.</p>';
            } else {
                const fmt = iso => new Date(iso).toLocaleDateString('id-ID', { day:'numeric', month:'short', year:'numeric' });
                const daysLeft = iso => Math.max(0, 30 - Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
                panel.innerHTML = `
                    <div class="alert alert-warning" style="display:block;margin-bottom:10px">
                        <strong>${deleted.length} pengguna</strong> dihapus sementara. Restore dalam batas 30 hari, atau purge permanen.
                    </div>
                    <table class="table" style="margin-bottom:0">
                        <thead><tr><th>Nama</th><th>NIP/NIK</th><th>Peran</th><th>Dihapus</th><th>Sisa</th><th>Aksi</th></tr></thead>
                        <tbody>
                        ${deleted.map(u => `<tr data-uid="${u.user_id}">
                            <td>${esc(u.full_name)}</td>
                            <td>${esc(u.login_identifier)}</td>
                            <td>${esc(u.role_type)}</td>
                            <td>${fmt(u.deleted_at)}</td>
                            <td>${daysLeft(u.deleted_at)} hari</td>
                            <td style="white-space:nowrap">
                                ${daysLeft(u.deleted_at) > 0
                                    ? `<button class="btn btn-sm btn-secondary rb-restore-btn" data-uid="${u.user_id}" style="margin-right:4px">Pulihkan</button>`
                                    : ''}
                                <button class="btn btn-sm btn-danger rb-purge-btn" data-uid="${u.user_id}">Purge</button>
                            </td>
                        </tr>`).join('')}
                        </tbody>
                    </table>`;

                panel.querySelectorAll('.rb-restore-btn').forEach(b => b.addEventListener('click', async () => {
                    if (!confirm(`Pulihkan ${b.closest('tr').querySelector('td').textContent}?`)) return;
                    b.disabled = true; b.textContent = '…';
                    try { await restoreUser(b.dataset.uid); await renderStaffPanel(); }
                    catch (e) { alert(`Gagal: ${e.message}`); b.disabled = false; b.textContent = 'Pulihkan'; }
                }));

                panel.querySelectorAll('.rb-purge-btn').forEach(b => b.addEventListener('click', async () => {
                    const nama = b.closest('tr').querySelector('td').textContent;
                    if (!confirm(`Hapus PERMANEN ${nama}?\n\nTindakan ini tidak bisa dibatalkan.`)) return;
                    b.disabled = true; b.textContent = '…';
                    try { await purgeUser(b.dataset.uid); await renderStaffPanel(); }
                    catch (e) { alert(`Gagal: ${e.message}`); b.disabled = false; b.textContent = 'Purge'; }
                }));
            }
            panel.style.display = 'block';
        } catch (err) {
            panel.innerHTML = `<div class="alert alert-danger">Gagal memuat: ${esc(err.message)}</div>`;
            panel.style.display = 'block';
        } finally {
            btn.disabled = false;
        }
    });

    document.getElementById('staff-tbody')?.addEventListener('click', async e => {
        // Reset password
        const resetBtn = e.target.closest('.staff-reset-pw-btn');
        if (resetBtn) {
            const userId = resetBtn.dataset.userId;
            const nama   = resetBtn.dataset.nama;
            if (!confirm(`Reset password ${nama}?\n\nPassword akan direset ke password sementara acak. Lanjutkan?`)) return;
            resetBtn.disabled = true; resetBtn.textContent = '…';
            try {
                const newPw = generateTempPassword();
                await adminResetUserPassword(userId, newPw);
                showPwModal(nama, newPw);
                resetBtn.classList.remove('staff-reset-pw-btn');
                resetBtn.textContent = 'Menunggu ganti PW';
                resetBtn.title = 'Menunggu pengguna ganti password';
                resetBtn.style.opacity = '0.6';
            } catch (err) {
                alert(`Gagal reset: ${err.message}`);
                resetBtn.disabled = false; resetBtn.textContent = 'Reset PW';
            }
            return;
        }

        // Toggle aktif/nonaktif
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
                // Bersih — langsung nonaktifkan + cabut jabatan
                if (!confirm(`Nonaktifkan ${nama}?\n\nSemua jabatan struktural (wali kelas, kaprodi, BK, dll) akan dicabut. Staf ini tidak bisa login sampai diaktifkan kembali.`)) {
                    btn.disabled = false; btn.textContent = 'Nonaktifkan'; return;
                }
                await deactivateStaff(userId);
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
                        Jika dinonaktifkan, semua template jadwal dan sesi mulai <em>besok</em> akan dihapus otomatis.
                        Sesi hari ini dan data absensi yang sudah tercatat <em>tidak</em> ikut terhapus.
                    </span>
                    <div style="margin-top:8px;display:flex;gap:8px">
                        <button class="btn btn-sm btn-warning staff-confirm-deactivate"
                            data-user-id="${userId}" data-nama="${esc(nama)}">
                            Hapus jadwal &amp; Nonaktifkan
                        </button>
                        <button class="btn btn-sm btn-secondary staff-cancel-deactivate">Batal</button>
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
                    await deactivateStaff(userId);
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
    const [{ data: allClasses }, enrollments, pendingPwUsers, programs] = await Promise.all([
        supabase.from('classes').select('class_id, name, grade_level, program_id')
            .order('grade_level').order('name'),
        fetchAllRows('class_enrollments', q => q
            .select('class_id, student:students!inner(student_id, full_name, nis, user_id)')
            .eq('academic_year', config?.current_academic_year ?? '')
            .is('withdrawn_at', null)
            .eq('students.student_status', 'AKTIF')),
        fetchAllRows('users', q => q.select('user_id').eq('role_type', 'SISWA').eq('must_change_password', true)),
        getPrograms(),
    ]);
    const programNameById = new Map(
        (programs ?? []).map(p => [p.program_id, p.name])
    );
    const pendingPwSet = new Set((pendingPwUsers ?? []).map(u => u.user_id));

    // classId → [siswa aktif] terurut per nama
    const classMap = new Map((allClasses ?? []).map(c => [c.class_id, []]));
    for (const e of (enrollments ?? [])) {
        if (!e.student || !classMap.has(e.class_id)) continue;
        classMap.get(e.class_id).push(e.student);
    }
    for (const list of classMap.values()) list.sort((a, b) => a.full_name.localeCompare(b.full_name, 'id'));

    const totalAktif = [...classMap.values()].reduce((s, l) => s + l.length, 0);
    // Kelompokkan kelas per program → nested accordion
    const byProgram = new Map();
    (allClasses ?? []).forEach(cls => {
        const progName = programNameById.get(cls.program_id)
            ?? 'Tanpa Program';
        if (!byProgram.has(progName)) byProgram.set(progName, []);
        byProgram.get(progName).push(cls);
    });

    const rowOf = s => `<tr>
        <td>${esc(s.full_name)}</td>
        <td>${esc(s.nis)}</td>
        <td>${s.user_id
            ? (pendingPwSet.has(s.user_id)
                ? `<span class="badge badge-muted"
                    title="Menunggu pengguna ganti password">Menunggu ganti PW</span>`
                : `<button class="btn btn-sm btn-secondary user-reset-pw-btn"
                    data-user-id="${s.user_id}"
                    data-nama="${esc(s.full_name)}">Reset PW</button>`)
            : '<span class="hint" style="font-size:11px">belum ada akun</span>'}
        </td></tr>`;

    const progNames = [...byProgram.keys()].sort((a, b) => {
        if (/^Tanpa/i.test(a)) return 1;
        if (/^Tanpa/i.test(b)) return -1;
        return a.localeCompare(b, 'id');
    });

    const aktifHtml = progNames.map(progName => {
        const progClasses = byProgram.get(progName);
        const progTotal   = progClasses.reduce(
            (s, cls) => s + (classMap.get(cls.class_id)?.length ?? 0), 0
        );
        const classHtml = renderClassAccordion(
            progClasses,
            classMap,
            ['Nama', 'NIS', 'Aksi'],
            rowOf,
        );
        return `<details style="margin-bottom:8px">
            <summary style="cursor:pointer;font-weight:600">
                ${esc(progName)} (${progTotal})
            </summary>
            <div style="padding:4px 0 4px 16px">${classHtml}</div>
        </details>`;
    }).join('');

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

    // Single-expand: saat satu accordion dibuka, tutup sibling
    panelContent.querySelectorAll('details').forEach(det => {
        det.addEventListener('toggle', () => {
            if (!det.open) return;
            const parent = det.parentElement;
            if (!parent) return;
            parent.querySelectorAll(':scope > details').forEach(sib => {
                if (sib !== det) sib.open = false;
            });
        });
    });
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
        fetchAllRows('users', q => q.select('user_id, full_name, login_identifier, must_change_password').eq('role_type', 'ORTU').order('full_name')),
        fetchAllRows('student_parents', q => q.select('parent_user_id, students ( student_id, student_status, full_name )')),
        getSchoolConfig(),
    ]);

    // Fetch semua kelas + enrollment tahun ajaran aktif
    const [{ data: allClasses }, { data: enrollments }, programs] = await Promise.all([
        supabase.from('classes').select('class_id, name, grade_level, program_id')
            .order('grade_level').order('name'),
        supabase.from('class_enrollments')
            .select('student_id, class_id')
            .eq('academic_year', config?.current_academic_year ?? '')
            .is('withdrawn_at', null),
        getPrograms(),
    ]);
    const programNameById = new Map(
        (programs ?? []).map(p => [p.program_id, p.name])
    );

    // Map student_id → class_id
    const studentClassId = new Map((enrollments ?? []).map(e => [e.student_id, e.class_id]));

    // Bangun childMap dan tentukan class_id orang tua dari anak aktif
    const childMap = new Map();
    for (const l of links) {
        if (!childMap.has(l.parent_user_id)) childMap.set(l.parent_user_id, []);
        if (l.students) childMap.get(l.parent_user_id).push(l.students);
    }
    // Map parent_user_id → nama anak aktif (bisa lebih dari satu)
    const childNamesMap = new Map();
    for (const [parentId, children] of childMap) {
        const aktifNames = children
            .filter(c => c.student_status === 'AKTIF')
            .map(c => c.full_name ?? '—');
        childNamesMap.set(parentId, aktifNames);
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

    const rowOf = u => {
        const childNames = childNamesMap.get(u.user_id) ?? [];
        const childCell  = childNames.length
            ? childNames.map(n => esc(n)).join(', ')
            : '<span style="color:var(--color-text-muted)">—</span>';
        return `<tr>
            <td>${esc(u.full_name)}</td>
            <td style="color:var(--color-text-muted);font-size:13px">${childCell}</td>
            <td>${esc(u.login_identifier)}</td>
            <td>${u.must_change_password
                ? `<span class="badge badge-muted"
                    title="Menunggu pengguna ganti password">Menunggu ganti PW</span>`
                : `<button class="btn btn-sm btn-secondary user-reset-pw-btn"
                    data-user-id="${u.user_id}" data-nama="${esc(u.full_name)}">Reset PW</button>`}
            </td></tr>`;
    };

    // Kelompokkan kelas per program
    const byProgram = new Map();
    (allClasses ?? []).forEach(cls => {
        const progName = programNameById.get(cls.program_id) ?? 'Tanpa Program';
        if (!byProgram.has(progName)) byProgram.set(progName, []);
        byProgram.get(progName).push(cls);
    });

    const progNames = [...byProgram.keys()].sort((a, b) => {
        if (/^Tanpa/i.test(a)) return 1;
        if (/^Tanpa/i.test(b)) return -1;
        return a.localeCompare(b, 'id');
    });

    let aktifHtml = progNames.map(progName => {
        const progClasses = byProgram.get(progName);
        const progTotal   = progClasses.reduce(
            (s, cls) => s + (classMap.get(cls.class_id)?.length ?? 0), 0
        );
        const classHtml = renderClassAccordion(
            progClasses,
            classMap,
            ['Nama', 'Nama Anak', 'NIK', 'Aksi'],
            rowOf,
        );
        return `<details style="margin-bottom:8px">
            <summary style="cursor:pointer;font-weight:600">
                ${esc(progName)} (${progTotal})
            </summary>
            <div style="padding:4px 0 4px 16px">${classHtml}</div>
        </details>`;
    }).join('');

    if (tanpaKelas.length > 0) {
        aktifHtml += `<details style="margin-bottom:8px">
            <summary style="cursor:pointer;font-weight:600">
                Tanpa Kelas (${tanpaKelas.length})
            </summary>
            <table class="table" style="margin-top:4px">
                <thead><tr><th>Nama</th><th>NIK</th><th>Aksi</th></tr></thead>
                <tbody>${tanpaKelas.map(rowOf).join('')}</tbody>
            </table></details>`;
    }

    panelContent.innerHTML = `
        <h3>Orang Tua Siswa Aktif (${totalAktif})</h3>
        <p class="hint" style="margin-bottom:12px">Orang tua alumni ada di menu <strong>Alumni</strong>.</p>
        ${aktifHtml}
    `;

    // Single-expand: saat satu accordion dibuka, tutup sibling
    panelContent.querySelectorAll('details').forEach(det => {
        det.addEventListener('toggle', () => {
            if (!det.open) return;
            const parent = det.parentElement;
            if (!parent) return;
            parent.querySelectorAll(':scope > details').forEach(sib => {
                if (sib !== det) sib.open = false;
            });
        });
    });
}

// Menu khusus Alumni: siswa lulus + orang tua yang semua anaknya sudah lulus.
// Keduanya disusun accordion bersarang: Tahun Lulus → Program → Kelas.
async function renderAlumniPanel() {
    // ── Siswa alumni ──
    const siswaRaw = await fetchAllRows('students',
        q => q.select(`student_id, full_name, nis, graduated_academic_year,
            alumni_career_track, alumni_career_note,
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

    const CAREER_LABEL = { KULIAH: 'Kuliah', KERJA: 'Kerja', WIRAUSAHA: 'Wirausaha', TIDAK_DIKETAHUI: '—' };

    const siswaHtml = renderNestedYearProgramClass(siswaRows,
        ['Nama', 'NIS', 'Karir', 'Aksi'],
        s => `<tr>
            <td>${esc(s.full_name)}</td>
            <td>${esc(s.nis)}</td>
            <td>${esc(CAREER_LABEL[s.alumni_career_track] ?? '—')}</td>
            <td style="display:flex;gap:4px;flex-wrap:wrap">
                <button class="btn btn-sm btn-secondary alumni-recap-btn" data-student-id="${s.student_id}" data-name="${esc(s.full_name)}">Cetak Rekap</button>
                <button class="btn btn-sm btn-secondary alumni-career-btn" data-student-id="${s.student_id}"
                    data-track="${esc(s.alumni_career_track ?? '')}" data-note="${esc(s.alumni_career_note ?? '')}">Karir</button>
            </td></tr>`);

    const ortuHtml = renderNestedYearProgramClass(ortuRows, ['Nama', 'NIK'],
        u => `<tr><td>${esc(u.full_name)}</td><td>${esc(u.login_identifier)}</td></tr>`);

    // ── Siswa KELUAR (drop-out) — section terpisah
    const keluarRaw = await fetchAllRows('students',
        q => q.select('student_id, full_name, nis, keluar_at, keluar_note, program:programs(name)')
              .eq('student_status', 'KELUAR').order('keluar_at', { ascending: false }));
    const keluarHtml = keluarRaw.length ? `
        <table class="table"><thead><tr><th>Nama</th><th>NIS</th><th>Program</th><th>Tanggal Keluar</th><th></th></tr></thead>
        <tbody>${keluarRaw.map(s => `<tr>
            <td>${esc(s.full_name)}</td><td>${esc(s.nis)}</td><td>${esc(s.program?.name ?? '—')}</td>
            <td>${s.keluar_at ? new Date(s.keluar_at).toLocaleDateString('id-ID') : '—'}</td>
            <td><button class="btn btn-sm btn-success alumni-reenroll-btn" data-student-id="${s.student_id}" data-name="${esc(s.full_name)}">Re-enroll</button></td>
        </tr>`).join('')}</tbody></table>` : '<p class="hint">Tidak ada siswa dengan status Keluar.</p>';

    panelContent.innerHTML = `
        <h3>Siswa Alumni (${siswaRows.length})</h3>
        <p class="hint" style="margin-bottom:12px">Dikelompokkan per tahun lulus → program keahlian → kelas.</p>
        ${siswaHtml}
        <hr style="margin:24px 0;border:none;border-top:1px solid var(--color-border)" />
        <h3>Siswa KELUAR (${keluarRaw.length})</h3>
        <p class="hint" style="margin-bottom:12px">Drop-out atau pindah sekolah. Tombol <strong>Re-enroll</strong> mengaktifkan kembali akun siswa.</p>
        ${keluarHtml}
        <hr style="margin:24px 0;border:none;border-top:1px solid var(--color-border)" />
        <h3>Orang Tua Alumni (${ortuRows.length})</h3>
        <p class="hint" style="margin-bottom:12px">Mengikuti tahun lulus, program, dan kelas anak alumninya.</p>
        ${ortuHtml}
        <hr style="margin:24px 0;border:none;border-top:1px solid var(--color-border)" />
        <div id="retention-section">
            <h3>Hapus Permanen Data Siswa (Retensi 6 Bulan)</h3>
            <p class="hint" style="margin-bottom:12px">Siswa berstatus <strong>LULUS</strong> atau <strong>KELUAR</strong> yang sudah lebih dari 6 bulan akan dihapus permanen beserta seluruh data terkait (absensi, observasi, kasus, akun). <strong style="color:var(--color-danger)">Tindakan ini tidak dapat dibatalkan.</strong></p>
            <button class="btn btn-secondary" id="btn-load-retention" style="font-size:13px">Cek Kandidat Hapus…</button>
            <div id="retention-result" style="margin-top:12px"></div>
        </div>
    `;

    // Single-expand: saat satu accordion dibuka, tutup sibling
    panelContent.querySelectorAll('details').forEach(det => {
        det.addEventListener('toggle', () => {
            if (!det.open) return;
            const parent = det.parentElement;
            if (!parent) return;
            parent.querySelectorAll(':scope > details').forEach(sib => {
                if (sib !== det) sib.open = false;
            });
        });
    });

    // ── Event handlers ──

    panelContent.querySelectorAll('.alumni-recap-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            btn.disabled = true; btn.textContent = 'Memuat…';
            try { await printAlumniRecap(btn.dataset.studentId); }
            catch (err) { alert(`Gagal membuat rekap: ${err.message}`); }
            finally { btn.disabled = false; btn.textContent = 'Cetak Rekap'; }
        });
    });

    panelContent.querySelectorAll('.alumni-career-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const track = btn.dataset.track;
            const note  = btn.dataset.note;
            const modal = document.createElement('div');
            modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:9999';
            modal.innerHTML = `
                <div style="background:var(--color-surface,#fff);border-radius:12px;padding:24px;max-width:380px;width:90%">
                    <h4 style="margin:0 0 16px">Update Karir Alumni</h4>
                    <div class="field" style="margin-bottom:12px">
                        <label class="label">Jalur Karir</label>
                        <select id="career-track" class="input">
                            <option value="">— Pilih —</option>
                            <option value="KULIAH" ${track==='KULIAH'?'selected':''}>Kuliah / Pendidikan Tinggi</option>
                            <option value="KERJA" ${track==='KERJA'?'selected':''}>Bekerja</option>
                            <option value="WIRAUSAHA" ${track==='WIRAUSAHA'?'selected':''}>Wirausaha</option>
                            <option value="TIDAK_DIKETAHUI" ${track==='TIDAK_DIKETAHUI'?'selected':''}>Tidak Diketahui</option>
                        </select>
                    </div>
                    <div class="field" style="margin-bottom:16px">
                        <label class="label">Catatan (opsional)</label>
                        <textarea id="career-note" class="input" rows="3" style="resize:vertical">${esc(note)}</textarea>
                    </div>
                    <p id="career-status" style="font-size:13px;display:none;margin-bottom:10px"></p>
                    <div style="display:flex;gap:8px;justify-content:flex-end">
                        <button id="career-cancel" class="btn btn-secondary btn-sm">Batal</button>
                        <button id="career-save" class="btn btn-sm" style="background:var(--color-primary,#1d4ed8);color:#fff">Simpan</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);
            modal.querySelector('#career-cancel').onclick = () => modal.remove();
            modal.querySelector('#career-save').onclick = async () => {
                const t = modal.querySelector('#career-track').value;
                const n = modal.querySelector('#career-note').value.trim();
                const saveBtn = modal.querySelector('#career-save');
                const statusEl = modal.querySelector('#career-status');
                saveBtn.disabled = true; saveBtn.textContent = 'Menyimpan…';
                try {
                    await updateAlumniCareer(btn.dataset.studentId, t || null, n || null);
                    btn.dataset.track = t; btn.dataset.note = n;
                    statusEl.textContent = '✓ Disimpan'; statusEl.style.color = 'var(--color-success,#15803d)';
                    statusEl.style.display = 'block';
                    setTimeout(() => modal.remove(), 900);
                } catch (err) {
                    statusEl.textContent = err.message; statusEl.style.color = 'var(--color-danger,#dc2626)';
                    statusEl.style.display = 'block';
                    saveBtn.disabled = false; saveBtn.textContent = 'Simpan';
                }
            };
        });
    });

    panelContent.querySelectorAll('.alumni-reenroll-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm(`Re-enroll ${btn.dataset.name} kembali ke status AKTIF?`)) return;
            btn.disabled = true; btn.textContent = 'Memproses…';
            try {
                await reEnrollStudent(btn.dataset.studentId);
                btn.closest('tr').remove();
            } catch (err) {
                alert(err.message);
                btn.disabled = false; btn.textContent = 'Re-enroll';
            }
        });
    });

    document.getElementById('btn-load-retention')?.addEventListener('click', async () => {
        const btn = document.getElementById('btn-load-retention');
        const resultDiv = document.getElementById('retention-result');
        btn.disabled = true; btn.textContent = 'Memuat…';
        try {
            const candidates = await getRetentionCandidates();
            if (!candidates.length) {
                resultDiv.innerHTML = '<p class="hint">Tidak ada kandidat hapus. Belum ada siswa LULUS/KELUAR yang sudah lebih dari 6 bulan.</p>';
            } else {
                const fmtDate = d => d ? new Date(d).toLocaleDateString('id-ID', { day:'2-digit', month:'short', year:'numeric' }) : '—';
                const statusLabel = { LULUS: 'Lulus', KELUAR: 'Keluar' };
                resultDiv.innerHTML = `
                    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:12px;margin-bottom:12px">
                        <strong style="color:#991b1b">⚠ ${candidates.length} siswa</strong> melewati masa retensi 6 bulan.
                        Hapus permanen akan menghapus <em>semua</em> data terkait dan tidak dapat dipulihkan.
                    </div>
                    <table class="table"><thead><tr><th>Nama</th><th>NIS</th><th>Status</th><th>Tanggal</th><th></th></tr></thead>
                    <tbody>${candidates.map(s => {
                        const tanggal = s.student_status === 'LULUS' ? fmtDate(s.graduated_at) : fmtDate(s.keluar_at);
                        return `<tr data-sid="${s.student_id}">
                            <td>${esc(s.full_name)}</td><td>${esc(s.nis)}</td>
                            <td>${esc(statusLabel[s.student_status] ?? s.student_status)}</td>
                            <td>${esc(tanggal)}</td>
                            <td><button class="btn btn-sm btn-danger purge-student-btn" data-student-id="${s.student_id}" data-name="${esc(s.full_name)}">Hapus Permanen</button></td>
                        </tr>`;
                    }).join('')}</tbody></table>
                    <div style="margin-top:12px;text-align:right">
                        <button id="purge-all-btn" class="btn btn-sm btn-danger">
                            Hapus Semua (${candidates.length}) — Tidak Dapat Dipulihkan
                        </button>
                    </div>`;

                // Hapus satu per satu
                resultDiv.querySelectorAll('.purge-student-btn').forEach(ab => {
                    ab.addEventListener('click', async () => {
                        const nama = ab.dataset.name;
                        if (!confirm(
                            `HAPUS PERMANEN: ${nama}\n\n` +
                            'Seluruh data siswa ini akan dihapus:\n' +
                            '• Absensi & observasi\n• Kasus & riwayat\n• Akun portal\n• Data orang tua (jika tidak punya anak lain)\n\n' +
                            'Tindakan ini TIDAK DAPAT dibatalkan. Lanjutkan?'
                        )) return;
                        ab.disabled = true; ab.textContent = 'Menghapus…';
                        try {
                            await purgeExpiredStudents([ab.dataset.studentId]);
                            ab.closest('tr').remove();
                            const remaining = resultDiv.querySelectorAll('.purge-student-btn').length;
                            if (remaining === 0) resultDiv.innerHTML = '<p class="hint-success">✓ Semua kandidat telah dihapus.</p>';
                        } catch (err) {
                            alert(`Gagal: ${err.message}`);
                            ab.disabled = false; ab.textContent = 'Hapus Permanen';
                        }
                    });
                });

                // Hapus semua sekaligus
                resultDiv.getElementById?.('purge-all-btn') ?? resultDiv.querySelector('#purge-all-btn')?.addEventListener('click', async () => {
                    const n = candidates.length;
                    const confirmText = `HAPUS PERMANEN ${n} SISWA\n\nSeluruh data (absensi, observasi, kasus, akun) akan dihapus.\nTindakan ini TIDAK DAPAT dibatalkan.\n\nKetik "HAPUS" untuk konfirmasi:`;
                    const input = prompt(confirmText);
                    if (input?.trim().toUpperCase() !== 'HAPUS') return;

                    const allBtn = resultDiv.querySelector('#purge-all-btn');
                    if (allBtn) { allBtn.disabled = true; allBtn.textContent = 'Menghapus…'; }
                    try {
                        const ids = candidates.map(c => c.student_id);
                        const result = await purgeExpiredStudents(ids);
                        resultDiv.innerHTML = `<p class="hint-success">✓ ${result.purged} siswa berhasil dihapus permanen.</p>`;
                    } catch (err) {
                        alert(`Gagal: ${err.message}`);
                        if (allBtn) { allBtn.disabled = false; allBtn.textContent = `Hapus Semua (${n}) — Tidak Dapat Dipulihkan`; }
                    }
                });
            }
        } catch (err) {
            resultDiv.innerHTML = `<p style="color:var(--color-danger,#dc2626)">${err.message}</p>`;
        } finally {
            btn.disabled = false; btn.textContent = 'Cek Kandidat Hapus…';
        }
    });
}

// Buka jendela cetak berisi surat keterangan rekap alumnus (10.2/10.3).
async function printAlumniRecap(studentId) {
    const recap = await getAlumniRecap(studentId);
    const s = recap.student;
    const schoolName = document.getElementById('dashboard-school-name')?.textContent?.trim() || 'Sekolah';
    const kelas = alumniClassName(s.enrollment, s.graduated_academic_year);
    const ATT_LABEL = { HADIR:'Hadir', IZIN:'Izin', SAKIT:'Sakit', ALPA:'Alpa' };
    // EKSKUL dihapus dari absensi → dilebur ke HADIR (kompat data lama)
    const att = { ...recap.attendance };
    if (att.EKSKUL) { att.HADIR = (att.HADIR ?? 0) + att.EKSKUL; delete att.EKSKUL; }
    const totalAtt = Object.values(att).reduce((a, b) => a + b, 0);
    const hadir = att.HADIR ?? 0;
    const pctHadir = totalAtt ? Math.round((hadir / totalAtt) * 100) : null;

    const attRows = Object.keys(ATT_LABEL)
        .filter(k => att[k])
        .map(k => `<tr><td>${ATT_LABEL[k]}</td><td style="text-align:right">${att[k]}</td></tr>`).join('')
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
        supabase.from('users').select('user_id, full_name, dudi_org_name, program_id, must_change_password').eq('role_type', 'DUDI').is('deleted_at', null).order('dudi_org_name'),
        getPrograms(),
    ]);
    const pn = new Map(programs.map(p => [p.program_id, p.name]));
    const grouped = renderGroupedTable(
        users ?? [],
        u => u.program_id ? (pn.get(u.program_id) ?? '—') : 'Tanpa Program / Lintas Program',
        ['Nama Usaha', 'Penanggung Jawab', 'Aksi'],
        u => `<tr><td>${u.dudi_org_name ?? '—'}</td><td>${u.full_name}</td><td>${u.must_change_password
            ? `<span class="badge badge-muted" title="Menunggu pengguna ganti password">Menunggu ganti PW</span>`
            : `<button class="btn btn-sm btn-secondary user-reset-pw-btn" data-user-id="${u.user_id}" data-nama="${esc(u.full_name)}">Reset PW</button>`}</td></tr>`,
    );
    panelContent.innerHTML = `
        <h3>DUDI (${(users ?? []).length})</h3>
        ${grouped}
    `;
}

async function renderStakeholdersPanel() {
    const { data: users } = await supabase.from('users').select('user_id, full_name, login_identifier, must_change_password').eq('role_type', 'STAKEHOLDER').is('deleted_at', null).order('full_name');
    panelContent.innerHTML = `
        <h3>Stakeholder (${(users ?? []).length})</h3>
        <table class="table">
            <thead><tr><th>Nama</th><th>Kode Login</th><th>Aksi</th></tr></thead>
            <tbody>${(users ?? []).map(u => `<tr><td>${esc(u.full_name)}</td><td>${esc(u.login_identifier)}</td><td>${u.must_change_password
            ? `<span class="badge badge-muted" title="Menunggu pengguna ganti password">Menunggu ganti PW</span>`
            : `<button class="btn btn-sm btn-secondary user-reset-pw-btn" data-user-id="${u.user_id}" data-nama="${esc(u.full_name)}">Reset PW</button>`}</td></tr>`).join('')}</tbody>
        </table>
    `;
}

// ─── Jadwal panel helpers ────────────────────────────────────
const SCHED_DAYS = ['SENIN','SELASA','RABU','KAMIS','JUMAT','SABTU'];
const SCHED_DAY_LABELS = { SENIN:'Senin', SELASA:'Selasa', RABU:'Rabu', KAMIS:'Kamis', JUMAT:'Jumat', SABTU:'Sabtu' };
const SCHED_GRADES = [10, 11, 12];
const SCHED_GRADE_LABELS = { 10:'Kelas X', 11:'Kelas XI', 12:'Kelas XII' };

function buildJadwalGrid(slots, templates, classes, teacherIdMap) {
    if (slots.length === 0) return '<p class="hint">Belum ada slot waktu untuk hari ini.</p>';

    const cells = new Map();
    for (const t of templates) {
        const slotIdx = slots.findIndex(s =>
            !s.is_break &&
            s.start_time?.slice(0,5) === t.start_time?.slice(0,5) &&
            s.end_time?.slice(0,5) === t.end_time?.slice(0,5)
        );
        if (slotIdx >= 0) {
            cells.set(`${slotIdx}_${t.class_id}`, {
                mapel: t.subject_label ?? '',
                kg: teacherIdMap.get(t.teacher_id) ?? '',
            });
        }
    }

    const thStyle = 'padding:6px 8px;border:1px solid var(--color-border,#334155);background:var(--color-surface,#1e293b);font-size:12px;white-space:nowrap;text-align:center';
    const tdTime  = 'padding:5px 8px;border:1px solid var(--color-border,#334155);font-size:12px;white-space:nowrap;text-align:center;color:var(--color-muted,#94a3b8)';
    const tdBreak = `padding:5px 8px;border:1px solid var(--color-border,#334155);font-size:12px;text-align:center;background:rgba(234,179,8,0.08);color:var(--color-warning,#f59e0b);`;
    const tdCell  = 'padding:4px 6px;border:1px solid var(--color-border,#334155);font-size:12px;text-align:center;min-width:80px';

    let html = `<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%">
        <thead><tr>
            <th style="${thStyle}">No</th>
            <th style="${thStyle}">Waktu</th>
            ${classes.map(c => `<th style="${thStyle}" colspan="2">${esc(c.name)}<br><span style="font-size:10px;font-weight:normal;color:var(--color-muted,#94a3b8)">Mapel / KG</span></th>`).join('')}
        </tr></thead>
        <tbody>`;

    let no = 1;
    for (let idx = 0; idx < slots.length; idx++) {
        const s = slots[idx];
        const timeStr = `${s.start_time?.slice(0,5)} – ${s.end_time?.slice(0,5)}`;
        if (s.is_break) {
            html += `<tr>
                <td style="${tdTime}">—</td>
                <td style="${tdTime}">${timeStr}</td>
                <td style="${tdBreak}" colspan="${classes.length * 2}">${esc(s.break_label ?? 'Istirahat')}</td>
            </tr>`;
        } else {
            html += `<tr><td style="${tdTime}">${no++}</td><td style="${tdTime}">${timeStr}</td>`;
            for (const c of classes) {
                const cell = cells.get(`${idx}_${c.class_id}`) ?? { mapel:'', kg:'' };
                html += `<td style="${tdCell}">${esc(cell.mapel) || '<span style="color:var(--color-muted,#94a3b8)">—</span>'}</td>`;
                html += `<td style="${tdCell};color:var(--color-accent,#38bdf8)">${esc(cell.kg) || '<span style="color:var(--color-muted,#94a3b8)">—</span>'}</td>`;
            }
            html += '</tr>';
        }
    }

    html += '</tbody></table></div>';
    return html;
}

async function renderJadwalPanel() {
    panelContent.innerHTML = '<p class="hint">Memuat…</p>';

    const config = await getSchoolConfig();
    const ay  = config?.current_academic_year ?? '';
    const sem = config?.current_semester ?? 1;
    const [allClasses, teachers, substitutes] = await Promise.all([
        getClasses(ay),
        getTeacherList().catch(() => []),
        getActiveSubstitutes().catch(() => []),
    ]);
    const teacherIdMap = new Map(teachers.filter(t => t.teacher_code).map(t => [t.user_id, t.teacher_code]));

    const wizardUrl = schoolSlug ? `wizard.html?school=${encodeURIComponent(schoolSlug)}` : 'wizard.html';

    const subsHtml = substitutes.length === 0
        ? '<p class="hint">Tidak ada guru pengganti aktif saat ini.</p>'
        : `<table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead><tr style="text-align:left;border-bottom:1px solid var(--color-border,#dde3e9)">
                <th style="padding:6px 8px">Guru Pengganti</th>
                <th style="padding:6px 8px">Kelas / Mata Pelajaran</th>
                <th style="padding:6px 8px">Tanggal Sesi</th>
                <th style="padding:6px 8px">Berlaku sampai</th>
                <th style="padding:6px 8px">Token</th>
            </tr></thead>
            <tbody>${substitutes.map(s => {
                const expire = new Date(s.sync_token_expires_at).toLocaleString('id-ID', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
                const sessionDate = s.schedule?.session_date ?? '—';
                const kelas   = s.schedule?.class?.name   ?? '—';
                const mapel   = s.schedule?.subject?.name ?? '—';
                const name    = s.substitute?.full_name    ?? '—';
                const token   = s.sync_token;
                return `<tr style="border-bottom:1px solid var(--color-border,#eee)">
                    <td style="padding:6px 8px">${esc(name)}</td>
                    <td style="padding:6px 8px">${esc(kelas)} / ${esc(mapel)}</td>
                    <td style="padding:6px 8px">${esc(sessionDate)}</td>
                    <td style="padding:6px 8px">${esc(expire)}</td>
                    <td style="padding:6px 8px">
                        <code style="font-size:11px;background:var(--color-input-bg,#1e293b);padding:2px 6px;border-radius:4px;user-select:all">${esc(token)}</code>
                        <button class="btn btn-sm btn-secondary" style="margin-left:6px" onclick="navigator.clipboard.writeText('${token}').then(()=>{this.textContent='✓ Disalin';setTimeout(()=>this.textContent='Salin',2000)})">Salin</button>
                    </td>
                </tr>`;
            }).join('')}</tbody>
        </table>`;

    // Scaffold: tab hari + tab kelas, grid dimuat saat tab diklik
    panelContent.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:4px">
            <h3 style="margin:0">Jadwal ${ay ? `${ay} Sem ${sem}` : ''}</h3>
            <a href="${wizardUrl}#10" class="btn btn-secondary btn-sm" style="font-size:12px">✎ Edit di Wizard</a>
        </div>

        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px" id="jadwal-grade-tabs">
            ${SCHED_GRADES.map((g, i) => `<button class="btn btn-sm ${i===0?'btn-primary':'btn-secondary'}" data-grade="${g}">${SCHED_GRADE_LABELS[g]}</button>`).join('')}
        </div>

        <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:14px" id="jadwal-day-tabs">
            ${SCHED_DAYS.map((d, i) => `<button class="btn btn-sm ${i===0?'btn-primary':'btn-secondary'}" data-day="${d}">${SCHED_DAY_LABELS[d]}</button>`).join('')}
        </div>

        <div id="jadwal-grid-area"><p class="hint">Memuat grid…</p></div>

        <h4 style="margin:24px 0 8px">Token Guru Pengganti Aktif</h4>
        <p class="hint" style="margin-bottom:10px">Salin token lalu kirim ke HP guru pengganti (mis. via WhatsApp). Token otomatis kedaluwarsa saat sesi selesai.</p>
        ${subsHtml}
    `;

    let activeGrade = 10;
    let activeDay   = 'SENIN';

    async function loadGrid() {
        const gridArea = document.getElementById('jadwal-grid-area');
        if (!gridArea) return;
        gridArea.innerHTML = '<p class="hint">Memuat…</p>';
        try {
            const classes = allClasses.filter(c => c.grade_level === activeGrade).sort((a,b) => a.name.localeCompare(b.name,'id'));
            const [slots, templates] = await Promise.all([
                getTimeSlots(ay, sem, activeDay),
                getScheduleTemplates(ay, sem, activeDay),
            ]);
            const filteredTemplates = templates.filter(t => classes.some(c => c.class_id === t.class_id));
            gridArea.innerHTML = classes.length === 0
                ? '<p class="hint">Tidak ada kelas untuk tingkat ini.</p>'
                : buildJadwalGrid(slots, filteredTemplates, classes, teacherIdMap);
        } catch(e) {
            gridArea.innerHTML = `<p style="color:var(--color-danger,#ef4444)">Gagal memuat grid: ${esc(e.message)}</p>`;
        }
    }

    document.getElementById('jadwal-grade-tabs')?.addEventListener('click', e => {
        const grade = Number(e.target.dataset?.grade);
        if (!grade || grade === activeGrade) return;
        activeGrade = grade;
        document.querySelectorAll('#jadwal-grade-tabs button').forEach(b =>
            b.className = `btn btn-sm ${Number(b.dataset.grade) === activeGrade ? 'btn-primary' : 'btn-secondary'}`);
        loadGrid();
    });

    document.getElementById('jadwal-day-tabs')?.addEventListener('click', e => {
        const day = e.target.dataset?.day;
        if (!day || day === activeDay) return;
        activeDay = day;
        document.querySelectorAll('#jadwal-day-tabs button').forEach(b =>
            b.className = `btn btn-sm ${b.dataset.day === activeDay ? 'btn-primary' : 'btn-secondary'}`);
        loadGrid();
    });

    loadGrid();
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
            <button class="btn btn-sm btn-danger" id="cancel-year-btn">Batalkan Tahun Ajaran ${esc(cfg?.current_academic_year ?? '')}</button>
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
                    <td>${o.sentiment === 'POSITIF' ? '✅ Positif' : '⚠ Perlu Perhatian'}</td>
                    <td>${esc(o.student?.full_name ?? '—')}</td>
                    <td>${esc(o.author?.full_name ?? '—')}</td>
                    <td>${o.is_void
                        ? `<span class="badge badge-warning" title="${esc(o.void_reason ?? '')}">Dibatalkan</span>`
                        : `<button class="btn btn-sm btn-warning obs-void-btn" data-obs-id="${o.observation_id}" data-obs-content="${esc((o.content ?? '').slice(0, 80))}">Batalkan</button>`}</td>
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
                q => q.select('full_name, login_identifier, teacher_code, role_type, is_bk, is_kepsek, is_waka_kurikulum, is_waka_kesiswaan, is_waka_humas, wali_kelas_class_id, kaprodi_program_id')
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
    if (!authData?.user) { window.location.replace(getLoginUrl()); return; }

    const [userRow, branding] = await Promise.all([
        getCurrentUserRow(authData.user),
        getSchoolBranding().catch(() => null),
    ]);

    if (!requireAdministrativeOrRedirect(userRow)) return;

    applyBrandingById(userRow.school_id, supabase);

    const schoolName = branding?.name || 'Sekolah';
    schoolSlug = branding?.slug || null;

    document.getElementById('dashboard-school-name').textContent = schoolName;
    document.getElementById('dashboard-user-name').textContent = `Masuk sebagai ${userRow.full_name}`;
    // Delegasi klik Reset PW untuk semua panel non-staf (siswa, ortu, dudi, stakeholder)
    panelContent.addEventListener('click', async e => {
        const btn = e.target.closest('.user-reset-pw-btn');
        if (!btn) return;
        const userId = btn.dataset.userId;
        const nama   = btn.dataset.nama;
        if (!confirm(`Reset password ${nama}?\n\nPassword akan direset ke password sementara acak. Lanjutkan?`)) return;
        btn.disabled = true; btn.textContent = '…';
        try {
            const newPw = generateTempPassword();
            await adminResetUserPassword(userId, newPw);
            showPwModal(nama, newPw);
            btn.classList.remove('user-reset-pw-btn');
            btn.textContent = 'Menunggu ganti PW';
            btn.title = 'Menunggu pengguna ganti password';
            btn.style.opacity = '0.6';
        } catch (err) {
            alert(`Gagal reset: ${err.message}`);
            btn.disabled = false; btn.textContent = 'Reset PW';
        }
    });

    const hashPanel = location.hash.slice(1);
    navigateToPanel(hashPanel in PANEL_RENDERERS ? hashPanel : 'setup');
})();
