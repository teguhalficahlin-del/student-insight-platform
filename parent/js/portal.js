/**
 * @file parent/js/portal.js
 *
 * Main logic for the parent portal.
 * Loads children, lets parent pick one, shows attendance + catatan siswa.
 */

import { applyBrandingById, getLoginUrl } from '../../shared/branding.js';
import { checkMustChangePassword } from '../../shared/change-password.js';
import { initLoginGuard, registerLoginDevice } from '../../shared/login-guard.js';
import {
    supabase,
    getCurrentUserRow,
    logout,
    fetchChildren,
    fetchSchedule,
    fetchWeekSchedule,
    fetchAttendance,
    fetchObservations,
    fetchCases,
    fetchPklPlacement,
    fetchPklAttendanceSummary,
    getUnreadNotifCount,
    getRecentNotifications,
    markNotificationsRead,
    getMyChildren,
    getForumSekolahPosts, getForumSekolahSentPosts, addForumSekolahAck, createParentForumPost,
    getChildLateArrivals,
    getChildExits,
} from './api.js';
import { showPwaBanner } from '../../shared/pwa-banner.js';

const portalTitle    = document.getElementById('portal-title');
const portalUserName = document.getElementById('portal-user-name');
const logoutBtn      = document.getElementById('logout-btn');
const loadingEl      = document.getElementById('loading');
const childSelector  = document.getElementById('child-selector');
const selectChild    = document.getElementById('select-child');
const sectionSched   = document.getElementById('section-schedule');
const schedTbody     = document.querySelector('#schedule-table tbody');
const schedEmpty     = document.getElementById('schedule-empty');
const schedDate      = document.getElementById('schedule-date');
const btnSchedule    = document.getElementById('btn-schedule');
const sectionAtt     = document.getElementById('section-attendance');
const sectionObs     = document.getElementById('section-observations');
const attSummary     = document.getElementById('attendance-summary');
const attTbody       = document.querySelector('#attendance-table tbody');
const attEmpty       = document.getElementById('attendance-empty');
const obsListEl      = document.getElementById('observations-list');
const obsEmpty       = document.getElementById('observations-empty');
const casesListEl    = document.getElementById('cases-list');
const casesEmpty     = document.getElementById('cases-empty');
const filterStart    = document.getElementById('filter-date-start');
const filterEnd      = document.getElementById('filter-date-end');
const btnFilter      = document.getElementById('btn-filter');
const childStatusBadge = document.getElementById('child-status-badge');
const sectionPkl     = document.getElementById('section-pkl');
const pklInfo        = document.getElementById('pkl-info');
const pklAttWrap     = document.getElementById('pkl-attendance-wrap');
const pklSummary     = document.getElementById('pkl-summary');
const pklTbody       = document.querySelector('#pkl-table tbody');
const pklEmpty       = document.getElementById('pkl-empty');
const obsDateStart   = document.getElementById('obs-date-start');
const obsDateEnd     = document.getElementById('obs-date-end');
const btnObsFilter   = document.getElementById('btn-obs-filter');
const notifBellBtn   = document.getElementById('notif-bell-btn');
const notifDropdown  = document.getElementById('notif-dropdown');
const sectionForum   = document.getElementById('section-forum');
const sectionNilai   = document.getElementById('section-nilai');
const tabNav         = document.getElementById('tab-nav');
const tabBtns        = document.querySelectorAll('.tab-btn');
const ALL_SECTIONS   = [sectionPkl, sectionSched, sectionAtt,
                        sectionObs, sectionForum, sectionNilai];
let _notifPollTimer  = null;

let currentUser = null;

// ─── Read cache (LF-2) ───────────────────────────────────────
const LC = {
    set(key, data) {
        try { localStorage.setItem(`smkhr:${key}`, JSON.stringify({ ts: Date.now(), data })); } catch {}
    },
    get(key) {
        try { const r = JSON.parse(localStorage.getItem(`smkhr:${key}`)); return r?.data ?? null; }
        catch { return null; }
    },
    clear() {
        try { Object.keys(localStorage).filter(k => k.startsWith('smkhr:')).forEach(k => localStorage.removeItem(k)); }
        catch {}
    },
};
let children    = [];
let currentClassId = null;
let tabLoaded = { pkl:false, schedule:false, attendance:false,
                  observations:false, cases:false, forum:false, nilai:false };

const STATUS_LABELS = {
    HADIR:       'Hadir',
    ALPA: 'Alpa',
    IZIN:        'Izin',
    SAKIT:       'Sakit',
    EKSKUL:      'Hadir',   // EKSKUL dihapus dari absensi → tampil sebagai Hadir (data lama)
};

const STATUS_BADGE = {
    HADIR:       'badge-hadir',
    ALPA: 'badge-tidak-hadir',
    IZIN:        'badge-izin',
    SAKIT:       'badge-sakit',
    EKSKUL:      'badge-hadir',   // idem
};

const DIMENSION_LABELS = {
    AKADEMIK:    'Akademik',
    KEHADIRAN:   'Kehadiran',
    PERILAKU:    'Perilaku',
    SOSIAL:      'Sosial',
    AFEKTIF:     'Afektif',
    BAKAT_MINAT: 'Bakat & Minat',
    FISIK:       'Fisik',
    LAINNYA:     'Lainnya',
};

