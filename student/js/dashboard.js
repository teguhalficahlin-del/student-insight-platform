/**
 * @file student/js/dashboard.js
 * Dashboard Portal Siswa — jadwal, kehadiran diri, observasi, status PKL.
 */

import { applyBrandingById, getLoginUrl } from '../../shared/branding.js';
import { checkMustChangePassword } from '../../shared/change-password.js';
import { initLoginGuard, registerLoginDevice } from '../../shared/login-guard.js';
import {
    supabase, logout, getCurrentUserRow, STUDENT_ROLES, ACTIVE_STUDENT_STATUSES,
    getMyStudent, getSchoolConfig, getMyClass,
    getScheduleForDate, getMyAttendance, getMyObservations,
    getMyPklPlacement, getMyPklAttendance,
    getMyCases,
    getUnreadNotifCount, getRecentNotifications, markNotificationsRead,
    getMyForumClass, getForumPosts, addForumAck,
    getMyAchievements,
} from './api.js';

// ─── State ───────────────────────────────────────────────────
let currentUser = null;
let student     = null;   // baris students milik user
let config      = null;   // { current_academic_year, current_semester }
let myClass     = null;   // enrollment + class
let obsLoaded   = false;
let pklLoaded   = false;

const DIMENSION_LABELS = { AKADEMIK:'Akademik', KEHADIRAN:'Kehadiran', PERILAKU:'Perilaku', SOSIAL:'Sosial', AFEKTIF:'Afektif', BAKAT_MINAT:'Bakat & Minat', FISIK:'Fisik', LAINNYA:'Lainnya' };
// EKSKUL dihapus dari absensi → dipetakan ke Hadir (kompat data lama)
const STATUS_LABELS    = { HADIR:'Hadir', IZIN:'Izin', SAKIT:'Sakit', ALPA:'Alpa', EKSKUL:'Hadir' };
const STATUS_BADGE     = { HADIR:'badge-hadir', IZIN:'badge-izin', SAKIT:'badge-sakit', ALPA:'badge-tidak-hadir', EKSKUL:'badge-hadir' };

// ─── Read cache (LF-2) ───────────────────────────────────────
const LC = {
    set(key, data) {
        try { localStorage.setItem(`smkhr:${key}`, JSON.stringify({ ts: Date.now(), data })); } catch {}
    },
    get(key, ttlMs = 60 * 60 * 1000) {
        try { const r = JSON.parse(localStorage.getItem(`smkhr:${key}`)); if (!r) return null; if (Date.now() - r.ts > ttlMs) return null; return r.data ?? null; }
        catch { return null; }
    },
    clear() {
        try { Object.keys(localStorage).filter(k => k.startsWith('smkhr:')).forEach(k => localStorage.removeItem(k)); }
        catch {}
    },
};

function esc(s) {
    const el = document.createElement('span');
    el.textContent = s ?? '';
    return el.innerHTML;
}
function fe(err) {
    console.error('[student]', err);
    const m = String(err?.message ?? '').toLowerCase();
    if (m.includes('jwt') || m.includes('expired')) return 'Sesi habis. Silakan login ulang.';
    if (m.includes('fetch') || m.includes('network') || m.includes('failed to fetch')) return 'Tidak ada koneksi. Periksa jaringan.';
    return 'Gagal memuat data. Silakan coba lagi.';
}
function fmt(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('id-ID', { day:'numeric', month:'short', year:'numeric' });
}
function fmtTime(t) { return t ? t.slice(0, 5) : '—'; }

// ─── Boot ────────────────────────────────────────────────────
async function init() {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) { window.location.replace(getLoginUrl()); return; }

    currentUser = await getCurrentUserRow(auth.user);
    if (!currentUser || !STUDENT_ROLES.includes(currentUser.role_type)) {
        await supabase.auth.signOut();
        window.location.replace(getLoginUrl());
        return;
    }

    registerLoginDevice(supabase); // fire-and-forget
    await Promise.all([
        applyBrandingById(currentUser.school_id, supabase),
        checkMustChangePassword(supabase, currentUser),
        initLoginGuard(supabase, currentUser),
        getSchoolConfig().then(c => { config = c; }),
        getMyStudent(currentUser.user_id).then(s => { student = s; }),
    ]);

    if (!student) {
        // Akun SISWA belum tertaut ke data siswa
        document.getElementById('loading').textContent =
            'Akun ini belum tertaut ke data siswa. Hubungi admin sekolah.';
        return;
    }

    // Alumni (LULUS) / mutasi (KELUAR) tidak boleh lagi mengakses portal
    if (!ACTIVE_STUDENT_STATUSES.includes(student.student_status)) {
        await logout();
        window.location.replace(getLoginUrl());
        return;
    }

    myClass = await getMyClass(student.student_id, config.current_academic_year).catch(() => null);

    // Header
    document.getElementById('hdr-name').textContent = student.full_name;
    document.getElementById('hdr-meta').textContent =
        `NIS ${student.nis} · ${myClass?.class?.name ?? student.program?.name ?? 'Siswa'}`;
    const STATUS_HDR_LABEL = { AKTIF: 'Aktif', PKL: 'Sedang PKL' };
    const STATUS_HDR_CLASS = { AKTIF: 'badge-status-aktif', PKL: 'badge-status-pkl' };
    const badgeEl = document.getElementById('hdr-status-badge');
    if (badgeEl && student.student_status) {
        badgeEl.textContent = STATUS_HDR_LABEL[student.student_status] ?? student.student_status;
        badgeEl.className   = `child-status-badge ${STATUS_HDR_CLASS[student.student_status] ?? ''}`;
        badgeEl.style.display = 'inline-block';
    }

    const tabs = buildTabs();
    document.getElementById('loading').style.display = 'none';
    document.getElementById('app').style.display     = 'block';
    initNotifBell();

    // Default ke tab pertama yang tersedia (Jadwal disembunyikan saat PKL).
    const firstTab = tabs[0]?.key ?? 'kehadiran';
    activateTab(firstTab);
    await initTab(firstTab);
}

