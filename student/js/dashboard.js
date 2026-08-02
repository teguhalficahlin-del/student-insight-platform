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
    getForumSekolahPosts, addForumSekolahAck,
    getMyLateArrivals,
    getMyExits,
} from './api.js';
import { showPwaBanner } from '../../shared/pwa-banner.js';

// ─── State ───────────────────────────────────────────────────
let currentUser = null;
let student     = null;   // baris students milik user
let config      = null;   // { current_academic_year, current_semester }
let myClass     = null;   // enrollment + class
let obsLoaded        = false;
let pklLoaded        = false;
let lateExitsLoaded  = false;

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
    showPwaBanner({ hasBottomNav: true });
}

// ─── Tab navigation ──────────────────────────────────────────
const TAB_SHORT = { jadwal: 'Jadwal', kehadiran: 'Hadir', observasi: 'Catatan', pkl: 'PKL', nilai: 'Nilai' };
const TAB_ICON  = { jadwal: 'ti-calendar', kehadiran: 'ti-clipboard-check', observasi: 'ti-notes', pkl: 'ti-briefcase', forum: 'ti-messages', nilai: 'ti-chart-bar' };

function buildTabs() {
    const nav    = document.getElementById('tab-nav');
    const botNav = document.getElementById('bottom-nav');
    const isPkl  = student.student_status === 'PKL';
    const tabs   = [];
    if (!isPkl) tabs.push({ key: 'jadwal', label: 'Jadwal' });
    tabs.push({ key: 'kehadiran', label: 'Kehadiran' });
    tabs.push({ key: 'observasi', label: 'Catatan' });
    tabs.push({ key: 'forum', label: 'Forum' });
    tabs.push({ key: 'nilai', label: 'Nilai' });
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
        case 'kehadiran':
            await loadAttendance();
            if (!lateExitsLoaded) {
                lateExitsLoaded = true;
                const [lr, er] = await Promise.allSettled([
                    getMyLateArrivals(student.student_id),
                    getMyExits(student.student_id),
                ]);
                if (lr.status === 'fulfilled') renderLateArrivals(lr.value);
                else { const h = document.getElementById('late-hint'); if (h) { h.style.display='block'; h.textContent=`Gagal memuat riwayat keterlambatan. ${fe(lr.reason)}`; } }
                if (er.status === 'fulfilled') renderExits(er.value);
                else { const h = document.getElementById('exits-hint'); if (h) { h.style.display='block'; h.textContent=`Gagal memuat riwayat izin keluar. ${fe(er.reason)}`; } }
            }
            break;
        case 'observasi': if (!obsLoaded) await loadObservations(); break;
        case 'pkl':       if (!pklLoaded) await loadPkl(); break;
        case 'forum':     await initForumTab(); break;
        case 'nilai':     await initNilaiTab(); break;
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
        <details class="att-accordion">
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
                <details class="att-accordion">
                    <summary class="att-accordion-summary">
                        <span class="att-acc-name">${esc(dayLabel)}</span>
                        <span class="att-acc-names">${sesiCount > 0 ? `${sesiCount} sesi` : 'tidak ada jadwal'}</span>
                    </summary>
                    <div style="padding:0 12px 8px">${tableHtml}</div>
                </details>`;
        }).join('');

        // Single expand: tutup accordion lain saat satu dibuka
        contentEl.querySelectorAll('details.att-accordion').forEach(el => {
            el.addEventListener('toggle', () => {
                if (el.open) {
                    contentEl.querySelectorAll('details.att-accordion').forEach(other => {
                        if (other !== el) other.removeAttribute('open');
                    });
                }
            });
        });

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
    tbody.innerHTML = '<tr><td colspan="6" class="hint">Memuat…</td></tr>';
    emptyEl.style.display = 'none';

    try {
        const rows = await getMyAttendance(student.student_id, start, end);
        // Kartu: hitung per blok (satu pertemuan = satu kejadian)
        const card = { HADIR:0, IZIN:0, SAKIT:0, ALPA:0 };
        let totalSlots = 0, hadirSlots = 0;
        for (const block of rows) {
            if (card[block.summary_status] !== undefined) card[block.summary_status]++;
            for (const s of (block.slots ?? [])) {
                if (s.status === 'HADIR') hadirSlots++;
                totalSlots++;
            }
        }
        const pct = totalSlots > 0 ? Math.round(hadirSlots / totalSlots * 100) : 0;
        document.getElementById('att-hadir').textContent = card.HADIR;
        document.getElementById('att-izin').textContent  = card.IZIN;
        document.getElementById('att-sakit').textContent = card.SAKIT;
        document.getElementById('att-alpha').textContent = card.ALPA;
        document.getElementById('att-pct').textContent   = totalSlots > 0 ? pct + '%' : '—';
        if (!document.getElementById('att-granularity-note')) {
            const statsRow = document.getElementById('att-stats');
            if (statsRow) {
                const note = document.createElement('p');
                note.id = 'att-granularity-note';
                note.className = 'hint';
                note.style.cssText = 'margin-top:4px;font-size:11px;';
                note.textContent = 'Hadir/Izin/Sakit/Alpa dihitung per pertemuan; % Hadir dihitung per jam pelajaran.';
                statsRow.insertAdjacentElement('afterend', note);
            }
        }

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

        tbody.innerHTML = rows.map(block => `
            <tr class="att-block-row">
                <td>${fmt(block.date)}</td>
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
        tbody.innerHTML = `<tr><td colspan="6" style="color:var(--color-danger)">${esc(fe(err))}</td></tr>`;
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

    const [obsResult, casesResult] = await Promise.allSettled([
        getMyObservations(student.student_id, dateStart, dateEnd),
        getMyCases(student.student_id),
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

}

function renderLateArrivals(rows) {
    const hintEl = document.getElementById('late-hint');
    const bodyEl = document.getElementById('late-body');
    if (!hintEl || !bodyEl) return;
    if (!rows.length) {
        hintEl.style.display = 'block';
        hintEl.textContent   = 'Belum ada riwayat keterlambatan.';
        bodyEl.innerHTML     = '';
        return;
    }
    hintEl.style.display = 'none';
    bodyEl.innerHTML = `
        <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;font-size:13px">
                <thead>
                    <tr style="border-bottom:2px solid var(--color-border);text-align:left">
                        <th style="padding:8px 10px;white-space:nowrap">Tanggal</th>
                        <th style="padding:8px 10px;white-space:nowrap">Jam Datang</th>
                        <th style="padding:8px 10px">Alasan</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map(r => `
                        <tr style="border-bottom:1px solid var(--color-border)">
                            <td style="padding:8px 10px;white-space:nowrap">${fmt(r.date)}</td>
                            <td style="padding:8px 10px;white-space:nowrap">${r.arrival_time ? r.arrival_time.slice(0,5) : '—'}</td>
                            <td style="padding:8px 10px">${r.reason ? esc(r.reason) : '<span style="color:var(--color-text-muted)">—</span>'}</td>
                        </tr>`).join('')}
                </tbody>
            </table>
        </div>`;
}

function renderExits(rows) {
    const hintEl = document.getElementById('exits-hint');
    const bodyEl = document.getElementById('exits-body');
    if (!hintEl || !bodyEl) return;
    if (!rows.length) {
        hintEl.style.display = 'block';
        hintEl.textContent   = 'Belum ada riwayat izin keluar.';
        bodyEl.innerHTML     = '';
        return;
    }
    hintEl.style.display = 'none';
    bodyEl.innerHTML = `
        <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;font-size:13px">
                <thead>
                    <tr style="border-bottom:2px solid var(--color-border);text-align:left">
                        <th style="padding:8px 10px;white-space:nowrap">Tanggal</th>
                        <th style="padding:8px 10px;white-space:nowrap">Jam Keluar</th>
                        <th style="padding:8px 10px;white-space:nowrap">Jam Kembali</th>
                        <th style="padding:8px 10px">Alasan</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map(r => `
                        <tr style="border-bottom:1px solid var(--color-border)">
                            <td style="padding:8px 10px;white-space:nowrap">${fmt(r.exit_date)}</td>
                            <td style="padding:8px 10px;white-space:nowrap">${r.exit_time ? r.exit_time.slice(0,5) : '—'}</td>
                            <td style="padding:8px 10px;white-space:nowrap">${r.return_time ? r.return_time.slice(0,5) : '—'}</td>
                            <td style="padding:8px 10px">${r.reason ? esc(r.reason) : '<span style="color:var(--color-text-muted)">—</span>'}</td>
                        </tr>`).join('')}
                </tbody>
            </table>
        </div>`;
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
                        <p style="margin:4px 0 0">${esc(e.payload?.text ?? '')}</p>
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
                Ditindaklanjuti oleh: ${esc(c.handler?.full_name ?? '—')} · ${fmt(c.created_at)}
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
            dropdown.querySelectorAll('.notif-item').forEach(el => {
                el.addEventListener('click', async () => {
                    dropdown.style.display = 'none';
                    await markNotificationsRead([el.dataset.id]).catch(() => {});
                    await refresh();
                });
            });
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

// ─── Forum Sekolah ────────────────────────────────────────────

let _forumOffset   = 0;
let _forumHasMore  = false;
let _forumInitDone = false;

async function initForumTab() {
    if (_forumInitDone) { await loadForumPosts(); return; }
    _forumInitDone = true;

    document.getElementById('btn-load-more-forum')
        .addEventListener('click', () => loadForumPosts(true));

    // Modal detail
    document.getElementById('btn-forum-detail-close')
        .addEventListener('click', closeForumDetail);
    document.getElementById('modal-forum-detail')
        .addEventListener('click', e => {
            if (e.target === e.currentTarget) closeForumDetail();
        });

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

    try {
        const posts = await getForumSekolahPosts(
            currentUser.school_id, currentUser.user_id, LIMIT, _forumOffset);

        loadingEl.style.display = 'none';

        if (!posts.length && _forumOffset === 0) {
            loadingEl.style.display = '';
            loadingEl.textContent   = 'Belum ada pengumuman untukmu.';
            moreBtn.style.display   = 'none';
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
    const author  = esc(post.author?.full_name ?? '—');
    const ackCnt  = post.acknowledgements?.length ?? 0;
    const hasFile = !!post.attachment_url;
    const edited  = post.is_edited
        ? '<span class="hint" style="font-size:11px"> (diedit)</span>' : '';

    card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
            <strong>${esc(post.title)}${edited}</strong>
            <span class="hint" style="white-space:nowrap;font-size:12px">${time}</span>
        </div>
        <p class="hint" style="margin:4px 0 8px">${author}</p>
        <p style="margin:0 0 8px;font-size:14px;white-space:pre-wrap">${
            esc(post.body).substring(0, 160)}${post.body.length > 160 ? '…' : ''}</p>
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

    document.getElementById('detail-forum-title').textContent = post.title;
    document.getElementById('detail-forum-body').textContent  = post.body;

    const time   = new Date(post.created_at).toLocaleString('id-ID',
        { dateStyle: 'long', timeStyle: 'short' });
    const author = post.author?.full_name ?? '—';
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

    // Acknowledge otomatis saat dibuka
    addForumSekolahAck(post.post_id, currentUser.user_id, currentUser.school_id)
        .catch(() => {});
}

function closeForumDetail() {
    document.getElementById('modal-forum-detail').style.display = 'none';
}

function fmtRelative(isoStr) {
    if (!isoStr) return '';
    const diff = Math.floor((Date.now() - new Date(isoStr)) / 1000);
    if (diff < 60)   return 'baru saja';
    if (diff < 3600) return `${Math.floor(diff / 60)} menit lalu`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
    return `${Math.floor(diff / 86400)} hari lalu`;
}

// ── Tab Nilai ──
let _nilaiTabInit = false;

async function initNilaiTab() {
    if (!_nilaiTabInit) {
        _nilaiTabInit = true;
        const activeYear = config?.current_academic_year ?? null;
        const activeStartYr = activeYear ? parseInt(activeYear) : new Date().getFullYear();
        const selYear = document.getElementById('nilai-year-select');
        [activeStartYr - 1, activeStartYr, activeStartYr + 1].forEach(y => {
            const opt = document.createElement('option');
            opt.value = `${y}/${y + 1}`;
            opt.textContent = `${y}/${y + 1}`;
            if (`${y}/${y + 1}` === activeYear) opt.selected = true;
            selYear.appendChild(opt);
        });
        selYear.addEventListener('change', () => loadNilaiGrid());
        document.getElementById('nilai-semester-select')
            .addEventListener('change', () => loadNilaiGrid());
    }
    await loadNilaiGrid();
}

async function loadNilaiGrid() {
    const gridEl = document.getElementById('nilai-grid');
    const year   = document.getElementById('nilai-year-select').value || null;
    const semStr = document.getElementById('nilai-semester-select').value;
    const sem    = semStr ? parseInt(semStr) : null;
    gridEl.innerHTML = '<p class="hint">Memuat…</p>';
    try {
        const { data, error } = await supabase.rpc('fn_get_all_grades_summary', {
            p_student_id:    null,
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