async function init() {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData?.user) {
        window.location.replace(getLoginUrl());
        return;
    }

    currentUser = await getCurrentUserRow(authData.user);
    if (!currentUser || currentUser.role_type !== 'ORTU') {
        window.location.replace(getLoginUrl());
        return;
    }

    registerLoginDevice(supabase); // fire-and-forget
    portalUserName.textContent = currentUser.full_name;
    await Promise.all([
        applyBrandingById(currentUser.school_id, supabase),
        checkMustChangePassword(supabase, currentUser),
        initLoginGuard(supabase, currentUser),
        fetchChildren(currentUser.user_id).then(c => { children = c; }).catch(err => {
            loadingEl.textContent = 'Gagal memuat data anak.';
            throw err;
        }),
    ]);
    // Tab click handler
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => showTab(btn.dataset.tab));
    });

    if (children.length === 0) {
        loadingEl.textContent = 'Belum ada data anak yang terhubung ke akun Anda. Hubungi admin sekolah.';
        return;
    }

    selectChild.innerHTML = children.map((c, i) =>
        `<option value="${i}">${c.full_name} — ${c.class_name} (${c.nis})</option>`
    ).join('');

    if (children.length > 1) {
        childSelector.style.display = 'flex';
    }

    const today = new Date();
    const monthAgo = new Date(today);
    monthAgo.setDate(monthAgo.getDate() - 30);
    filterStart.value   = localDateStr(monthAgo);
    filterEnd.value     = localDateStr(today);
    schedDate.value     = localDateStr(today);
    obsDateStart.value  = localDateStr(monthAgo);
    obsDateEnd.value    = localDateStr(today);

    loadingEl.style.display = 'none';

    initNotifBell();
    await loadChildData(0);
    showPwaBanner({ hasBottomNav: true });
}

function getTabKey(sectionId) {
    const map = {
        'section-pkl':          'pkl',
        'section-schedule':     'schedule',
        'section-attendance':   'attendance',
        'section-observations': 'observations',
        'section-forum':         'forum',
        'section-nilai':         'nilai',
    };
    return map[sectionId] ?? null;
}

async function showTab(sectionId) {
    // Sembunyikan semua section
    ALL_SECTIONS.forEach(s => {
        s.classList.remove('active');
        s.style.display = 'none';
    });
    // Tampilkan section target
    const target = document.getElementById(sectionId);
    if (!target) return;
    target.style.display = 'block';
    target.classList.add('active');
    // Update tombol aktif
    tabBtns.forEach(b => b.classList.toggle('active',
        b.dataset.tab === sectionId));
    // Lazy load — hanya load sekali per anak
    const key = getTabKey(sectionId);
    if (!key || tabLoaded[key]) return;
    tabLoaded[key] = true;
    const idx   = Number(selectChild.value);
    const child = children[idx];
    if (!child) return;
    if (key === 'pkl')          await loadPkl(child.student_id);
    if (key === 'schedule') {
        currentClassId = child.class_id;
        await loadSchedule(child.class_id);
    }
    if (key === 'attendance') {
        await loadAttendance(child.student_id);
        await loadLateArrivals(child.student_id);
        await loadExits(child.student_id);
    }
    if (key === 'observations') {
        await loadObservations(child.student_id);
        await loadCases(child.student_id);
    }
    if (key === 'forum')         await initForumSection();
    if (key === 'nilai')         await initNilaiTab(child.student_id);
}

const STATUS_STUDENT_LABEL = { AKTIF: 'Aktif', PKL: 'Sedang PKL', LULUS: 'Lulus', KELUAR: 'Tidak aktif' };
const STATUS_STUDENT_CLASS = { AKTIF: 'badge-status-aktif', PKL: 'badge-status-pkl', LULUS: 'badge-status-lulus', KELUAR: 'badge-status-keluar' };

async function loadChildData(index) {
    const child = children[index];
    portalTitle.textContent = `Portal Orang Tua — ${child.full_name}`;

    // Status badge
    if (child.status) {
        childStatusBadge.textContent = STATUS_STUDENT_LABEL[child.status] ?? child.status;
        childStatusBadge.className = `child-status-badge ${STATUS_STUDENT_CLASS[child.status] ?? ''}`;
        childStatusBadge.style.display = 'inline-block';
    } else {
        childStatusBadge.style.display = 'none';
    }

    const isPkl      = child.status === 'PKL';
    const isInactive = child.status === 'LULUS' || child.status === 'KELUAR';

    // Reset lazy-load flags untuk anak baru
    tabLoaded = { pkl:false, schedule:false, attendance:false,
                  observations:false, cases:false, forum:false, nilai:false };
    _forumInitDone = false;

    // Tampilkan tab-nav dan bottom-nav, atur tombol mana yang visible
    tabNav.style.display = 'flex';
    document.getElementById('parent-bottom-nav').style.display = 'block';
    document.querySelectorAll('[data-tab="section-pkl"]')
        .forEach(el => el.toggleAttribute('hidden', !isPkl));
    document.querySelectorAll('[data-tab="section-schedule"]')
        .forEach(el => el.toggleAttribute('hidden', isPkl || isInactive));
    document.querySelectorAll('[data-tab="section-attendance"]')
        .forEach(el => el.toggleAttribute('hidden', isInactive));

    // Tentukan tab default berdasarkan status anak
    const defaultTab = isPkl          ? 'section-pkl'
                     : isInactive     ? 'section-observations'
                     :                  'section-schedule';
    await showTab(defaultTab);
}