// ─── Tab navigation ──────────────────────────────────────────
const TAB_SHORT = { jadwal: 'Jadwal', kehadiran: 'Hadir', observasi: 'Catatan', pkl: 'PKL' };
const TAB_ICON  = { jadwal: 'ti-calendar', kehadiran: 'ti-clipboard-check', observasi: 'ti-notes', pkl: 'ti-briefcase', forum: 'ti-messages' };

function buildTabs() {
    const nav    = document.getElementById('tab-nav');
    const botNav = document.getElementById('bottom-nav');
    const isPkl  = student.student_status === 'PKL';
    const tabs   = [];
    if (!isPkl) tabs.push({ key: 'jadwal', label: 'Jadwal' });
    tabs.push({ key: 'kehadiran', label: 'Kehadiran' });
    tabs.push({ key: 'observasi', label: 'Catatan' });
    tabs.push({ key: 'forum', label: 'Forum' });
    if (isPkl)  tabs.push({ key: 'pkl', label: 'PKL' });

    nav.innerHTML = tabs.map(t =>
        `<button class="tab-btn" data-tab="${t.key}">${esc(t.label)}</button>`
    ).join('');
    botNav.innerHTML = `<div class="bottom-nav-inner">${
        tabs.map(t => {
            const icon = TAB_ICON[t.key] ?? 'ti-circle';
            return `<button class="tab-btn" data-tab="${t.key}"><i class="ti ${icon} nav-icon" aria-hidden="true"></i>${esc(TAB_SHORT[t.key] ?? t.label)}</button>`;
        }).join('')
    }</div>`;

    const handler = async (e) => {
        const key = e.target.closest('[data-tab]')?.dataset?.tab;
        if (!key) return;
        activateTab(key);
        await loadTabContent(key);
    };
    nav.addEventListener('click', handler);
    botNav.addEventListener('click', handler);

    return tabs;
}

function activateTab(key) {
    document.querySelectorAll('.tab-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.tab === key));
    document.querySelectorAll('.tab-panel').forEach(p =>
        p.classList.toggle('active', p.id === `tab-${key}`));
}

async function loadTabContent(key) {
    switch (key) {
        case 'jadwal':    await loadSchedule(); break;       // muat ulang tanggal aktif
        case 'kehadiran': await loadAttendance(); break;
        case 'observasi': if (!obsLoaded) await loadObservations(); break;
        case 'pkl':       if (!pklLoaded) await loadPkl(); break;
        case 'forum':     await initForumTab(); break;
    }
}

// Inisialisasi tab default saat boot (jadwal perlu wiring listener tanggal dulu).
async function initTab(key) {
    if (key === 'jadwal') return initJadwalTab();
    if (key === 'forum')  return initForumTab();
    return loadTabContent(key);
}

// ─── TAB JADWAL ──────────────────────────────────────────────

async function initJadwalTab() {
    const dateEl = document.getElementById('sched-date');
    if (!dateEl.value) dateEl.value = localDateStr();

    document.querySelectorAll('.sched-view-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            document.querySelectorAll('.sched-view-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const isWeek = btn.dataset.view === 'minggu';
            document.getElementById('sched-view-hari-panel').style.display  = isWeek ? 'none' : 'block';
            document.getElementById('sched-view-minggu-panel').style.display = isWeek ? 'block' : 'none';
            if (isWeek) await loadWeekSchedule();
            else await loadSchedule();
        });
    });

    await loadSchedule();
}