async function loadSchedule(classId) {
    const contentEl = document.getElementById('sched-content');
    contentEl.innerHTML = '<p class="hint">Memuat jadwal…</p>';
    if (!classId) {
        contentEl.innerHTML = '<p class="hint">Anak belum terdaftar di kelas.</p>';
        return;
    }
    const date     = localDateStr();
    const label    = new Date(date + 'T00:00:00')
        .toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    try {
        const rows = await fetchSchedule(classId, date);
        const sesiCount = rows.length;
        const tableHtml = sesiCount === 0
            ? '<p class="hint" style="margin:8px 0 4px">Tidak ada jadwal pada hari ini.</p>'
            : `<div class="table-wrapper">
               <table class="table">
                   <thead><tr><th>Jam</th><th>Mata Pelajaran</th><th>Guru</th></tr></thead>
                   <tbody>${rows.map(r => `
                       <tr>
                           <td>${r.start?.slice(0,5)} – ${r.end?.slice(0,5)}</td>
                           <td>${esc(r.subject)}</td>
                           <td>${esc(r.teacher)}</td>
                       </tr>`).join('')}
                   </tbody>
               </table>
               </div>`;
        contentEl.innerHTML = `
            <details class="att-accordion" open>
                <summary class="att-accordion-summary">
                    <span class="att-acc-name">${esc(label)}</span>
                    <span class="att-acc-names">${sesiCount > 0 ? `${sesiCount} sesi` : 'tidak ada jadwal'}</span>
                </summary>
                <div style="padding:0 12px 8px">${tableHtml}</div>
            </details>`;
    } catch (err) {
        contentEl.innerHTML = `<div class="status-err">Gagal memuat jadwal. ${esc(fe(err))}</div>`;
    }
}

async function loadWeekSchedule(classId) {
    const contentEl = document.getElementById('sched-week-content');
    contentEl.innerHTML = '<p class="hint">Memuat jadwal minggu ini…</p>';
    if (!classId) {
        contentEl.innerHTML = '<p class="hint">Anak belum terdaftar di kelas.</p>';
        return;
    }
    try {
        const results  = await fetchWeekSchedule(classId);
        const todayStr = localDateStr();
        const DAY_NAMES = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'];
        const hasAny = results.some(r => r.rows.length > 0);
        if (!hasAny) {
            contentEl.innerHTML = '<p class="hint">Tidak ada jadwal pelajaran minggu ini.</p>';
            return;
        }
        contentEl.innerHTML = results.map((r, idx) => {
            const label     = `${DAY_NAMES[idx]}, ${new Date(r.date + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}`;
            const isToday   = r.date === todayStr;
            const sesiCount = r.rows.length;
            const tableHtml = sesiCount === 0
                ? '<p class="hint" style="margin:8px 0 4px">Tidak ada jadwal</p>'
                : `<div class="table-wrapper">
                   <table class="table">
                       <thead><tr><th>Jam</th><th>Mata Pelajaran</th><th>Guru</th></tr></thead>
                       <tbody>${r.rows.map(s => `
                           <tr>
                               <td>${s.start?.slice(0,5)} – ${s.end?.slice(0,5)}</td>
                               <td>${esc(s.subject)}</td>
                               <td>${esc(s.teacher)}</td>
                           </tr>`).join('')}
                       </tbody>
                   </table>
                   </div>`;
            return `
                <details class="att-accordion" ${isToday ? 'open' : ''}>
                    <summary class="att-accordion-summary">
                        <span class="att-acc-name">${esc(label)}</span>
                        <span class="att-acc-names">${sesiCount > 0 ? `${sesiCount} sesi` : 'tidak ada jadwal'}</span>
                    </summary>
                    <div style="padding:0 12px 8px">${tableHtml}</div>
                </details>`;
        }).join('');
    } catch (err) {
        contentEl.innerHTML = `<div class="status-err">Gagal memuat jadwal. ${esc(fe(err))}</div>`;
    }
}

async function loadAttendance(studentId) {
    attTbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--color-text-muted)">Memuat...</td></tr>';
    attEmpty.style.display = 'none';

    try {
        const rows = await fetchAttendance(studentId, filterStart.value, filterEnd.value);

        // Card: hitung per blok (satu pertemuan = satu kejadian)
        const counts = { HADIR: 0, ALPA: 0, IZIN: 0, SAKIT: 0 };
        for (const block of rows) {
            if (block.summary_status in counts) counts[block.summary_status]++;
        }

        attSummary.innerHTML = `
            <div class="summary-card card-hadir">
                <span class="count">${counts.HADIR}</span>
                <span class="label">Hadir</span>
            </div>
            <div class="summary-card card-sakit">
                <span class="count">${counts.SAKIT}</span>
                <span class="label">Sakit</span>
            </div>
            <div class="summary-card card-izin">
                <span class="count">${counts.IZIN}</span>
                <span class="label">Izin</span>
            </div>
            <div class="summary-card card-alpha">
                <span class="count">${counts.ALPA}</span>
                <span class="label">Alpa</span>
            </div>
        `;

        if (rows.length === 0) {
            attTbody.innerHTML = '';
            attEmpty.style.display = 'block';
            return;
        }

        const STATUS_BADGE_MAP = {
            HADIR: 'badge-success', IZIN: 'badge-warning',
            SAKIT: 'badge-info',    ALPA: 'badge-danger', CAMPURAN: 'badge-secondary'
        };
        const STATUS_LABEL_MAP = {
            HADIR: 'Hadir', IZIN: 'Izin', SAKIT: 'Sakit', ALPA: 'Alfa', CAMPURAN: 'Campuran'
        };

        attTbody.innerHTML = rows.map(block => `
            <tr class="att-block-row">
                <td>${formatDate(block.date)}</td>
                <td>${esc(block.time_range)}</td>
                <td>${esc(block.subject)}</td>
                <td>${esc(block.teacher)}</td>
                <td><span class="badge ${STATUS_BADGE_MAP[block.summary_status] ?? ''}">
                    ${STATUS_LABEL_MAP[block.summary_status] ?? block.summary_status}
                    <span class="att-slot-count">${block.slots.length} sesi</span>
                </span></td>
                <td>${esc(block.slots[0]?.notes || '—')}</td>
            </tr>`).join('');
    } catch (err) {
        attTbody.innerHTML = `<tr><td colspan="6" class="hint">Gagal memuat data. ${esc(fe(err))}</td></tr>`;
    }
}

function renderObsRows(rows) {
    if (rows.length === 0) {
        obsListEl.innerHTML = '';
        obsEmpty.style.display = 'block';
        return;
    }
    obsEmpty.style.display = 'none';
    obsListEl.innerHTML = rows.map(r => `
        <div class="obs-card obs-${r.sentiment.toLowerCase()}">
            <div class="obs-meta">
                ${esc(r.author)} &middot; ${DIMENSION_LABELS[r.dimension] || r.dimension} &middot; ${formatDate(r.date)}
            </div>
            <p class="obs-content">${esc(r.content)}</p>
        </div>
    `).join('');
}

async function loadPkl(studentId) {
    pklInfo.innerHTML = '<p class="hint">Memuat…</p>';
    pklAttWrap.style.display = 'none';
    try {
        const placement = await fetchPklPlacement(studentId);
        if (!placement) {
            pklInfo.innerHTML = '<p class="hint">Tidak ada data penempatan PKL aktif.</p>';
            return;
        }
        pklInfo.innerHTML = `
            <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 16px;font-size:14px;margin-bottom:4px">
                <span style="color:var(--color-text-muted)">Tempat PKL</span>
                <strong>${esc(placement.dudi_name)}</strong>
                <span style="color:var(--color-text-muted)">Periode</span>
                <span>${formatDate(placement.start_date)} – ${formatDate(placement.end_date)}</span>
            </div>`;

        const rows = await fetchPklAttendanceSummary(studentId);
        pklAttWrap.style.display = 'block';
        const counts = { HADIR: 0, ALPA: 0, IZIN: 0, SAKIT: 0 };
        for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;
        pklSummary.innerHTML = `
            <div class="summary-card card-hadir"><span class="count">${counts.HADIR}</span><span class="label">Hadir</span></div>
            <div class="summary-card card-sakit"><span class="count">${counts.SAKIT}</span><span class="label">Sakit</span></div>
            <div class="summary-card card-izin"><span class="count">${counts.IZIN}</span><span class="label">Izin</span></div>
            <div class="summary-card card-alpha"><span class="count">${counts.ALPA}</span><span class="label">Alpa</span></div>`;
        if (!rows.length) {
            pklTbody.innerHTML = '';
            pklEmpty.style.display = 'block';
            return;
        }
        pklEmpty.style.display = 'none';
        pklTbody.innerHTML = rows.map(r => `
            <tr>
                <td>${formatDate(r.attendance_date)}</td>
                <td><span class="badge ${STATUS_BADGE[r.status] || ''}">${STATUS_LABELS[r.status] || r.status}</span></td>
                <td>${esc(r.notes || '-')}</td>
            </tr>`).join('');
    } catch (err) {
        pklInfo.innerHTML = `<p class="hint">Gagal memuat data PKL. ${esc(fe(err))}</p>`;
    }
}

async function loadObservations(studentId) {
    const dateStart = obsDateStart.value || null;
    const dateEnd   = obsDateEnd.value   || null;
    const cacheKey  = `ortu-obs-${studentId}-${dateStart}-${dateEnd}`;
    const cached    = LC.get(cacheKey);
    if (cached) {
        renderObsRows(cached);
    } else {
        obsListEl.innerHTML = '<p class="hint">Memuat catatan…</p>';
        obsEmpty.style.display = 'none';
    }

    try {
        const rows = await fetchObservations(studentId, dateStart, dateEnd);
        LC.set(cacheKey, rows);
        renderObsRows(rows);
    } catch (err) {
        if (!cached) obsListEl.innerHTML = `<p class="hint">Gagal memuat data. ${esc(fe(err))}</p>`;
    }
}