function localDateStr(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function fmtDayLabel(dateStr) {
    if (!dateStr) return '';
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function renderScheduleRows(rows, contentEl, date) {
    const today     = localDateStr();
    const isToday   = date === today;
    const label     = fmtDayLabel(date);
    const sesiCount = rows.length;

    const tableHtml = sesiCount === 0
        ? '<p class="hint" style="margin:8px 0 4px">Tidak ada jadwal pada tanggal ini.</p>'
        : `<div class="table-wrapper">
           <table class="table">
               <thead><tr><th>Jam</th><th>Mata Pelajaran</th><th>Guru</th></tr></thead>
               <tbody>
               ${rows.map(r => `
                   <tr>
                       <td>${fmtTime(r.session_start)} – ${fmtTime(r.session_end)}</td>
                       <td>${esc(r.subject?.name ?? '—')}</td>
                       <td>${esc(r.teacher?.full_name ?? '—')}</td>
                   </tr>
               `).join('')}
               </tbody>
           </table>
           </div>`;

    contentEl.innerHTML = `
        <details class="att-accordion" ${isToday || sesiCount > 0 ? 'open' : ''}>
            <summary class="att-accordion-summary">
                <span class="att-acc-name">${esc(label)}</span>
                <span class="att-acc-names">${sesiCount > 0 ? `${sesiCount} sesi` : 'tidak ada jadwal'}</span>
            </summary>
            <div style="padding:0 12px 8px">${tableHtml}</div>
        </details>`;
}

async function loadSchedule() {
    const date      = document.getElementById('sched-date').value;
    const contentEl = document.getElementById('sched-content');

    if (!myClass?.class_id) {
        contentEl.innerHTML = '<p class="hint">Data kelas belum tersedia untuk tahun ajaran ini. Hubungi admin sekolah.</p>';
        return;
    }

    const cacheKey = `stu-sched-${student.student_id}-${date}`;
    const cached   = LC.get(cacheKey);
    if (cached) {
        renderScheduleRows(cached, contentEl, date);
    } else {
        contentEl.innerHTML = '<p class="hint">Memuat jadwal…</p>';
    }

    try {
        const rows = await getScheduleForDate(myClass.class_id, date);
        LC.set(cacheKey, rows);
        renderScheduleRows(rows, contentEl, date);
    } catch (err) {
        if (!cached) {
            contentEl.innerHTML = `<div class="status-err">Gagal memuat data. ${esc(fe(err))}</div>`;
        }
    }
}

async function loadWeekSchedule() {
    const contentEl = document.getElementById('sched-week-content');
    contentEl.innerHTML = '<p class="hint">Memuat jadwal minggu ini…</p>';

    if (!myClass?.class_id) {
        contentEl.innerHTML = '<p class="hint">Data kelas belum tersedia. Hubungi admin sekolah.</p>';
        return;
    }

    const today  = new Date();
    const dow    = today.getDay();
    const diff   = dow === 0 ? -6 : 1 - dow;
    const monday = new Date(today);
    monday.setDate(today.getDate() + diff);

    const days = Array.from({ length: 5 }, (_, i) => {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        return localDateStr(d);
    });

    try {
        const results = await Promise.all(
            days.map(d => getScheduleForDate(myClass.class_id, d)
                .then(rows => ({ date: d, rows }))
                .catch(() => ({ date: d, rows: [] }))
            )
        );

        const hasAny = results.some(r => r.rows.length > 0);
        if (!hasAny) {
            contentEl.innerHTML = '<p class="hint">Tidak ada jadwal pelajaran minggu ini.</p>';
            return;
        }

        const DAY_NAMES = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'];
        const todayStr  = localDateStr();
        contentEl.innerHTML = results.map((r, idx) => {
            const dayLabel  = `${DAY_NAMES[idx]}, ${fmtDayLabel(r.date).split(',')[1]?.trim() ?? r.date}`;
            const isToday   = r.date === todayStr;
            const sesiCount = r.rows.length;

            const tableHtml = sesiCount === 0
                ? '<p class="hint" style="margin:8px 0 4px">Tidak ada jadwal</p>'
                : `<div class="table-wrapper">
                   <table class="table">
                       <thead><tr><th>Jam</th><th>Mata Pelajaran</th><th>Guru</th></tr></thead>
                       <tbody>${r.rows.map(s => `
                           <tr>
                               <td>${fmtTime(s.session_start)} – ${fmtTime(s.session_end)}</td>
                               <td>${esc(s.subject?.name ?? '—')}</td>
                               <td>${esc(s.teacher?.full_name ?? '—')}</td>
                           </tr>`).join('')}
                       </tbody>
                   </table>
                   </div>`;

            return `
                <details class="att-accordion" ${isToday || sesiCount > 0 ? 'open' : ''}>
                    <summary class="att-accordion-summary">
                        <span class="att-acc-name">${esc(dayLabel)}</span>
                        <span class="att-acc-names">${sesiCount > 0 ? `${sesiCount} sesi` : 'tidak ada jadwal'}</span>
                    </summary>
                    <div style="padding:0 12px 8px">${tableHtml}</div>
                </details>`;
        }).join('');

    } catch (err) {
        contentEl.innerHTML = `<div class="status-err">Gagal memuat. ${esc(fe(err))}</div>`;
    }
}

// ─── TAB KEHADIRAN ───────────────────────────────────────────

let attInit = false;
async function loadAttendance() {
    if (!attInit) {
        const today    = localDateStr();
        const monthAgo = localDateStr(new Date(Date.now() - 30 * 86400000));
        document.getElementById('att-date-start').value = monthAgo;
        document.getElementById('att-date-end').value   = today;
        document.getElementById('att-filter-btn').onclick = loadAttendance;
        attInit = true;
    }

    const filterBtn = document.getElementById('att-filter-btn');
    const prevLabel = filterBtn?.textContent;
    if (filterBtn) { filterBtn.disabled = true; filterBtn.textContent = 'Memuat…'; }

    const start   = document.getElementById('att-date-start').value;
    const end     = document.getElementById('att-date-end').value;
    const tbody   = document.getElementById('att-body');
    const emptyEl = document.getElementById('att-empty');
    tbody.innerHTML = '<tr><td colspan="5" class="hint">Memuat…</td></tr>';
    emptyEl.style.display = 'none';

    try {
        const rows = await getMyAttendance(student.student_id, start, end);
        const agg = { HADIR:0, IZIN:0, SAKIT:0, ALPA:0, total:0 };
        for (const block of rows) {
            for (const s of (block.slots ?? [])) {
                if (agg[s.status] !== undefined) agg[s.status]++;
                agg.total++;
            }
        }
        const pct = agg.total > 0 ? Math.round(agg.HADIR / agg.total * 100) : 0;
        document.getElementById('att-hadir').textContent = agg.HADIR;
        document.getElementById('att-izin').textContent  = agg.IZIN;
        document.getElementById('att-sakit').textContent = agg.SAKIT;
        document.getElementById('att-alpha').textContent = agg.ALPA;
        document.getElementById('att-pct').textContent   = agg.total > 0 ? pct + '%' : '—';

        if (rows.length === 0) {
            tbody.innerHTML = '';
            emptyEl.style.display = 'block';
            return;
        }
        const STATUS_BADGE_MAP = {
            HADIR: 'badge-success', IZIN: 'badge-warning',
            SAKIT: 'badge-info',    ALPA: 'badge-danger', CAMPURAN: 'badge-secondary'
        };
        const STATUS_LABEL_MAP = {
            HADIR: 'Hadir', IZIN: 'Izin', SAKIT: 'Sakit', ALPA: 'Alfa', CAMPURAN: 'Campuran'
        };

        tbody.innerHTML = rows.map(block => {
            const multiSlot = block.slots.length > 1;
            const detailRows = multiSlot ? block.slots.map(s => `
                <tr class="att-slot-detail" style="display:none">
                    <td></td>
                    <td style="color:var(--color-text-muted);font-size:.85em">
                        ${s.start} – ${s.end}
                    </td>
                    <td></td>
                    <td><span class="badge ${STATUS_BADGE_MAP[s.status] ?? ''}">
                        ${STATUS_LABEL_MAP[s.status] ?? s.status}
                    </span></td>
                    <td>${esc(s.notes || '—')}</td>
                </tr>`).join('') : '';

            return `
                <tr class="att-block-row ${multiSlot ? 'att-block-expandable' : ''}"
                    ${multiSlot ? `onclick="this.classList.toggle('att-block-open');
                        let n=this.nextElementSibling;
                        while(n&&n.classList.contains('att-slot-detail')){
                            n.style.display=n.style.display==='none'?'':'none';n=n.nextElementSibling;
                        }"` : ''}>
                    <td>${fmt(block.date)}</td>
                    <td>${esc(block.time_range)}</td>
                    <td>${esc(block.subject)}</td>
                    <td>${esc(block.teacher)}</td>
                    <td><span class="badge ${STATUS_BADGE_MAP[block.summary_status] ?? ''}">
                        ${STATUS_LABEL_MAP[block.summary_status] ?? block.summary_status}
                        ${multiSlot ? `<span class="att-slot-count">${block.slots.length} sesi</span>` : ''}
                    </span></td>
                </tr>
                ${detailRows}`;
        }).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="5" style="color:var(--color-danger)">${esc(fe(err))}</td></tr>`;
    } finally {
        if (filterBtn) { filterBtn.disabled = false; filterBtn.textContent = prevLabel; }
    }
}

// ─── TAB OBSERVASI ───────────────────────────────────────────

function renderObservations(rows, hintEl, listEl) {
    if (rows.length === 0) {
        hintEl.style.display = 'block';
        hintEl.textContent   = 'Belum ada catatan dari guru untukmu.';
        listEl.innerHTML     = '';
        return;
    }
    const SENTIMENT_LABELS = { POSITIF: 'Positif', NEGATIF: 'Negatif', NETRAL: 'Netral' };
    hintEl.style.display = 'none';
    listEl.innerHTML = rows.map(r => `
        <div class="obs-card obs-${(r.sentiment ?? '').toLowerCase()}">
            <div class="obs-meta">
                ${esc(DIMENSION_LABELS[r.dimension] ?? r.dimension)}
                &middot; <span>${esc(SENTIMENT_LABELS[r.sentiment] ?? r.sentiment ?? '—')}</span>
                &middot; oleh ${esc(r.author?.full_name ?? '—')}
                &middot; ${fmt(r.observed_at ?? r.created_at)}
            </div>
            <p class="obs-content">${esc(r.content)}</p>
        </div>`).join('') + (rows.length >= 100 ? '<p class="hint" style="margin-top:12px">Menampilkan 100 catatan terbaru.</p>' : '');
}

let obsFilterInit = false;

async function loadObservations() {
    const hintEl      = document.getElementById('obs-hint');
    const listEl      = document.getElementById('obs-list');
    const casesHintEl = document.getElementById('cases-hint');

    if (!obsFilterInit) {
        const today    = localDateStr();
        const monthAgo = localDateStr(new Date(Date.now() - 30 * 86400000));
        document.getElementById('obs-date-start').value = monthAgo;
        document.getElementById('obs-date-end').value   = today;
        const filterBtn = document.getElementById('obs-filter-btn');
        filterBtn.addEventListener('click', async () => {
            const prev = filterBtn.textContent;
            filterBtn.disabled = true;
            filterBtn.textContent = 'Memuat…';
            try { await loadObsOnly(); }
            finally { filterBtn.disabled = false; filterBtn.textContent = prev; }
        });
        obsFilterInit = true;
    }

    const dateStart   = document.getElementById('obs-date-start').value || null;
    const dateEnd     = document.getElementById('obs-date-end').value   || null;
    const cacheKey    = `stu-obs-${student.student_id}-${dateStart}-${dateEnd}`;

    const cached = LC.get(cacheKey);
    if (cached) {
        renderObservations(cached, hintEl, listEl);
    } else {
        hintEl.style.display = 'block';
        hintEl.textContent   = 'Memuat catatan…';
        listEl.innerHTML     = '';
    }
    casesHintEl.textContent   = 'Memuat…';
    casesHintEl.style.display = 'block';
    document.getElementById('cases-list').innerHTML = '';

    const [obsResult, casesResult, achResult] = await Promise.allSettled([
        getMyObservations(student.student_id, dateStart, dateEnd),
        getMyCases(student.student_id),
        getMyAchievements(student.student_id),
    ]);

    if (obsResult.status === 'fulfilled') {
        obsLoaded = true;
        LC.set(cacheKey, obsResult.value);
        renderObservations(obsResult.value, hintEl, listEl);
    } else if (!cached) {
        hintEl.textContent = `Gagal memuat catatan. ${fe(obsResult.reason)}`;
    }

    if (casesResult.status === 'fulfilled') {
        renderCases(casesResult.value);
    } else {
        casesHintEl.textContent = `Gagal memuat data kasus. ${fe(casesResult.reason)}`;
    }

    renderAchievements(achResult.status === 'fulfilled' ? achResult.value : []);
}

const ACH_CATEGORY_LABEL = { AKADEMIK: 'Akademik', NON_AKADEMIK: 'Non-Akademik', SERTIFIKASI: 'Sertifikasi', PENGHARGAAN: 'Penghargaan' };
const ACH_SCOPE_LABEL    = { SEKOLAH: 'Sekolah', KABUPATEN: 'Kab/Kota', PROVINSI: 'Provinsi', NASIONAL: 'Nasional', INTERNASIONAL: 'Internasional' };

function renderAchievements(rows) {
    const hintEl = document.getElementById('ach-hint');
    const listEl = document.getElementById('ach-list');
    if (!hintEl || !listEl) return;
    if (!rows.length) {
        hintEl.textContent   = 'Belum ada prestasi yang tercatat.';
        hintEl.style.display = 'block';
        listEl.innerHTML     = '';
        return;
    }
    hintEl.style.display = 'none';
    listEl.innerHTML = rows.map(r => `
        <div class="obs-card" style="border-left:3px solid var(--color-primary)">
            <div class="obs-meta">
                <strong>${esc(r.title)}</strong>
                &middot; <span class="badge badge-neutral">${ACH_CATEGORY_LABEL[r.category] ?? r.category}</span>
                &middot; <span class="badge badge-neutral">${ACH_SCOPE_LABEL[r.scope] ?? r.scope}</span>
                &middot; ${fmt(r.achieved_at)}
                &middot; dicatat oleh ${esc(r.recorded_by_name ?? '—')}
            </div>
            ${r.description ? `<p class="obs-content" style="margin-top:4px">${esc(r.description)}</p>` : ''}
        </div>`).join('');
}

async function loadObsOnly() {
    const hintEl  = document.getElementById('obs-hint');
    const listEl  = document.getElementById('obs-list');
    const dateStart = document.getElementById('obs-date-start').value || null;
    const dateEnd   = document.getElementById('obs-date-end').value   || null;
    const cacheKey  = `stu-obs-${student.student_id}-${dateStart}-${dateEnd}`;
    hintEl.style.display = 'block';
    hintEl.textContent   = 'Memuat catatan…';
    listEl.innerHTML     = '';
    try {
        const rows = await getMyObservations(student.student_id, dateStart, dateEnd);
        LC.set(cacheKey, rows);
        renderObservations(rows, hintEl, listEl);
    } catch (err) {
        hintEl.style.display = 'block';
        hintEl.textContent   = `Gagal memuat catatan. ${fe(err)}`;
    }
}

const CASE_STATUS_LABEL = { OPEN: 'Terbuka', CLOSED: 'Selesai' };
const ROLE_LABEL_SHORT  = { GURU: 'Guru', BK: 'BK', WALI_KELAS: 'Wali Kelas', KAPRODI: 'Ka. Prodi', KEPSEK: 'Kepala Sekolah', WAKA_KESISWAAN: 'Waka Kesiswaan', WAKA_HUMAS: 'Waka Humas' };

function renderCases(cases) {
    const card = document.getElementById('cases-card');
    const listEl = document.getElementById('cases-list');
    const hintEl = document.getElementById('cases-hint');
    if (!card) return;

    if (!cases.length) {
        hintEl.style.display = 'block';
        hintEl.textContent = 'Belum ada kasus yang dibagikan untukmu.';
        listEl.innerHTML = '';
        return;
    }
    hintEl.style.display = 'none';
    listEl.innerHTML = cases.map(c => {
        const statusLabel = CASE_STATUS_LABEL[c.status] ?? c.status;
        const isClosed    = c.status === 'CLOSED';
        const eventsHtml  = c.events.length === 0 ? '' : `
            <div style="margin-top:10px;border-top:1px solid var(--color-border,#2d3748);padding-top:10px">
                ${c.events.map(e => `
                    <div style="margin-bottom:8px;font-size:0.85rem">
                        <span style="color:var(--color-text-muted,#9ca3af)">${esc(e.author?.full_name ?? '—')} · ${fmt(e.created_at)}</span>
                        <p style="margin:4px 0 0">${esc(e.payload)}</p>
                    </div>`).join('')}
            </div>`;
        const descHtml = c.description
            ? `<p style="margin:8px 0 0;font-size:0.9rem;color:var(--color-text)">${esc(c.description)}</p>`
            : '';
        return `<div class="obs-card" style="border-left:3px solid ${isClosed ? 'var(--color-text-muted,#6b7280)' : 'var(--color-warning,#f59e0b)'}">
            <div class="obs-meta" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px">
                <strong>${esc(c.title)}</strong>
                <span class="badge ${isClosed ? 'badge-izin' : 'badge-hadir'}" style="font-size:0.75rem">${statusLabel}</span>
            </div>
            <div style="font-size:0.8rem;color:var(--color-text-muted,#9ca3af);margin-top:4px">
                Ditindaklanjuti oleh: ${esc(ROLE_LABEL_SHORT[c.current_handler_role] ?? c.current_handler_role ?? '—')} · ${fmt(c.created_at)}
            </div>
            ${descHtml}
            ${eventsHtml}
        </div>`;
    }).join('');
}

// ─── TAB PKL ─────────────────────────────────────────────────

async function loadPkl() {
    const infoEl    = document.getElementById('pkl-info');
    const statsEl   = document.getElementById('pkl-stats');
    const recapCard = document.getElementById('pkl-recap-card');
    const recapBody = document.getElementById('pkl-recap-body');
    infoEl.innerHTML = '<p class="hint">Memuat…</p>';

    try {
        const placement = await getMyPklPlacement(student.student_id);
        pklLoaded = true;

        if (!placement) {
            infoEl.innerHTML = '<p class="hint">Belum ada penempatan PKL yang tercatat.</p>';
            return;
        }

        const dudiName = placement.dudi?.dudi_org_name ?? placement.dudi?.full_name ?? '—';
        infoEl.innerHTML = `
            <div class="pkl-detail">
                <div><span class="pkl-label">Tempat PKL</span><strong>${esc(dudiName)}</strong></div>
                <div><span class="pkl-label">Periode</span>${fmt(placement.start_date)} – ${fmt(placement.end_date)}</div>
                <div><span class="pkl-label">Status</span>${placement.is_active
                    ? '<span class="badge badge-hadir">Aktif</span>'
                    : '<span class="badge badge-izin">Selesai</span>'}</div>
            </div>`;

        const att = await getMyPklAttendance(student.student_id);
        const agg = { HADIR:0, IZIN:0, SAKIT:0, ALPA:0, total:0 };
        for (const r of att) {
            if (agg[r.status] !== undefined) agg[r.status]++;
            agg.total++;
        }
        const pct = agg.total > 0 ? Math.round(agg.HADIR / agg.total * 100) : 0;
        document.getElementById('pkl-hadir').textContent = agg.HADIR;
        document.getElementById('pkl-izin').textContent  = agg.IZIN;
        document.getElementById('pkl-sakit').textContent = agg.SAKIT;
        document.getElementById('pkl-alpha').textContent = agg.ALPA;
        document.getElementById('pkl-pct').textContent   = agg.total > 0 ? pct + '%' : '—';
        statsEl.style.display = 'flex';

        if (att.length > 0) {
            recapCard.style.display = 'block';
            recapBody.innerHTML = att.map(r => `<tr>
                <td>${fmt(r.attendance_date)}</td>
                <td><span class="badge ${STATUS_BADGE[r.status] ?? ''}">${esc(STATUS_LABELS[r.status] ?? r.status)}</span></td>
                <td>${esc(r.notes || '—')}</td>
            </tr>`).join('');
        }
    } catch (err) {
        infoEl.innerHTML = `<p class="hint" style="color:var(--color-danger)">Gagal memuat data. ${esc(fe(err))}</p>`;
    }
}

// ─── Notif bell ──────────────────────────────────────────────

let _notifPollTimer = null;

function initNotifBell() {
    const bellBtn  = document.getElementById('notif-bell-btn');
    const dropdown = document.getElementById('notif-dropdown');
    if (!bellBtn || !dropdown) return;

    async function refresh() {
        try {
            const count = await getUnreadNotifCount();
            let badge = bellBtn.querySelector('.notif-badge');
            if (count > 0) {
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className = 'notif-badge';
                    bellBtn.appendChild(badge);
                }
                badge.textContent = count > 99 ? '99+' : count;
            } else {
                badge?.remove();
            }
        } catch {}
    }

    async function openDropdown() {
        dropdown.style.display = 'block';
        dropdown.innerHTML = '<div class="notif-empty">Memuat…</div>';
        try {
            const items = await getRecentNotifications(15);
            if (!items.length) {
                dropdown.innerHTML = '<div class="notif-empty">Tidak ada notifikasi baru.</div>';
                return;
            }
            dropdown.innerHTML = items.map(n => `
                <div class="notif-item" data-id="${n.notification_id}">
                    <div class="notif-item-title">${esc(n.title)}</div>
                    <div class="notif-item-body">${esc(n.body)}</div>
                    <div style="font-size:11px;color:var(--color-text-muted);margin-top:4px">${fmt(n.created_at)}</div>
                </div>`).join('');
            const ids = items.map(n => n.notification_id);
            await markNotificationsRead(ids);
            bellBtn.querySelector('.notif-badge')?.remove();
        } catch (err) {
            dropdown.innerHTML = `<div class="notif-empty">Gagal memuat notifikasi.</div>`;
        }
    }

    bellBtn.addEventListener('click', async e => {
        e.stopPropagation();
        if (dropdown.style.display === 'none') {
            await openDropdown();
        } else {
            dropdown.style.display = 'none';
        }
    });

    document.addEventListener('click', e => {
        if (!e.target.closest('#notif-bell-btn') && !e.target.closest('#notif-dropdown')) {
            dropdown.style.display = 'none';
        }
    });

    refresh();
    _notifPollTimer = setInterval(refresh, 60_000);
}

// ─── Logout ──────────────────────────────────────────────────

document.getElementById('logout-btn')?.addEventListener('click', async () => {
    LC.clear();
    await logout();
    window.location.replace(getLoginUrl());
});

// ─── Start ───────────────────────────────────────────────────
init().catch(err => {
    console.error('[init]', err);
    const el = document.getElementById('loading');
    if (el) {
        el.textContent = 'Gagal memuat. Silakan refresh halaman.';
        el.style.color = 'red';
    }
});

// ─── TAB FORUM ───────────────────────────────────────────────

let forumClassId  = null;
let forumAcadYear = null;
let forumOffset   = 0;
let forumHasMore  = false;
let forumInitDone = false;

async function initForumTab() {
    if (forumInitDone) { await loadForumPosts(); return; }
    forumInitDone = true;

    const loadingEl = document.getElementById('forum-loading');
    loadingEl.textContent = 'Memuat forum…';

    let cls;
    try {
        cls = await getMyForumClass(currentUser.user_id);
    } catch (e) {
        loadingEl.textContent = 'Gagal memuat data kelas.';
        return;
    }

    if (!cls) {
        loadingEl.textContent = 'Kamu belum terdaftar di kelas manapun.';
        return;
    }

    forumClassId  = cls.class_id;
    forumAcadYear = cls.academic_year;

    document.getElementById('btn-load-more-forum')
        .addEventListener('click', () => loadForumPosts(true));

    await loadForumPosts();
}

async function loadForumPosts(loadMore = false) {
    if (!forumClassId) return;

    const loadingEl  = document.getElementById('forum-loading');
    const listEl     = document.getElementById('forum-posts-list');
    const moreBtn    = document.getElementById('btn-load-more-forum');

    if (!loadMore) {
        forumOffset = 0;
        listEl.innerHTML = '';
    }
    loadingEl.style.display = '';
    loadingEl.textContent   = 'Memuat…';

    let posts;
    try {
        posts = await getForumPosts(
            forumClassId, forumAcadYear,
            currentUser.user_id, currentUser.school_id,
            20, forumOffset
        );
    } catch (e) {
        loadingEl.textContent = 'Gagal memuat posting forum.';
        return;
    }

    loadingEl.style.display = 'none';

    if (posts.length === 0 && forumOffset === 0) {
        loadingEl.style.display = '';
        loadingEl.textContent   = 'Belum ada posting forum untuk kelasmu.';
        moreBtn.style.display   = 'none';
        return;
    }

    posts.forEach(p => listEl.appendChild(renderForumCard(p)));

    forumOffset  += posts.length;
    forumHasMore  = posts.length === 20;
    moreBtn.style.display = forumHasMore ? '' : 'none';
}

function renderForumCard(p) {
    const card = document.createElement('div');
    card.className = 'section-card';
    card.style.marginBottom = '12px';

    // Badge kategori
    let badgeHtml = '';
    if (p.category) {
        const color = p.category.polarity === 'positive'
            ? 'color:var(--color-success);background:rgba(74,222,128,0.15)'
            : p.category.polarity === 'concern'
            ? 'color:var(--color-danger);background:rgba(248,113,113,0.15)'
            : 'color:#e2e8f0;background:rgba(148,163,184,0.25)';
        badgeHtml = `<span style="font-size:0.75rem;padding:2px 8px;border-radius:99px;${color}">${esc(p.category.label_sekolah)}</span>`;
    }

    // Chip nama siswa yang menjadi subjek
    let subjectsHtml = '';
    if (p.subjects?.length) {
        const chips = p.subjects
            .filter(s => s.student)
            .map(s => `<span style="font-size:0.75rem;background:var(--color-surface);color:var(--color-text);border-radius:99px;padding:2px 8px">${esc(s.student.full_name)}</span>`)
            .join(' ');
        if (chips) subjectsHtml = `<div style="margin:6px 0;display:flex;flex-wrap:wrap;gap:4px">${chips}</div>`;
    }

    // Acknowledgement
    const alreadyAck = (p.acknowledgements ?? []).some(a => a.user_id === currentUser.user_id);
    const ackBtnId   = `ack-${p.post_id}`;
    const ackHtml    = alreadyAck
        ? `<button class="btn btn-secondary" disabled style="font-size:0.8rem;padding:4px 12px">✓ Sudah dibaca</button>`
        : `<button id="${ackBtnId}" class="btn btn-primary" style="font-size:0.8rem;padding:4px 12px">Tandai sudah baca</button>`;

    // Komentar
    const comments     = p.comments ?? [];
    const commentsHtml = comments.length
        ? comments.map(c => `
            <div style="padding:6px 0;border-top:1px solid var(--color-border,#e5e7eb);font-size:0.85rem">
                <span style="font-weight:600">${esc(c.author?.full_name ?? '—')}</span>
                <span style="color:var(--color-text-muted,#6b7280)"> · ${fmtRelative(c.created_at)}</span>
                <p style="margin:3px 0 0">${esc(c.body)}</p>
            </div>`).join('')
        : '';

    // Waktu relatif
    const timeAgo = fmtRelative(p.created_at);

    // Pin indicator
    const pinHtml = p.is_pinned
        ? `<span style="font-size:0.75rem;color:var(--color-warning,#d97706)">📌 Disematkan · </span>`
        : '';

    card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:4px;margin-bottom:6px">
            <div>
                ${pinHtml}
                <span style="font-weight:600">${esc(p.author?.full_name ?? '—')}</span>
                <span style="font-size:0.8rem;color:var(--color-text-muted,#6b7280)"> · ${timeAgo}</span>
            </div>
            ${badgeHtml}
        </div>
        ${subjectsHtml}
        ${p.title && p.title !== p.body ? `<div style="font-weight:600;margin-bottom:4px">${esc(p.title)}</div>` : ''}
        <div style="white-space:pre-wrap;font-size:0.9rem">${esc(p.body ?? '')}</div>
        <div style="margin-top:10px">
            ${ackHtml}
        </div>
        ${commentsHtml}
    `;

    if (!alreadyAck) {
        card.querySelector(`#${ackBtnId}`)?.addEventListener('click', async function () {
            this.disabled = true;
            this.textContent = '…';
            try {
                await addForumAck(p.post_id, currentUser.user_id, currentUser.school_id);
                this.textContent = '✓ Sudah dibaca';
                this.className = 'btn btn-secondary';
            } catch {
                this.disabled = false;
                this.textContent = 'Tandai sudah baca';
            }
        });
    }

    return card;
}

function fmtRelative(isoStr) {
    if (!isoStr) return '';
    const diff = Math.floor((Date.now() - new Date(isoStr)) / 1000);
    if (diff < 60)   return 'baru saja';
    if (diff < 3600) return `${Math.floor(diff / 60)} menit lalu`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
    return `${Math.floor(diff / 86400)} hari lalu`;
}