async function loadLateArrivals(studentId) {
    const hintEl = document.getElementById('late-hint');
    const bodyEl = document.getElementById('late-body');
    if (!hintEl || !bodyEl) return;
    hintEl.style.display = 'block';
    hintEl.textContent = 'Memuat…';
    bodyEl.innerHTML = '';
    try {
        const rows = await getChildLateArrivals(studentId);
        if (!rows.length) {
            hintEl.textContent = 'Belum ada riwayat keterlambatan.';
            return;
        }
        hintEl.style.display = 'none';
        bodyEl.innerHTML = `
            <div style="overflow-x:auto">
                <table class="data-table">
                    <thead><tr><th>Tanggal</th><th>Jam Datang</th><th>Alasan</th></tr></thead>
                    <tbody>${rows.map(r => `
                        <tr>
                            <td>${formatDate(r.date)}</td>
                            <td>${r.arrival_time.slice(0, 5)}</td>
                            <td>${esc(r.reason || '—')}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>`;
    } catch (err) {
        hintEl.textContent = `Gagal memuat data. ${fe(err)}`;
    }
}

async function loadExits(studentId) {
    const hintEl = document.getElementById('exits-hint');
    const bodyEl = document.getElementById('exits-body');
    if (!hintEl || !bodyEl) return;
    hintEl.style.display = 'block';
    hintEl.textContent = 'Memuat…';
    bodyEl.innerHTML = '';
    try {
        const rows = await getChildExits(studentId);
        if (!rows.length) {
            hintEl.textContent = 'Belum ada riwayat izin keluar.';
            return;
        }
        hintEl.style.display = 'none';
        bodyEl.innerHTML = `
            <div style="overflow-x:auto">
                <table class="data-table">
                    <thead><tr><th>Tanggal</th><th>Jam Keluar</th><th>Jam Kembali</th><th>Alasan</th></tr></thead>
                    <tbody>${rows.map(r => `
                        <tr>
                            <td>${formatDate(r.exit_date)}</td>
                            <td>${r.exit_time ? r.exit_time.slice(0, 5) : '—'}</td>
                            <td>${r.return_time ? r.return_time.slice(0, 5) : '—'}</td>
                            <td>${esc(r.reason || '—')}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>`;
    } catch (err) {
        hintEl.textContent = `Gagal memuat data. ${fe(err)}`;
    }
}

function formatDate(d) {
    if (!d) return '-';
    const dt = new Date(d);
    return dt.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function esc(str) {
    const el = document.createElement('span');
    el.textContent = str;
    return el.innerHTML;
}
function fe(err) {
    console.error('[parent]', err);
    const m = String(err?.message ?? '').toLowerCase();
    if (m.includes('jwt') || m.includes('expired')) return 'Sesi habis. Silakan login ulang.';
    if (m.includes('fetch') || m.includes('network') || m.includes('failed to fetch')) return 'Tidak ada koneksi. Periksa jaringan.';
    return 'Gagal memuat data. Silakan coba lagi.';
}

function localDateStr(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

const CASE_STATUS_LABEL = { OPEN: 'Terbuka', CLOSED: 'Selesai' };
const ROLE_LABEL_SHORT  = { GURU: 'Guru', BK: 'BK', WALI_KELAS: 'Wali Kelas', KAPRODI: 'Ka. Prodi', KEPSEK: 'Kepala Sekolah', WAKA_KESISWAAN: 'Waka Kesiswaan', WAKA_HUMAS: 'Waka Humas' };

async function loadCases(studentId) {
    casesListEl.innerHTML = '<p class="hint">Memuat…</p>';
    casesEmpty.style.display = 'none';
    try {
        const cases = await fetchCases(studentId);
        if (!cases.length) {
            casesListEl.innerHTML = '';
            casesEmpty.style.display = 'block';
            return;
        }
        casesListEl.innerHTML = cases.map(c => {
            const isClosed = c.status === 'CLOSED';
            const descHtml = c.description
                ? `<p style="margin:8px 0 0;font-size:0.9rem;color:var(--color-text)">${esc(c.description)}</p>`
                : '';
            const eventsHtml = c.events.length === 0 ? '' : `
                <div style="margin-top:10px;border-top:1px solid var(--color-border,#e5e7eb);padding-top:10px">
                    ${c.events.map(e => `
                        <div style="margin-bottom:8px;font-size:0.85rem">
                            <span style="color:var(--color-text-muted,#6b7280)">${esc(e.author?.full_name ?? '—')} · ${formatDate(e.created_at)}</span>
                            <p style="margin:4px 0 0">${esc(e.payload?.text ?? '')}</p>
                        </div>`).join('')}
                </div>`;
            return `<div style="padding:14px;border:1px solid var(--color-border,#e5e7eb);border-radius:8px;margin-bottom:12px;border-left:3px solid ${isClosed ? '#9ca3af' : '#f59e0b'}">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px">
                    <strong>${esc(c.title)}</strong>
                    <span style="font-size:0.75rem;padding:2px 8px;border-radius:12px;background:${isClosed ? '#e5e7eb' : '#d1fae5'};color:${isClosed ? '#374151' : '#065f46'}">${CASE_STATUS_LABEL[c.status] ?? c.status}</span>
                </div>
                <div style="font-size:0.8rem;color:var(--color-text-muted,#6b7280);margin-top:4px">
                    Ditindaklanjuti oleh: ${esc(c.handler?.full_name ?? '—')} · ${formatDate(c.created_at)}
                </div>
                ${descHtml}
                ${eventsHtml}
            </div>`;
        }).join('');
    } catch (err) {
        casesListEl.innerHTML = `<p class="hint">Gagal memuat data. ${esc(fe(err))}</p>`;
    }
}

function initNotifBell() {
    if (!notifBellBtn) return;
    refreshNotifBadge();
    _notifPollTimer = setInterval(refreshNotifBadge, 60_000);

    notifBellBtn.addEventListener('click', openNotifDropdown);
    document.addEventListener('click', e => {
        if (!e.target.closest('#notif-bell-btn') && !e.target.closest('#notif-dropdown')) {
            if (notifDropdown) notifDropdown.style.display = 'none';
        }
    });
}

async function refreshNotifBadge() {
    try {
        const n = await getUnreadNotifCount();
        let badge = notifBellBtn?.querySelector('.notif-badge-count');
        if (n > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'notif-badge-count';
                badge.style.cssText = 'position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;line-height:18px;border-radius:9px;background:var(--color-danger);color:#fff;font-size:11px;font-weight:700;text-align:center;padding:0 3px;pointer-events:none';
                notifBellBtn.style.position = 'relative';
                notifBellBtn.appendChild(badge);
            }
            badge.textContent = n > 99 ? '99+' : String(n);
        } else {
            badge?.remove();
        }
    } catch { /* tidak kritis */ }
}

async function openNotifDropdown() {
    if (!notifDropdown) return;
    const isOpen = notifDropdown.style.display !== 'none';
    if (isOpen) { notifDropdown.style.display = 'none'; return; }
    notifDropdown.style.display = 'block';
    notifDropdown.innerHTML = '<p style="padding:12px;font-size:13px;color:var(--color-text-muted)">Memuat…</p>';
    try {
        const notifs = await getRecentNotifications(15);
        if (!notifs.length) {
            notifDropdown.innerHTML = '<p style="padding:12px;font-size:13px;color:var(--color-text-muted)">Tidak ada notifikasi baru.</p>';
            return;
        }
        notifDropdown.innerHTML = notifs.map(n => `
            <div class="notif-item" data-id="${n.notification_id}"
                 style="padding:10px 14px;border-bottom:1px solid var(--color-border);cursor:pointer;font-size:13px">
                <div style="font-weight:600;margin-bottom:2px">${esc(n.title)}</div>
                <div style="color:var(--color-text-muted);font-size:12px">${esc(n.body)}</div>
                <div style="color:var(--color-text-muted);font-size:11px;margin-top:3px">${formatDate(n.created_at)}</div>
            </div>`).join('') +
            `<div style="padding:8px 14px;text-align:center">
                <button id="notif-mark-all-btn" class="btn btn-secondary" style="font-size:12px">Tandai semua dibaca</button>
            </div>`;
        notifDropdown.querySelectorAll('.notif-item').forEach(el => {
            el.addEventListener('click', async () => {
                notifDropdown.style.display = 'none';
                await markNotificationsRead([el.dataset.id]).catch(() => {});
                await refreshNotifBadge();
            });
        });
        document.getElementById('notif-mark-all-btn')?.addEventListener('click', async () => {
            const ids = notifs.map(n => n.notification_id);
            await markNotificationsRead(ids).catch(() => {});
            notifDropdown.style.display = 'none';
            notifBellBtn?.querySelector('.notif-badge-count')?.remove();
        });
    } catch {
        notifDropdown.innerHTML = '<p style="padding:12px;font-size:13px;color:var(--color-text-muted)">Gagal memuat notifikasi.</p>';
    }
}

selectChild.addEventListener('change', () => loadChildData(Number(selectChild.value)));

btnObsFilter.addEventListener('click', async () => {
    const idx = Number(selectChild.value);
    const prev = btnObsFilter.textContent;
    btnObsFilter.disabled = true;
    btnObsFilter.textContent = 'Memuat…';
    try {
        await loadObservations(children[idx].student_id);
    } finally {
        btnObsFilter.disabled = false;
        btnObsFilter.textContent = prev;
    }
});

btnFilter.addEventListener('click', async () => {
    const idx = Number(selectChild.value);
    const prev = btnFilter.textContent;
    btnFilter.disabled = true;
    btnFilter.textContent = 'Memuat…';
    try {
        await loadAttendance(children[idx].student_id);
    } finally {
        btnFilter.disabled = false;
        btnFilter.textContent = prev;
    }
});

// Toggle Hari ini / Minggu ini
document.querySelectorAll('.sched-view-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
        document.querySelectorAll('.sched-view-btn').forEach(b => {
            b.classList.remove('active', 'btn-primary');
            b.classList.add('btn-secondary');
        });
        btn.classList.add('active', 'btn-primary');
        btn.classList.remove('btn-secondary');
        const isWeek = btn.dataset.view === 'minggu';
        document.getElementById('sched-view-hari-panel').style.display  = isWeek ? 'none' : 'block';
        document.getElementById('sched-view-minggu-panel').style.display = isWeek ? 'block' : 'none';
        if (isWeek) await loadWeekSchedule(currentClassId);
        else await loadSchedule(currentClassId);
    });
});

logoutBtn.addEventListener('click', async () => {
    LC.clear();
    await logout();
    window.location.replace(getLoginUrl());
});

// ─── Forum Sekolah ────────────────────────────────────────────

let _forumMode      = 'masuk';
let _forumOffset    = 0;
let _forumHasMore   = false;
let _forumInitDone  = false;
let _forumChildren  = [];   // [{ user_id, full_name, class_id, academic_year }]

async function initForumSection() {
    if (_forumInitDone) { await loadForumPosts(); return; }
    _forumInitDone = true;

    // Ambil daftar anak
    try {
        _forumChildren = await getMyChildren();
    } catch (e) {
        document.getElementById('forum-loading').textContent = 'Gagal memuat data anak.';
        return;
    }

    // Isi dropdown anak di modal buat posting
    const childSel = document.getElementById('forum-child-select');
    childSel.innerHTML = _forumChildren.length
        ? _forumChildren.map((c, i) =>
            `<option value="${i}">${esc(c.full_name)}${c.class_name ? ' — ' + esc(c.class_name) : ''}</option>`
          ).join('')
        : '<option value="">Tidak ada anak terdaftar</option>';

    // Sub-tab
    document.getElementById('forum-tab-masuk').addEventListener('click', () => {
        _forumMode = 'masuk'; _forumOffset = 0;
        document.getElementById('forum-tab-masuk').className = 'btn btn-primary';
        document.getElementById('forum-tab-terkirim').className = 'btn btn-secondary';
        loadForumPosts();
    });
    document.getElementById('forum-tab-terkirim').addEventListener('click', () => {
        _forumMode = 'terkirim'; _forumOffset = 0;
        document.getElementById('forum-tab-masuk').className = 'btn btn-secondary';
        document.getElementById('forum-tab-terkirim').className = 'btn btn-primary';
        loadForumPosts();
    });

    // Buat posting
    document.getElementById('btn-forum-buat').addEventListener('click', openForumBuat);
    document.getElementById('btn-forum-buat-batal').addEventListener('click', closeForumBuat);
    document.getElementById('modal-forum-buat').addEventListener('click', e => {
        if (e.target === e.currentTarget) closeForumBuat();
    });
    document.getElementById('btn-forum-buat-kirim').addEventListener('click', submitForumBuat);

    // Modal detail
    document.getElementById('btn-forum-detail-close').addEventListener('click', closeForumDetail);
    document.getElementById('modal-forum-detail').addEventListener('click', e => {
        if (e.target === e.currentTarget) closeForumDetail();
    });

    // Load more
    document.getElementById('btn-load-more-forum').addEventListener('click', () => loadForumPosts(true));

    await loadForumPosts();
}

async function loadForumPosts(loadMore = false) {
    const loadingEl = document.getElementById('forum-loading');
    const listEl    = document.getElementById('forum-posts-list');
    const moreBtn   = document.getElementById('btn-load-more-forum');
    const LIMIT     = 20;

    if (!loadMore) {
        _forumOffset = 0;
        listEl.innerHTML = '';
    }
    loadingEl.style.display = '';
    loadingEl.textContent   = 'Memuat…';
    moreBtn.style.display   = 'none';

    try {
        let posts;
        if (_forumMode === 'masuk') {
            posts = await getForumSekolahPosts(
                currentUser.school_id, currentUser.user_id, LIMIT, _forumOffset);
        } else {
            posts = await getForumSekolahSentPosts(
                currentUser.school_id, currentUser.user_id, LIMIT, _forumOffset);
        }

        loadingEl.style.display = 'none';

        if (!posts.length && _forumOffset === 0) {
            loadingEl.style.display = '';
            loadingEl.textContent   = _forumMode === 'masuk'
                ? 'Belum ada pengumuman untukmu.'
                : 'Belum ada pesan yang dikirim.';
            return;
        }

        posts.forEach(p => listEl.appendChild(renderForumCard(p)));
        _forumOffset += posts.length;
        _forumHasMore = posts.length === LIMIT;
        moreBtn.style.display = _forumHasMore ? '' : 'none';
    } catch (e) {
        loadingEl.style.display = '';
        loadingEl.textContent   = 'Gagal memuat forum.';
    }
}

function renderForumCard(post) {
    const card = document.createElement('div');
    card.className = 'section-card';
    card.style.cssText = 'margin-bottom:12px;cursor:pointer';

    const time    = new Date(post.created_at).toLocaleString('id-ID',
        { dateStyle: 'medium', timeStyle: 'short' });
    const author  = post.author?.full_name
        ? esc(post.author.full_name)
        : _forumMode === 'terkirim' ? 'Anda' : '—';
    const ackCnt  = post.acknowledgements?.length ?? 0;
    const hasFile = !!post.attachment_url;
    const edited  = post.is_edited
        ? '<span class="hint" style="font-size:11px"> (diedit)</span>' : '';
    const bodyText = post.body ?? '';

    card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
            <strong>${esc(post.title ?? '(tanpa judul)')}${edited}</strong>
            <span class="hint" style="white-space:nowrap;font-size:12px">${time}</span>
        </div>
        <p class="hint" style="margin:4px 0 8px">${author}</p>
        <p style="margin:0 0 8px;font-size:14px;white-space:pre-wrap">${
            esc(bodyText).substring(0, 160)}${bodyText.length > 160 ? '…' : ''}</p>
        <div style="display:flex;gap:12px;font-size:12px;color:var(--color-muted)">
            ${hasFile ? '<span>📎 Lampiran</span>' : ''}
            <span>✓ ${ackCnt} dibaca</span>
        </div>`;

    card.addEventListener('click', () => openForumDetail(post));
    return card;
}

async function openForumDetail(post) {
    const modal = document.getElementById('modal-forum-detail');
    modal.style.display = 'flex';

    document.getElementById('detail-forum-title').textContent = post.title ?? '(tanpa judul)';
    document.getElementById('detail-forum-body').textContent  = post.body ?? '';

    const time   = new Date(post.created_at).toLocaleString('id-ID',
        { dateStyle: 'long', timeStyle: 'short' });
    const author = post.author?.full_name
        ? post.author.full_name
        : _forumMode === 'terkirim' ? 'Anda' : '—';
    const edited = post.is_edited ? ' • diedit' : '';
    document.getElementById('detail-forum-meta').textContent =
        `${author} · ${time}${edited}`;

    const attEl = document.getElementById('detail-forum-attachment');
    if (post.attachment_url || post.attachment_path) {
        let attachmentHref = post.attachment_url ?? null;
        if (post.attachment_path) {
            const { data: signed } = await supabase.storage
                .from('forum-attachments')
                .createSignedUrl(post.attachment_path, 172800);
            if (signed?.signedUrl) attachmentHref = signed.signedUrl;
        }
        attEl.innerHTML = `<a href="${esc(attachmentHref)}" target="_blank"
              class="btn btn-secondary" style="font-size:13px">
              📎 ${esc(post.attachment_name ?? 'Unduh Lampiran')}</a>`;
    } else {
        attEl.innerHTML = '';
    }

    // Acknowledge otomatis saat dibuka (hanya untuk inbox)
    if (_forumMode === 'masuk') {
        addForumSekolahAck(post.post_id, currentUser.user_id, currentUser.school_id)
            .catch(() => {});
    }
}

function closeForumDetail() {
    document.getElementById('modal-forum-detail').style.display = 'none';
}

// ─── Modal Buat Posting ────────────────────────────────────────

function openForumBuat() {
    document.getElementById('forum-input-title').value = '';
    document.getElementById('forum-input-body').value  = '';
    document.getElementById('forum-buat-error').style.display = 'none';
    document.getElementById('modal-forum-buat').style.display = 'flex';
}

function closeForumBuat() {
    document.getElementById('modal-forum-buat').style.display = 'none';
}

async function submitForumBuat() {
    const errEl   = document.getElementById('forum-buat-error');
    const btnEl   = document.getElementById('btn-forum-buat-kirim');
    const title   = document.getElementById('forum-input-title').value.trim();
    const body    = document.getElementById('forum-input-body').value.trim();
    const childIdx = parseInt(document.getElementById('forum-child-select').value, 10);

    errEl.style.display = 'none';

    if (!title) {
        errEl.textContent = 'Judul wajib diisi.';
        errEl.style.display = 'block'; return;
    }
    if (!body) {
        errEl.textContent = 'Isi pesan wajib diisi.';
        errEl.style.display = 'block'; return;
    }
    if (isNaN(childIdx) || !_forumChildren[childIdx]) {
        errEl.textContent = 'Pilih anak terlebih dahulu.';
        errEl.style.display = 'block'; return;
    }

    const child = _forumChildren[childIdx];

    btnEl.disabled = true;
    btnEl.textContent = 'Mengirim…';

    try {
        await createParentForumPost(
            title, body,
            child.class_id,
            child.academic_year,
            currentUser.school_id
        );
        closeForumBuat();
        _forumMode = 'terkirim';
        document.getElementById('forum-tab-masuk').className    = 'btn btn-secondary';
        document.getElementById('forum-tab-terkirim').className = 'btn btn-primary';
        _forumOffset = 0;
        loadForumPosts();
    } catch (err) {
        errEl.textContent = err.message ?? 'Gagal mengirim pesan.';
        errEl.style.display = 'block';
    } finally {
        btnEl.disabled = false;
        btnEl.textContent = 'Kirim';
    }
}

function fmtRelative(isoStr) {
    if (!isoStr) return '';
    const diff = Date.now() - new Date(isoStr).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1)  return 'baru saja';
    if (m < 60) return `${m} mnt lalu`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} jam lalu`;
    return formatDate(isoStr);
}

// ── Tab Nilai (ortu) ──
let _nilaiStudentId = null;

async function initNilaiTab(studentId) {
    // Populate tahun ajaran hanya sekali
    const selYear = document.getElementById('nilai-year-select');
    if (!selYear.dataset.populated) {
        selYear.dataset.populated = '1';
        const { data: cfg } = await supabase.from('school_config')
            .select('current_academic_year').single();
        const activeYear    = cfg?.current_academic_year ?? null;
        const activeStartYr = activeYear ? parseInt(activeYear) : new Date().getFullYear();
        [activeStartYr - 1, activeStartYr, activeStartYr + 1].forEach(y => {
            const opt = document.createElement('option');
            opt.value = `${y}/${y + 1}`;
            opt.textContent = `${y}/${y + 1}`;
            if (`${y}/${y + 1}` === activeYear) opt.selected = true;
            selYear.appendChild(opt);
        });
        selYear.addEventListener('change', () => loadNilaiGrid(_nilaiStudentId));
        document.getElementById('nilai-semester-select')
            .addEventListener('change', () => loadNilaiGrid(_nilaiStudentId));
    }
    _nilaiStudentId = studentId;
    await loadNilaiGrid(studentId);
}

async function loadNilaiGrid(studentId) {
    const gridEl = document.getElementById('nilai-grid');
    const year   = document.getElementById('nilai-year-select').value || null;
    const semStr = document.getElementById('nilai-semester-select').value;
    const sem    = semStr ? parseInt(semStr) : null;
    if (!studentId) {
        gridEl.innerHTML = '<p class="hint">Pilih anak terlebih dahulu.</p>';
        return;
    }
    gridEl.innerHTML = '<p class="hint">Memuat…</p>';
    try {
        const { data, error } = await supabase.rpc('fn_get_all_grades_summary', {
            p_student_id:    studentId,
            p_academic_year: year,
            p_semester:      sem
        });
        if (error) throw error;
        if (!data?.success) throw new Error(data?.error || 'Gagal memuat nilai');
        renderNilaiGrid(data.grades || [], gridEl);
    } catch (e) {
        gridEl.innerHTML =
            `<p class="hint" style="color:var(--color-danger)">Gagal memuat nilai: ${esc(e.message)}</p>`;
    }
}

function renderNilaiGrid(grades, gridEl) {
    if (!grades.length) {
        gridEl.innerHTML = '<p class="hint">Belum ada nilai yang dipublikasi.</p>';
        return;
    }
    const bySem = {};
    grades.forEach(g => {
        const key = `${g.academic_year} Sem ${g.semester}`;
        if (!bySem[key]) bySem[key] = [];
        bySem[key].push(g);
    });
    gridEl.innerHTML = Object.entries(bySem).map(([label, items]) => `
        <div style="margin-bottom:24px">
          <h4 style="margin:0 0 8px; color:var(--color-text-muted); font-size:13px;
                     text-transform:uppercase; letter-spacing:0.5px">${esc(label)}</h4>
          <table style="width:100%; border-collapse:collapse; font-size:13px">
            <thead>
              <tr style="border-bottom:2px solid var(--color-border)">
                <th style="text-align:left; padding:8px 4px">Mata Pelajaran</th>
                <th style="text-align:center; padding:8px 4px; width:80px">Nilai</th>
                <th style="text-align:center; padding:8px 4px; width:80px">Predikat</th>
                <th style="text-align:left; padding:8px 4px">Deskripsi</th>
              </tr>
            </thead>
            <tbody>
              ${items.map(g => `
                <tr style="border-bottom:1px solid var(--color-border)">
                  <td style="padding:8px 4px">${esc(g.subject_name || '—')}</td>
                  <td style="padding:8px 4px; text-align:center; font-weight:600">
                    ${g.nilai_akhir != null ? Number(g.nilai_akhir).toFixed(1) : '—'}
                  </td>
                  <td style="padding:8px 4px; text-align:center">${esc(g.predikat || '—')}</td>
                  <td style="padding:8px 4px; color:var(--color-text-muted); font-size:12px">
                    ${esc(g.deskripsi_naratif || '—')}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
    `).join('');
}

init().catch(err => {
    console.error('[init]', err);
    const el = document.getElementById('loading');
    if (el) {
        el.textContent = 'Gagal memuat. Silakan refresh halaman.';
        el.style.color = 'red';
    }
});
