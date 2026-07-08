/**
 * @file guru/js/dashboard.js
 * Dashboard utama Portal Guru — 1 login, tab Guru + tab Jabatan.
 */

import { applyBrandingById, getLoginUrl } from '../../shared/branding.js';
import { checkMustChangePassword, initChangePassword } from '../../shared/change-password.js';
import { initLoginGuard } from '../../shared/login-guard.js';
import {
    supabase, logout, getCurrentUserRow, GURU_ROLES,
    listSchoolAdmins, addSchoolAdmin, removeSchoolAdmin,
    getJabatan, jabatanLabel, getSchoolConfig,
    getMyScheduleForDate, getEnrolledStudents, getMyClasses, getClassesByProgram,
    getAttendanceForSession,
    getMyStudents, searchStudents, insertObservation,
    getWaliKelasInfo, getWaliAttendanceSummary,
    getProgram, fetchPklStudents, fetchNonPklStudents,
    fetchDudiPartners, fetchPklAttendance, fetchDudiObservations,
    getAttendanceSummaryByStudents,
    fetchAllPklStudents, fetchAllDudiPartners,
    createPlacement, finishPlacement, bulkImportPkl,
    getSchoolStats, getKepsekMonitoring, getAbsentTeachersToday,
    getAttendanceRecapPerClass, getOpenCases,
    getJournalEntries, insertJournalEntry, deleteJournalEntry, updateJournalEntry,
    getMyObservations, updateObsVisibility,
    getObsAudienceMembers, addObsAudienceMember, removeObsAudienceMember,
    getCases, getCase, getCaseEvents, createCase,
    addCaseComment, escalateCase, changeCaseStatus, closeCase,
    updateCaseAudience, getCaseAudienceMembers,
    addCaseAudienceMember, removeCaseAudienceMember, searchInternalUsers,
    getUnreadNotifCount, getRecentNotifications, markNotificationsRead,
    registerLoginDevice,
} from './api.js';
import { saveAttendanceBatch, flushPending, pendingCount, clearOfflineQueue } from './offline.js';

// ─── Notifikasi lonceng ───────────────────────────────────────
// Menggantikan badge localStorage. Sumber kebenaran = tabel notifications.

let _notifPollTimer = null;

function _setBellBadge(n) {
    const btn = document.getElementById('notif-bell-btn');
    if (!btn) return;
    let badge = btn.querySelector('.notif-badge-count');
    if (n > 0) {
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'notif-badge-count';
            badge.style.cssText = 'position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;line-height:18px;border-radius:9px;background:var(--color-danger,#dc2626);color:#fff;font-size:11px;font-weight:700;text-align:center;padding:0 3px;pointer-events:none';
            btn.style.position = 'relative';
            btn.appendChild(badge);
        }
        badge.textContent = n > 99 ? '99+' : String(n);
        // Badge kecil di tab Kasus juga (backward compat)
        document.querySelectorAll('[data-tab="kasus"]').forEach(t => {
            let b = t.querySelector('.kasus-notif-badge');
            if (!b) { b = document.createElement('span'); b.className = 'kasus-notif-badge'; b.style.cssText = 'display:inline-block;min-width:18px;height:18px;line-height:18px;border-radius:9px;background:var(--color-danger,#dc2626);color:#fff;font-size:11px;font-weight:700;text-align:center;padding:0 4px;margin-left:5px;vertical-align:middle'; t.appendChild(b); }
            b.textContent = n > 99 ? '99+' : String(n);
        });
    } else {
        badge?.remove();
        document.querySelectorAll('.kasus-notif-badge').forEach(b => b.remove());
    }
}

async function refreshNotifBadge() {
    if (!currentUser) return;
    try {
        const n = await getUnreadNotifCount();
        _setBellBadge(n);
    } catch { /* tidak kritis */ }
}

function startNotifPolling() {
    clearInterval(_notifPollTimer);
    _notifPollTimer = setInterval(refreshNotifBadge, 60_000); // poll tiap 1 menit
}

async function openNotifDropdown() {
    const panel = document.getElementById('notif-dropdown');
    if (!panel) return;
    const isOpen = panel.style.display !== 'none';
    if (isOpen) { panel.style.display = 'none'; return; }

    panel.style.display = 'block';
    panel.innerHTML = '<p style="padding:12px;font-size:13px;color:var(--color-text-muted)">Memuat…</p>';
    try {
        const notifs = await getRecentNotifications(15);
        if (!notifs.length) {
            panel.innerHTML = '<p style="padding:12px;font-size:13px;color:var(--color-text-muted)">Tidak ada notifikasi baru.</p>';
            return;
        }
        panel.innerHTML = notifs.map(n => `
            <div class="notif-item" data-id="${n.notification_id}" data-case="${n.case_id ?? ''}"
                 style="padding:10px 14px;border-bottom:1px solid var(--color-border);cursor:pointer;font-size:13px">
                <div style="font-weight:600;margin-bottom:2px">${esc(n.title)}</div>
                <div style="color:var(--color-text-muted);font-size:12px">${esc(n.body)}</div>
                <div style="color:var(--color-text-muted);font-size:11px;margin-top:3px">${fmt(n.created_at)}</div>
            </div>`).join('') +
            `<div style="padding:8px 14px;text-align:center">
                <button id="notif-mark-all-btn" class="btn btn-secondary btn-sm" style="font-size:12px">Tandai semua dibaca</button>
            </div>`;

        panel.querySelectorAll('.notif-item').forEach(el => {
            el.addEventListener('mouseenter', () => { el.style.background = 'var(--color-bg)'; });
            el.addEventListener('mouseleave', () => { el.style.background = ''; });
            el.addEventListener('click', async () => {
                panel.style.display = 'none';
                await markNotificationsRead([el.dataset.id]).catch(() => {});
                await refreshNotifBadge();
                if (el.dataset.case) openKasusDetail(el.dataset.case);
            });
        });

        document.getElementById('notif-mark-all-btn')?.addEventListener('click', async () => {
            const ids = notifs.map(n => n.notification_id);
            await markNotificationsRead(ids).catch(() => {});
            panel.style.display = 'none';
            _setBellBadge(0);
        });
    } catch {
        panel.innerHTML = '<p style="padding:12px;font-size:13px;color:var(--color-danger)">Gagal memuat notifikasi.</p>';
    }
}

function markKasusAsSeen() {
    // Tidak lagi pakai localStorage — mark read via DB saat buka kasus
    _setBellBadge(0);
}

// ─── State ───────────────────────────────────────────────────
let currentUser  = null;
let config       = null;   // { current_academic_year, current_semester }
let jabatan      = [];
let isTeacher    = false;  // hanya GURU & WALI_KELAS yang mengajar
let myStudents       = [];     // for observation selector
let isBroadObserver    = false;  // BK/Waka/Kepsek — bisa cari siswa seluruh sekolah
let kaprodiAllStudents = [];     // PKL + aktif di prodi Kaprodi, untuk batas pencarian
let kpStudents      = [];  // kaprodi PKL students
let kpAktifStudents = [];  // kaprodi siswa AKTIF (kelas)
let kpProgramId     = null;
let kpDudiList      = [];

const DIMENSION_LABELS = { AKADEMIK:'Akademik', KEHADIRAN:'Kehadiran', PERILAKU:'Perilaku', SOSIAL:'Sosial', AFEKTIF:'Afektif', BAKAT_MINAT:'Bakat & Minat', FISIK:'Fisik', LAINNYA:'Lainnya' };

// ─── Read cache (LF-2) ───────────────────────────────────────
// Simpan snapshot data server ke localStorage → tampilkan saat halaman
// dibuka (sebelum server merespons), termasuk saat offline.
const LC = {
    set(key, data) {
        try { localStorage.setItem(`smkhr:${key}`, JSON.stringify({ ts: Date.now(), data })); } catch {}
    },
    get(key) {
        try { const r = JSON.parse(localStorage.getItem(`smkhr:${key}`)); return r?.data ?? null; }
        catch { return null; }
    },
    clear(prefix) {
        try { Object.keys(localStorage).filter(k => k.startsWith(`smkhr:${prefix}`)).forEach(k => localStorage.removeItem(k)); }
        catch {}
    },
    remove(key) {
        try { localStorage.removeItem(`smkhr:${key}`); } catch {}
    },
};

function esc(s) {
    const el = document.createElement('span');
    el.textContent = s ?? '';
    return el.innerHTML;
}
/** Pesan error ramah pengguna — detail teknis ke console saja. */
function fe(err, ctx = 'muat') {
    console.error('[guru]', err);
    const m = String(err?.message ?? '').toLowerCase();
    if (m.includes('jwt') || m.includes('expired')) return 'Sesi habis. Silakan login ulang.';
    if (m.includes('fetch') || m.includes('network') || m.includes('failed to fetch')) return 'Tidak ada koneksi. Periksa jaringan.';
    if (m.includes('security policy') || m.includes('permission') || m.includes('forbidden')) return 'Tidak memiliki izin.';
    return ctx === 's' ? 'Gagal menyimpan. Silakan coba lagi.'
         : ctx === 'h' ? 'Gagal menghapus. Silakan coba lagi.'
         : 'Gagal memuat data. Silakan coba lagi.';
}
function fmt(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('id-ID', { day:'numeric', month:'short', year:'numeric' });
}
function fmtTime(t) { return t ? t.slice(0, 5) : '—'; }

// ─── Boot ────────────────────────────────────────────────────
async function init() {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) { window.location.href = getLoginUrl(); return; }

    currentUser = await getCurrentUserRow();
    if (!currentUser || !GURU_ROLES.includes(currentUser.role_type) || currentUser.is_active === false) {
        await supabase.auth.signOut();
        window.location.href = getLoginUrl();
        return;
    }

    applyBrandingById(currentUser.school_id, supabase);

    await checkMustChangePassword(supabase, currentUser);
    await initLoginGuard(supabase, currentUser);

    config  = await getSchoolConfig();
    jabatan   = getJabatan(currentUser);
    isTeacher = !!currentUser.teacher_code;

    // Header
    document.getElementById('hdr-name').textContent = currentUser.full_name;
    const roleLabel = jabatan.length
        ? (isTeacher ? 'Guru' : '') +
          (isTeacher && jabatan.length ? ' · ' : '') +
          jabatan.map(jabatanLabel).join(' · ')
        : 'Guru';
    document.getElementById('hdr-role').textContent = roleLabel;

    buildTabs();
    document.getElementById('loading').style.display = 'none';
    document.getElementById('app').style.display     = 'block';

    const defaultTab = isTeacher ? 'guru' : (jabatan[0] ?? 'kasus');
    activateTab(defaultTab);
    await loadTabContent(defaultTab);

    // Offline sync: tampilkan status + kirim absensi tertunda.
    await updateSyncBanner();
    window.addEventListener('online',  runFlush);
    window.addEventListener('offline', updateSyncBanner);
    runFlush();

    // Peringatan login dari perangkat baru: daftarkan perangkat ini.
    // Jika belum pernah dipakai (bukan yg pertama), server menaruh notif
    // di lonceng. Non-blocking; kegagalan tak mengganggu dashboard.
    await registerLoginDevice();

    // Notifikasi: cek unread count lalu poll tiap 1 menit.
    refreshNotifBadge();
    startNotifPolling();
}

// ─── Tab navigation ──────────────────────────────────────────
const TAB_SHORT = {
    guru: 'Beranda', wali_kelas: 'Wali', bk: 'BK', kaprodi: 'Prodi',
    waka_kesiswaan: 'Kesiswaan', waka_kurikulum: 'Kurikulum', waka_humas: 'Humas',
    kepsek: 'Monitor', ks_admin: 'Admin',
    kasus: 'Pembinaan', jurnal: 'Jurnal', observasi: 'Observasi',
};
const TAB_ICON = {
    guru: 'ti-home', wali_kelas: 'ti-users', bk: 'ti-heart-handshake', kaprodi: 'ti-building',
    waka_kesiswaan: 'ti-school', waka_kurikulum: 'ti-book', waka_humas: 'ti-briefcase',
    kepsek: 'ti-chart-line', ks_admin: 'ti-shield-check',
    kasus: 'ti-alert-triangle', jurnal: 'ti-notebook', observasi: 'ti-eye',
};

function buildTabs() {
    const nav    = document.getElementById('tab-nav');
    const botNav = document.getElementById('bottom-nav');
    const tabs = [];
    if (isTeacher) tabs.push({ key: 'guru', label: 'Dashboard Guru' });
    jabatan.forEach(j => tabs.push({ key: j, label: jabatanLabel(j) }));
    tabs.push({ key: 'kasus', label: 'Pembinaan Siswa' });
    if (jabatan.includes('kepsek')) tabs.push({ key: 'ks_admin', label: 'Kelola Admin' });
    if (isTeacher) tabs.push({ key: 'observasi', label: 'Observasi Siswa' });
    if (isTeacher) tabs.push({ key: 'jurnal', label: 'Jurnal Mengajar' });

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
}

function activateTab(key) {
    document.querySelectorAll('.tab-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.tab === key));
    document.querySelectorAll('.tab-panel').forEach(p =>
        p.classList.toggle('active', p.id === `tab-${key}`));
}

async function loadTabContent(key) {
    switch (key) {
        case 'guru':        await initGuruTab(); break;
        case 'wali_kelas':  await initWaliTab(); break;
        case 'bk':          await initBkTab(); break;
        case 'kaprodi':     await initKaprodiTab(); break;
        case 'waka_kesiswaan': await initWakaKesiswaanTab(); break;
        case 'waka_kurikulum': await initWakaKurTab(); break;
        case 'waka_humas':  await initWakaHumasTab(); break;
        case 'kepsek':      await initKepsekTab(); break;
        case 'ks_admin':    await initKsAdminTab(); break;
        case 'kasus':       await initKasusTab(); break;
        case 'jurnal':      await initJurnalTab(); break;
        case 'observasi':   await initObsTab(); break;
    }
}

// ─── TAB GURU ────────────────────────────────────────────────

let _guruTabInit = false;
async function initGuruTab() {
    const dateEl = document.getElementById('sched-date');
    if (!dateEl.value) dateEl.value = localDateStr();

    if (!_guruTabInit) {
        _guruTabInit = true;
        dateEl.addEventListener('change', loadSchedule);
        document.getElementById('guru-recap-btn').onclick = loadGuruRecap;
        // Default rentang: awal bulan ini s/d hari ini
        const today = localDateStr();
        const firstOfMonth = today.slice(0, 8) + '01';
        document.getElementById('guru-recap-start').value = firstOfMonth;
        document.getElementById('guru-recap-end').value   = today;
        await initGuruRekapDropdown();

        // Toggle hari / minggu
        document.querySelectorAll('.sched-view-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                document.querySelectorAll('.sched-view-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const isWeek = btn.dataset.view === 'minggu';
                document.getElementById('sched-view-hari-panel').style.display  = isWeek ? 'none' : 'block';
                document.getElementById('sched-view-minggu-panel').style.display = isWeek ? 'block' : 'none';
                if (isWeek) await loadWeekSchedule();
            });
        });
    }

    await loadSchedule();
    await initObsForm();
}

async function initGuruRekapDropdown() {
    const sel = document.getElementById('guru-recap-class');
    try {
        const classes = await getMyClasses(currentUser.user_id, config.current_academic_year, config.current_semester);

        if (classes.length === 0) {
            sel.innerHTML = '<option value="">Tidak ada kelas</option>';
            return;
        }
        sel.innerHTML = '<option value="">— Pilih Kelas —</option>' +
            classes.map(c => `<option value="${c.class_id}">${esc(c.name)}</option>`).join('');
    } catch {
        sel.innerHTML = '<option value="">Gagal memuat kelas</option>';
    }
}

async function loadGuruRecap() {
    const classId   = document.getElementById('guru-recap-class').value;
    const dateStart = document.getElementById('guru-recap-start').value;
    const dateEnd   = document.getElementById('guru-recap-end').value;
    const content   = document.getElementById('guru-recap-content');
    const className = document.getElementById('guru-recap-class').selectedOptions[0]?.text ?? '';

    if (!classId) { content.innerHTML = '<p class="hint">Pilih kelas terlebih dahulu.</p>'; return; }

    content.innerHTML = '<p class="hint">Memuat rekap…</p>';
    try {
        const students = await getEnrolledStudents(classId, config.current_academic_year);
        if (students.length === 0) {
            content.innerHTML = '<p class="hint">Belum ada siswa aktif di kelas ini untuk tahun ajaran ini.</p>';
            return;
        }
        const rows = await getAttendanceSummaryByStudents(students, dateStart || null, dateEnd || null, currentUser.user_id);
        const tbody = rows.map(s => {
            const pctDenom = s.HADIR + s.IZIN + s.TIDAK_HADIR;
            const pct = pctDenom > 0 ? Math.round((s.HADIR / pctDenom) * 100) : 0;
            const color = pct >= 80 ? 'var(--color-success)' : pct >= 60 ? 'var(--color-warning,#f59e0b)' : 'var(--color-danger)';
            return `<tr>
                <td><span style="font-weight:500">${esc(s.full_name)}</span><br><span style="font-size:0.78rem;color:var(--color-text-muted,#9ca3af)">${esc(s.nis)}</span></td>
                <td style="text-align:center">${s.HADIR}</td>
                <td style="text-align:center">${s.IZIN}</td>
                <td style="text-align:center">${s.SAKIT}</td>
                <td style="text-align:center">${s.TIDAK_HADIR}</td>
                <td style="text-align:center">${s.total}</td>
                <td style="text-align:center;font-weight:600;color:${color}">${s.total > 0 ? pct + '%' : '—'}</td>
            </tr>`;
        }).join('');
        content.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px">
                <p style="font-size:0.82rem;color:var(--color-text-muted,#9ca3af);margin:0">
                    ${esc(className)} · ${rows.length} siswa · akumulasi ${dateStart || '—'} s/d ${dateEnd || '—'}
                </p>
                <button class="btn btn-secondary btn-sm" id="guru-recap-export">Unduh CSV</button>
            </div>
            <div class="table-wrapper">
            <table class="table">
                <thead><tr>
                    <th>Nama / NIS</th>
                    <th style="text-align:center">Hadir</th><th style="text-align:center">Izin</th>
                    <th style="text-align:center">Sakit</th><th style="text-align:center">Alpa</th>
                    <th style="text-align:center">Total Sesi</th><th style="text-align:center">% Hadir</th>
                </tr></thead>
                <tbody>${tbody}</tbody>
            </table>
            </div>`;

        document.getElementById('guru-recap-export')?.addEventListener('click', () => {
            const header = 'Nama,NIS,Hadir,Izin,Sakit,Alpa,Total Sesi,% Hadir';
            const csvRows = rows.map(s => {
                const pctDenom = s.HADIR + s.IZIN + s.TIDAK_HADIR;
                const pct = pctDenom > 0 ? Math.round((s.HADIR / pctDenom) * 100) : 0;
                return [s.full_name, s.nis, s.HADIR, s.IZIN, s.SAKIT, s.TIDAK_HADIR, s.total, s.total > 0 ? pct + '%' : '—']
                    .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',');
            });
            const blob = new Blob(['﻿' + [header, ...csvRows].join('\r\n')], { type: 'text/csv;charset=utf-8;' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `kehadiran_${esc(className)}_${dateStart || 'all'}_${dateEnd || 'all'}.csv`.replace(/\s+/g, '_');
            a.click();
            URL.revokeObjectURL(a.href);
        });
    } catch (err) {
        content.innerHTML = `<p class="hint" style="color:var(--color-danger)">Gagal memuat rekap. ${esc(fe(err))}</p>`;
    }
}

function localDateStr(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function fmtDayLabel(dateStr) {
    if (!dateStr) return '';
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function renderScheduleRows(rows, contentEl, date) {
    const dayLabel = `<p style="font-size:0.85rem;color:var(--color-text-muted,#9ca3af);margin-bottom:8px">${fmtDayLabel(date)}</p>`;
    if (rows.length === 0) {
        contentEl.innerHTML = dayLabel + '<p class="hint">Tidak ada jadwal mengajar pada tanggal ini.</p>';
        return;
    }
    const isPast = date < localDateStr();
    contentEl.innerHTML = dayLabel + `
        <div class="table-wrapper">
        <table class="table">
            <thead><tr><th>Jam</th><th>Kelas</th><th>Kehadiran</th></tr></thead>
            <tbody>
            ${rows.map(r => `
                <tr>
                    <td>${fmtTime(r.session_start)} – ${fmtTime(r.session_end)}</td>
                    <td>${esc(r.class?.name ?? '—')}</td>
                    <td>
                        <button class="btn ${isPast ? 'btn-secondary' : 'btn-primary'} btn-xs att-open-btn"
                            data-schedule="${r.schedule_id}"
                            data-class="${r.class?.class_id}"
                            data-classname="${esc(r.class?.name ?? '')}"
                            data-ispast="${isPast}">
                            ${isPast ? 'Koreksi Kehadiran' : 'Input Kehadiran'}
                        </button>
                    </td>
                </tr>
            `).join('')}
            </tbody>
        </table>
        </div>`;
    contentEl.querySelectorAll('.att-open-btn').forEach(btn => {
        btn.addEventListener('click', () => openAttModal(btn));
    });

    // Tombol tutup modal
    document.getElementById('att-modal-close').onclick = closeAttModal;
    document.getElementById('att-modal').addEventListener('click', e => {
        if (e.target === e.currentTarget) closeAttModal();
    });
}

function openAttModal(btn) {
    const modal    = document.getElementById('att-modal');
    const isPast   = btn.dataset.ispast === 'true';
    document.getElementById('att-modal-title').textContent =
        isPast ? `Koreksi Kehadiran — ${btn.dataset.classname}` : `Kehadiran — ${btn.dataset.classname}`;
    document.getElementById('att-modal-body').innerHTML =
        (isPast ? '<p class="hint" style="background:var(--color-bg-alt,#f3f4f6);padding:8px 10px;border-radius:6px;margin-bottom:12px">Data kehadiran sebelumnya sudah ditampilkan. Ubah jika perlu lalu klik Simpan.</p>' : '') +
        '<p class="hint">Memuat daftar siswa…</p>';
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    loadAttModalContent(btn.dataset.schedule, btn.dataset.class, btn.dataset.classname);
}

function closeAttModal() {
    document.getElementById('att-modal').style.display = 'none';
    document.body.style.overflow = '';
}

async function loadSchedule() {
    const date      = document.getElementById('sched-date').value;
    const contentEl = document.getElementById('sched-content');
    const cacheKey  = `sched-${currentUser.user_id}-${date}`;

    // Tampilkan cache dulu — halaman langsung berisi data walau offline
    const cached = LC.get(cacheKey);
    if (cached) {
        renderScheduleRows(cached, contentEl, date);
    } else {
        contentEl.innerHTML = '<p class="hint">Memuat jadwal…</p>';
    }

    try {
        const rows = await getMyScheduleForDate(currentUser.user_id, date);
        LC.set(cacheKey, rows);
        renderScheduleRows(rows, contentEl, date);
    } catch (err) {
        if (!cached) {
            contentEl.innerHTML = `<p class="hint" style="color:var(--color-danger)">Gagal memuat data. ${esc(fe(err))}</p>`;
        }
        // Jika ada cache, biarkan data lama tetap tampil — jangan overwrite dengan error
    }
}

async function loadWeekSchedule() {
    const contentEl = document.getElementById('sched-week-content');
    contentEl.innerHTML = '<p class="hint">Memuat jadwal minggu ini…</p>';

    // Hitung Senin s/d Jumat minggu ini
    const today = new Date();
    const dow   = today.getDay(); // 0=Min,1=Sen,...,6=Sab
    const diff  = dow === 0 ? -6 : 1 - dow; // hari ke Senin
    const monday = new Date(today);
    monday.setDate(today.getDate() + diff);

    const days = Array.from({ length: 5 }, (_, i) => {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        return localDateStr(d);
    });

    try {
        const results = await Promise.all(
            days.map(d => getMyScheduleForDate(currentUser.user_id, d)
                .then(rows => ({ date: d, rows }))
                .catch(() => ({ date: d, rows: [] }))
            )
        );

        const hasAny = results.some(r => r.rows.length > 0);
        if (!hasAny) {
            contentEl.innerHTML = '<p class="hint">Tidak ada jadwal mengajar minggu ini.</p>';
            return;
        }

        const DAY_NAMES = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat'];
        contentEl.innerHTML = results.map((r, idx) => {
            const dayLabel = `${DAY_NAMES[idx]}, ${fmtDayLabel(r.date).split(',')[1]?.trim() ?? r.date}`;
            if (r.rows.length === 0) {
                return `<div style="margin-bottom:12px">
                    <p style="font-size:0.82rem;font-weight:500;color:var(--color-text-muted);margin:0 0 4px">${esc(dayLabel)}</p>
                    <p class="hint" style="margin:0;font-size:13px">Tidak ada jadwal</p>
                </div>`;
            }
            const dayIsPast = r.date < localDateStr();
            const rowsHtml = r.rows.map(s => `
                <tr>
                    <td>${fmtTime(s.session_start)} – ${fmtTime(s.session_end)}</td>
                    <td>${esc(s.class?.name ?? '—')}</td>
                    <td>
                        <button class="btn ${dayIsPast ? 'btn-secondary' : 'btn-primary'} btn-xs att-open-btn"
                            data-schedule="${s.schedule_id}"
                            data-class="${s.class?.class_id}"
                            data-classname="${esc(s.class?.name ?? '')}"
                            data-ispast="${dayIsPast}">
                            ${dayIsPast ? 'Koreksi Kehadiran' : 'Input Kehadiran'}
                        </button>
                    </td>
                </tr>`).join('');
            return `<div style="margin-bottom:14px">
                <p style="font-size:0.82rem;font-weight:500;color:var(--color-text);margin:0 0 4px">${esc(dayLabel)}</p>
                <div class="table-wrapper">
                <table class="table">
                    <thead><tr><th>Jam</th><th>Kelas</th><th>Kehadiran</th></tr></thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
                </div>
            </div>`;
        }).join('');

        contentEl.querySelectorAll('.att-open-btn').forEach(btn => {
            btn.addEventListener('click', () => openAttModal(btn));
        });
    } catch (err) {
        contentEl.innerHTML = `<p class="hint" style="color:var(--color-danger)">Gagal memuat. ${esc(fe(err))}</p>`;
    }
}

async function loadAttModalContent(scheduleId, classId, className) {
    const panel = document.getElementById('att-modal-body');

    try {
        const [students, existing] = await Promise.all([
            getEnrolledStudents(classId, config.current_academic_year),
            getAttendanceForSession(scheduleId),
        ]);

        if (students.length === 0) {
            panel.innerHTML = '<p class="hint">Tidak ada siswa terdaftar di kelas ini.</p>';
            return;
        }

        const statuses = ['HADIR','IZIN','SAKIT','TIDAK_HADIR'];
        const statusLabel = { HADIR:'Hadir', IZIN:'Izin', SAKIT:'Sakit', TIDAK_HADIR:'Alpa' };

        function renderStudentRow(s) {
            const cur      = existing.get(s.student_id)?.status ?? 'HADIR';
            const curNotes = existing.get(s.student_id)?.notes  ?? '';
            const radios   = statuses.map(st => `
                <label class="att-radio-label">
                    <input type="radio" name="att_${scheduleId}_${s.student_id}"
                           value="${st}" ${cur === st ? 'checked' : ''}
                           onchange="document.getElementById('notes_${scheduleId}_${s.student_id}').style.display=this.value==='IZIN'?'block':'none'">
                    ${statusLabel[st]}
                </label>`).join('');
            return `
                <div class="att-row">
                    <div class="att-name">
                        ${esc(s.full_name)}
                        <span class="att-nis">${esc(s.nis)}</span>
                    </div>
                    <div class="att-radio-group">${radios}</div>
                    <input type="text" id="notes_${scheduleId}_${s.student_id}"
                           class="input att-notes-input"
                           placeholder="Alasan izin (opsional)…"
                           value="${esc(curNotes)}"
                           style="display:${cur === 'IZIN' ? 'block' : 'none'}; margin-top:4px; width:100%; font-size:0.85em">
                </div>`;
        }

        // Kelompokkan per 5 siswa dalam accordion
        const CHUNK = 5;
        const chunks = [];
        for (let i = 0; i < students.length; i += CHUNK)
            chunks.push(students.slice(i, i + CHUNK));

        const accordionHtml = chunks.map((group, idx) => {
            const first = group[0].full_name;
            const last  = group[group.length - 1].full_name;
            const label = group.length === 1 ? first : `${first} … ${last}`;
            return `
                <details ${idx === 0 ? 'open' : ''} class="att-accordion">
                    <summary class="att-accordion-summary">
                        Siswa ${idx * CHUNK + 1}–${idx * CHUNK + group.length}
                        <span class="att-acc-names">${esc(label)}</span>
                    </summary>
                    ${group.map(renderStudentRow).join('')}
                </details>`;
        }).join('');

        panel.innerHTML = `
            ${accordionHtml}
            <div class="att-save-btn">
                <button class="btn btn-success btn-sm att-save" data-schedule="${scheduleId}" data-count="${students.length}">
                    Simpan Kehadiran (${students.length} siswa)
                </button>
                <span class="status-msg" id="att-status-${scheduleId}" style="display:none; margin-left:8px"></span>
            </div>`;

        panel.querySelector('.att-save').addEventListener('click', () => saveAttendance(scheduleId, students));
    } catch (err) {
        panel.innerHTML = `<p class="hint" style="color:var(--color-danger)">Gagal memuat data. ${esc(fe(err))}</p>`;
    }
}

async function saveAttendance(scheduleId, students) {
    const saveBtn  = document.querySelector(`.att-save[data-schedule="${scheduleId}"]`);
    const statusEl = document.getElementById(`att-status-${scheduleId}`);
    saveBtn.disabled = true;
    saveBtn.textContent = 'Menyimpan…';
    statusEl.style.display = 'none';

    try {
        const records = students.map(s => {
            const checked = document.querySelector(`input[name="att_${scheduleId}_${s.student_id}"]:checked`);
            const status  = checked?.value ?? 'HADIR';
            const notesEl = document.getElementById(`notes_${scheduleId}_${s.student_id}`);
            const notes   = status === 'IZIN' ? (notesEl?.value.trim() || null) : null;
            return { student_id: s.student_id, status, source: 'TEACHER_DECLARED', notes };
        });

        // Satu jalur idempoten (online + offline). session_date = tanggal
        // yang sedang dilihat di tab Guru.
        const batch = {
            idempotency_key: crypto.randomUUID(),
            schedule_id:     scheduleId,
            submitted_by:    currentUser.user_id,
            session_date:    document.getElementById('sched-date').value,
            records,
        };

        const result = await saveAttendanceBatch(batch);
        if (result.status === 'synced') {
            statusEl.textContent = `✓ Tersimpan — ${records.length} siswa`;
            statusEl.className   = 'status-msg status-ok';
            statusEl.style.display = 'inline-block';
            await updateSyncBanner();
            setTimeout(() => closeAttModal(), 1200);
        } else if (result.status === 'queued') {
            statusEl.textContent = `⏳ Tersimpan di perangkat — menunggu sinkron (${records.length} siswa)`;
            statusEl.className   = 'status-msg status-warn';
            statusEl.style.display = 'inline-block';
            await updateSyncBanner();
            setTimeout(() => closeAttModal(), 1800);
        } else {
            statusEl.textContent = `✗ ${result.error}`;
            statusEl.className   = 'status-msg status-err';
            statusEl.style.display = 'inline-block';
            await updateSyncBanner();
        }
    } catch (err) {
        statusEl.textContent = `✗ ${fe(err, 's')}`;
        statusEl.className   = 'status-msg status-err';
        statusEl.style.display = 'inline-block';
    } finally {
        saveBtn.disabled    = false;
        saveBtn.textContent = `Simpan Kehadiran (${students.length} siswa)`;
    }
}

// ── Sinkronisasi offline: indikator + flush ───────────────────

async function updateSyncBanner() {
    let el = document.getElementById('sync-banner');
    if (!el) {
        el = document.createElement('div');
        el.id = 'sync-banner';
        el.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2000;padding:8px 14px;' +
            'font-size:13px;text-align:center;display:none;background:var(--color-warning-bg,#fffbeb);' +
            'color:var(--color-warning,#b45309);border-top:1px solid var(--color-warning,#d97706)';
        document.body.appendChild(el);
    }
    let n = 0;
    try { n = await pendingCount(); } catch (_) { n = 0; }
    if (n > 0) {
        el.textContent = navigator.onLine
            ? `⏳ ${n} item menunggu sinkron — menyinkronkan…`
            : `⏳ ${n} item tersimpan di perangkat — akan terkirim saat online`;
        el.style.display = 'block';
    } else {
        el.style.display = 'none';
    }
}

function showSessionExpiredBanner() {
    let el = document.getElementById('sync-banner');
    if (!el) return;
    el.style.background  = 'var(--color-danger-bg,#fef2f2)';
    el.style.color       = 'var(--color-danger,#dc2626)';
    el.style.borderColor = 'var(--color-danger,#dc2626)';
    el.textContent       = '⚠️ Sesi habis — antrian offline ditahan. Login ulang untuk melanjutkan sinkronisasi.';
    el.style.display     = 'block';
}

async function runFlush() {
    try {
        const { synced, remaining, sessionExpired } = await flushPending();
        if (synced > 0) console.log(`[offline] ${synced} item tersinkron`);
        if (sessionExpired) { showSessionExpiredBanner(); return remaining; }
        await updateSyncBanner();
        return remaining;
    } catch (e) { console.warn('[offline] flush gagal:', e); }
}

// ── Observasi ─────────────────────────────────────────────────

let _obsFormInit = false;
async function initObsForm() {
    if (_obsFormInit) return;
    _obsFormInit = true;
    // Load students dari cache dulu agar dropdown siap pakai walau offline
    const stuCacheKey = `mystudents-${currentUser.user_id}`;
    myStudents = LC.get(stuCacheKey) ?? [];
    try {
        const fresh = await getMyStudents(
            currentUser.user_id,
            config.current_academic_year,
            config.current_semester
        );
        myStudents = fresh;
        LC.set(stuCacheKey, fresh);
    } catch (_) { /* pakai cache yang sudah di-load di atas */ }

    const searchEl      = document.getElementById('obs-student-search');
    const hiddenEl      = document.getElementById('obs-student-id');
    const listEl        = document.getElementById('obs-student-list');
    const form          = document.getElementById('obs-form');
    const submitBtn     = document.getElementById('obs-submit');
    const statusEl      = document.getElementById('obs-status');
    const obsContentEl  = document.getElementById('obs-content');
    const obsCharCountEl= document.getElementById('obs-char-count');
    const visSelect     = document.getElementById('obs-visibility');
    const restrictedForm= document.getElementById('obs-restricted-form');
    const formMembersEl = document.getElementById('obs-form-members');
    const formMemberSearch = document.getElementById('obs-form-member-search');
    const formMemberDrop   = document.getElementById('obs-form-member-drop');
    const formMemberMsg    = document.getElementById('obs-form-member-msg');

    obsContentEl.addEventListener('input', () => {
        obsCharCountEl.textContent = obsContentEl.value.length;
    });

    // ── Anggota audiens lokal (RESTRICTED, sebelum simpan) ──
    let pendingMembers = []; // [{ user_id, full_name, role_type }]

    function renderPendingMembers() {
        if (!pendingMembers.length) {
            formMembersEl.innerHTML = '<em style="color:var(--color-text-muted);font-size:12px">Belum ada anggota dipilih.</em>';
            return;
        }
        const OBS_ROLE_LBL = { GURU:'Guru', BK:'BK', WALI_KELAS:'Wali Kelas', KAPRODI:'Kaprodi', WAKA_KESISWAAN:'Waka Kesiswaan', KEPSEK:'Kepala Sekolah' };
        formMembersEl.innerHTML = pendingMembers.map(m =>
            `<span style="display:inline-flex;align-items:center;gap:4px;margin:2px 4px 2px 0;padding:2px 8px;border:1px solid var(--color-border);border-radius:20px;font-size:12px">
                ${esc(m.full_name)} <span style="color:var(--color-text-muted)">(${esc(OBS_ROLE_LBL[m.role_type] ?? m.role_type)})</span>
                <button data-uid="${m.user_id}" style="background:none;border:none;cursor:pointer;color:var(--color-danger);font-size:14px;line-height:1;padding:0 2px" title="Hapus">×</button>
            </span>`
        ).join('');
        formMembersEl.querySelectorAll('button[data-uid]').forEach(btn => {
            btn.addEventListener('click', () => {
                pendingMembers = pendingMembers.filter(m => m.user_id !== btn.dataset.uid);
                renderPendingMembers();
            });
        });
    }

    visSelect.addEventListener('change', () => {
        restrictedForm.style.display = visSelect.value === 'RESTRICTED' ? 'block' : 'none';
        if (visSelect.value !== 'RESTRICTED') { pendingMembers = []; renderPendingMembers(); }
        else renderPendingMembers();
    });

    let formMemberSeq = 0;
    formMemberSearch.addEventListener('input', async () => {
        const q = formMemberSearch.value.trim();
        if (q.length < 2) { formMemberDrop.style.display = 'none'; return; }
        const seq = ++formMemberSeq;
        try {
            const users = await searchInternalUsers(q);
            if (seq !== formMemberSeq) return;
            const filtered = users.filter(u => !pendingMembers.find(m => m.user_id === u.user_id));
            if (!filtered.length) { formMemberDrop.style.display = 'none'; return; }
            formMemberDrop.innerHTML = filtered.map(u =>
                `<div class="obs-form-hit" data-id="${u.user_id}" data-name="${esc(u.full_name)}" data-role="${esc(u.role_type)}"
                     style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--color-border)">
                     ${esc(u.full_name)} <span style="color:var(--color-text-muted);font-size:11px">(${esc(u.role_type)})</span>
                 </div>`
            ).join('');
            formMemberDrop.style.display = 'block';
            formMemberDrop.querySelectorAll('.obs-form-hit').forEach(el => {
                el.addEventListener('mousedown', () => {
                    pendingMembers.push({ user_id: el.dataset.id, full_name: el.dataset.name, role_type: el.dataset.role });
                    formMemberSearch.value = '';
                    formMemberDrop.style.display = 'none';
                    renderPendingMembers();
                });
            });
        } catch(e) { console.error('[obs-member-search]', e); formMemberDrop.style.display = 'none'; }
    });
    document.addEventListener('click', e => {
        if (!formMemberDrop.contains(e.target) && e.target !== formMemberSearch) formMemberDrop.style.display = 'none';
    });

    // Observer berjangkauan luas (BK/Kaprodi/Waka Kesiswaan/Kepsek) bisa
    // mengamati siswa di luar kelas yang ia ajar — bahkan saat tak mengajar
    // sama sekali (myStudents kosong). Untuk mereka, lengkapi daftar dengan
    // pencarian sisi-server (cakupan dibatasi RLS).
    isBroadObserver = jabatan.some(j => ['bk', 'waka_kesiswaan', 'kepsek'].includes(j));

    function renderHits(hits) {
        if (hits.length === 0) { listEl.style.display = 'none'; return; }
        listEl.innerHTML = hits.map(s =>
            `<div class="obs-list-item" data-id="${s.student_id}" data-name="${esc(s.full_name)}"
                style="padding:10px 14px; cursor:pointer; font-size:13px; border-bottom:1px solid var(--color-border)">
                ${esc(s.full_name)} <span style="color:var(--color-text-muted)">${esc(s.nis ?? '')}${s.class_name ? ' · ' + esc(s.class_name) : ''}</span>
            </div>`
        ).join('');
        listEl.style.display = 'block';
        listEl.querySelectorAll('.obs-list-item').forEach(item => {
            item.addEventListener('mousedown', () => {
                hiddenEl.value       = item.dataset.id;
                searchEl.value       = item.dataset.name;
                listEl.style.display = 'none';
            });
        });
    }

    searchEl.addEventListener('input', () => {
        const q = searchEl.value.trim().toLowerCase();
        if (q.length < 2) { listEl.style.display = 'none'; return; }
        const hits = myStudents.filter(s =>
            s.full_name.toLowerCase().includes(q) || s.nis?.includes(q)
        );
        renderHits(hits.slice(0, 10));
    });
    document.addEventListener('click', (e) => {
        if (!listEl.contains(e.target) && e.target !== searchEl) listEl.style.display = 'none';
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!hiddenEl.value) {
            statusEl.style.display = 'block';
            statusEl.style.color = 'var(--color-danger)';
            statusEl.textContent = 'Pilih siswa terlebih dahulu.';
            return;
        }
        const visibility = visSelect.value;
        if (visibility === 'RESTRICTED' && pendingMembers.length === 0) {
            formMemberMsg.textContent = 'Tambahkan minimal satu orang sebelum menyimpan.';
            return;
        }
        formMemberMsg.textContent = '';
        statusEl.style.display = 'none';
        submitBtn.disabled = true;
        submitBtn.textContent = 'Menyimpan…';
        try {
            const r = await insertObservation({
                authorId:   currentUser.user_id,
                studentId:  hiddenEl.value,
                dimension:  document.getElementById('obs-dimension').value,
                sentiment:  document.getElementById('obs-sentiment').value,
                visibility,
                content:    document.getElementById('obs-content').value,
            });
            if (r.status === 'error') throw new Error(r.error);
            // Jika synced dan RESTRICTED, simpan anggota audiens ke DB
            if (r.status === 'synced' && visibility === 'RESTRICTED' && pendingMembers.length) {
                await Promise.all(pendingMembers.map(m =>
                    addObsAudienceMember({ obsId: r.observation_id, userId: m.user_id, schoolId: currentUser.school_id, addedByUserId: currentUser.user_id })
                ));
            }
            statusEl.textContent   = r.status === 'queued'
                ? '⏳ Observasi disimpan lokal — akan dikirim saat online.'
                : '✓ Observasi berhasil disimpan.';
            statusEl.className     = 'status-msg status-ok';
            statusEl.style.display = 'block';
            form.reset();
            hiddenEl.value   = '';
            pendingMembers   = [];
            restrictedForm.style.display = 'none';
            renderPendingMembers();
            if (r.status === 'synced') await loadObsHistory();
        } catch (err) {
            statusEl.textContent   = `✗ ${fe(err, 's')}`;
            statusEl.className     = 'status-msg status-err';
            statusEl.style.display = 'block';
        } finally {
            submitBtn.disabled    = false;
            submitBtn.textContent = 'Simpan Observasi';
        }
    });
}

let _obsTabInit = false;
async function initObsTab() {
    await initObsForm();
    if (!_obsTabInit) {
        _obsTabInit = true;
    }
    await loadObsHistory();
}

async function loadObsHistory() {
    const listEl   = document.getElementById('obs-history-list');
    const cacheKey = `obs-history-${currentUser.user_id}`;
    const cached   = LC.get(cacheKey);
    if (cached) renderObsHistory(cached, listEl);
    else listEl.innerHTML = '<p class="hint">Memuat…</p>';
    try {
        const rows = await getMyObservations(currentUser.user_id);
        LC.set(cacheKey, rows);
        renderObsHistory(rows, listEl);
    } catch (err) {
        if (!cached) listEl.innerHTML = `<p class="hint" style="color:var(--color-danger)">Gagal memuat. ${esc(fe(err))}</p>`;
    }
}

const DIMENSION_LABELS_OBS = { AKADEMIK:'Akademik', KEHADIRAN:'Kehadiran', PERILAKU:'Perilaku', SOSIAL:'Sosial', AFEKTIF:'Afektif', BAKAT_MINAT:'Bakat & Minat', FISIK:'Fisik', LAINNYA:'Lainnya' };
const SENTIMENT_LABELS = { POSITIF:'Positif', NETRAL:'Netral', NEGATIF:'Perlu Perhatian' };
const SENTIMENT_COLOR  = { POSITIF:'var(--color-success)', NETRAL:'var(--color-text-muted)', NEGATIF:'var(--color-danger)' };

const OBS_VIS_LABEL = {
    PRIVATE:    '🔒 Privat',
    RESTRICTED: '👥 Orang Tertentu',
    PUBLIC:     '🌐 Semua Internal',
};

function renderObsHistory(rows, listEl) {
    if (!rows.length) {
        listEl.innerHTML = '<p class="hint">Belum ada observasi yang ditulis.</p>';
        return;
    }
    listEl.innerHTML = rows.map(r => {
        const nama      = r.student?.full_name ?? '—';
        const nis       = r.student?.nis ? ` · ${r.student.nis}` : '';
        const dim       = DIMENSION_LABELS_OBS[r.dimension] ?? r.dimension;
        const sent      = SENTIMENT_LABELS[r.sentiment]  ?? r.sentiment;
        const sentColor = SENTIMENT_COLOR[r.sentiment] ?? 'inherit';
        const vis       = r.visibility ?? 'PUBLIC';
        const visLabel  = OBS_VIS_LABEL[vis] ?? vis;
        const visColor  = vis === 'PUBLIC' ? 'var(--color-success,#4ade80)'
                        : vis === 'RESTRICTED' ? 'var(--color-info,#60a5fa)'
                        : 'var(--color-text-muted)';
        return `
        <div data-obs-id="${esc(r.observation_id)}" data-obs-vis="${esc(vis)}"
             style="border-bottom:0.5px solid var(--color-border);padding:10px 0;font-size:13px">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:4px">
                <strong>${esc(nama)}<span style="font-weight:400;color:var(--color-text-muted)">${esc(nis)}</span></strong>
                <span style="font-size:11px;color:var(--color-text-muted)">${fmt(r.observed_at)}</span>
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;align-items:center">
                <span style="font-size:11px;padding:2px 8px;border-radius:20px;background:var(--color-bg-alt,#f3f4f6)">${esc(dim)}</span>
                <span style="font-size:11px;padding:2px 8px;border-radius:20px;color:${sentColor};background:var(--color-bg-alt,#f3f4f6)">${esc(sent)}</span>
                <span class="obs-vis-badge" style="font-size:11px;padding:2px 8px;border-radius:20px;color:${visColor};background:var(--color-bg-alt,#f3f4f6);cursor:pointer" title="Klik untuk ubah visibilitas">${visLabel}</span>
            </div>
            <p style="margin:0 0 6px;white-space:pre-wrap;color:var(--color-text)">${esc(r.content)}</p>
            <div class="obs-vis-panel" style="display:none;margin-top:8px;padding:10px;border-radius:6px;background:var(--color-bg-alt,#2a3145)">
                <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap">
                    ${['PRIVATE','RESTRICTED','PUBLIC'].map(a =>
                        `<button class="btn btn-sm obs-vis-btn ${a === vis ? 'btn-primary' : 'btn-secondary'}" data-vis="${a}">${OBS_VIS_LABEL[a]}</button>`
                    ).join('')}
                </div>
                <div class="obs-vis-err" style="font-size:11px;color:var(--color-danger);margin-bottom:4px"></div>
                <div class="obs-restricted-panel" style="display:${vis === 'RESTRICTED' ? 'block' : 'none'}">
                    <div style="font-size:12px;margin-bottom:6px;color:var(--color-text-muted)">Anggota yang bisa melihat:</div>
                    <div class="obs-members-list" style="margin-bottom:6px;font-size:12px"></div>
                    <div style="position:relative">
                        <input type="text" class="input obs-member-search" placeholder="Cari nama staf…" style="font-size:12px;padding:6px 10px" autocomplete="off">
                        <div class="obs-member-drop" style="display:none;position:absolute;top:100%;left:0;right:0;background:var(--color-surface,#1e2330);border:1px solid var(--color-border);border-radius:6px;z-index:50;max-height:160px;overflow-y:auto"></div>
                    </div>
                    <div class="obs-audience-msg" style="font-size:11px;margin-top:4px;color:var(--color-danger)"></div>
                </div>
            </div>
        </div>`;
    }).join('');

    // Wire up interactivity for each observation card
    listEl.querySelectorAll('[data-obs-id]').forEach(card => {
        const obsId     = card.dataset.obsId;
        let   curVis    = card.dataset.obsVis;
        const badge     = card.querySelector('.obs-vis-badge');
        const panel     = card.querySelector('.obs-vis-panel');
        const rPanel    = card.querySelector('.obs-restricted-panel');
        const mList     = card.querySelector('.obs-members-list');
        const mSearch   = card.querySelector('.obs-member-search');
        const mDrop     = card.querySelector('.obs-member-drop');
        const mMsg      = card.querySelector('.obs-audience-msg');
        const visErrEl  = card.querySelector('.obs-vis-err'); // Bug 2: error visibilitas terpisah

        badge.addEventListener('click', () => {
            const open = panel.style.display !== 'none';
            panel.style.display = open ? 'none' : 'block';
            if (!open && curVis === 'RESTRICTED') loadObsMembers();
        });

        const OBS_ROLE_LABEL = { GURU:'Guru', BK:'BK', WALI_KELAS:'Wali Kelas', KAPRODI:'Kaprodi', WAKA_KESISWAAN:'Waka Kesiswaan', KEPSEK:'Kepala Sekolah' };

        card.querySelectorAll('.obs-vis-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const newVis = btn.dataset.vis;
                if (newVis === curVis) return;
                visErrEl.style.color = ''; visErrEl.textContent = 'Menyimpan…';
                try {
                    await updateObsVisibility({ obsId, visibility: newVis });
                    curVis = newVis;
                    card.dataset.obsVis = newVis;
                    LC.remove(`obs-history-${currentUser.user_id}`);
                    const newColor = newVis === 'PUBLIC' ? 'var(--color-success,#4ade80)'
                                   : newVis === 'RESTRICTED' ? 'var(--color-info,#60a5fa)'
                                   : 'var(--color-text-muted)';
                    badge.textContent = OBS_VIS_LABEL[newVis];
                    badge.style.color = newColor;
                    card.querySelectorAll('.obs-vis-btn').forEach(b => {
                        b.className = `btn btn-sm obs-vis-btn ${b.dataset.vis === newVis ? 'btn-primary' : 'btn-secondary'}`;
                    });
                    rPanel.style.display = newVis === 'RESTRICTED' ? 'block' : 'none';
                    if (newVis === 'RESTRICTED') loadObsMembers();
                    // [1] Pesan sukses dulu (seperti kasus), lalu reload
                    visErrEl.style.color = 'var(--color-success,#4ade80)';
                    visErrEl.textContent = `Visibilitas diubah ke: ${OBS_VIS_LABEL[newVis]}.`;
                    await loadObsHistory();
                } catch (err) {
                    visErrEl.style.color = 'var(--color-danger)';
                    visErrEl.textContent = fe(err);
                }
            });
        });

        async function loadObsMembers() {
            mList.textContent = 'Memuat…';
            try {
                const members = await getObsAudienceMembers(obsId);
                if (!members.length) {
                    mList.innerHTML = '<em style="color:var(--color-text-muted)">Belum ada anggota khusus.</em>';
                } else {
                    // [3+4] Nama + peran, chip inline dengan × seperti kasus
                    mList.innerHTML = members.map(m => {
                        const name = m.users?.full_name ?? m.user_id;
                        const role = OBS_ROLE_LABEL[m.users?.role_type] ?? m.users?.role_type ?? '';
                        return `<span style="display:inline-flex;align-items:center;gap:4px;margin:2px 4px 2px 0;padding:2px 8px;border:1px solid var(--color-border);border-radius:20px;font-size:12px">
                            ${esc(name)} <span style="color:var(--color-text-muted)">(${esc(role)})</span>
                            <button data-uid="${m.user_id}" style="background:none;border:none;cursor:pointer;color:var(--color-danger);font-size:14px;line-height:1;padding:0 2px" title="Hapus">×</button>
                        </span>`;
                    }).join('');
                    mList.querySelectorAll('button[data-uid]').forEach(btn => {
                        btn.addEventListener('click', async () => {
                            try {
                                await removeObsAudienceMember({ obsId, userId: btn.dataset.uid });
                                await loadObsMembers();
                            } catch (err) { mMsg.textContent = fe(err); }
                        });
                    });
                }
            } catch (err) { mList.textContent = fe(err); }
        }

        let obsSearchSeq = 0;
        mSearch?.addEventListener('input', async () => {
            const q = mSearch.value.trim();
            if (q.length < 2) { mDrop.style.display = 'none'; return; }
            const seq = ++obsSearchSeq;
            try {
                const users = await searchInternalUsers(q);
                if (seq !== obsSearchSeq) return;
                if (!users.length) { mDrop.style.display = 'none'; return; }
                mDrop.innerHTML = users.map(u =>
                    `<div class="obs-member-hit" data-id="${u.user_id}" data-name="${esc(u.full_name)}"
                         style="padding:8px 12px;cursor:pointer;font-size:12px;border-bottom:1px solid var(--color-border)">
                         ${esc(u.full_name)}
                     </div>`
                ).join('');
                mDrop.style.display = 'block';
                mDrop.querySelectorAll('.obs-member-hit').forEach(el => {
                    el.addEventListener('mousedown', async () => {
                        mDrop.style.display = 'none';
                        mSearch.value = '';
                        try {
                            await addObsAudienceMember({ obsId, userId: el.dataset.id, schoolId: currentUser.school_id, addedByUserId: currentUser.user_id });
                            await loadObsMembers();
                        } catch (err) { mMsg.textContent = fe(err); }
                    });
                });
            } catch { mDrop.style.display = 'none'; }
        });
    });

    // Bug 1: listener didaftarkan sekali (flag modul) — tidak menumpuk tiap re-render
    if (!renderObsHistory._clickBound) {
        renderObsHistory._clickBound = true;
        document.addEventListener('click', e => {
            document.querySelectorAll('#obs-history-list .obs-member-drop').forEach(drop => {
                const search = drop.closest('[data-obs-id]')?.querySelector('.obs-member-search');
                if (!drop.contains(e.target) && e.target !== search) drop.style.display = 'none';
            });
        });
    }
}

// ─── TAB WALI KELAS ──────────────────────────────────────────

async function initWaliTab() {
    const classId = currentUser.wali_kelas_class_id;
    if (!classId) return;

    const info = await getWaliKelasInfo(classId);
    document.getElementById('wali-class-title').textContent =
        `Kelas Walian — ${info?.name ?? ''}`;

    const today    = localDateStr();
    const monthAgo = localDateStr(new Date(Date.now() - 30 * 86400000));
    document.getElementById('wali-date-start').value = monthAgo;
    document.getElementById('wali-date-end').value   = today;

    document.getElementById('wali-filter-btn').onclick = loadWaliSummary;
    await loadWaliSummary();
}

async function loadWaliSummary() {
    const classId = currentUser.wali_kelas_class_id;
    const start   = document.getElementById('wali-date-start').value;
    const end     = document.getElementById('wali-date-end').value;
    const tbody   = document.getElementById('wali-att-body');
    const emptyEl = document.getElementById('wali-empty');
    tbody.innerHTML = '<tr><td colspan="6" class="hint">Memuat…</td></tr>';
    emptyEl.style.display = 'none';

    try {
        const rows = await getWaliAttendanceSummary(classId, config.current_academic_year, start, end);
        if (rows.length === 0) {
            tbody.innerHTML = '';
            emptyEl.style.display = 'block';
            return;
        }
        tbody.innerHTML = rows.map(r => {
            const pctDenom = r.HADIR + r.IZIN + r.TIDAK_HADIR;
            const pct   = pctDenom > 0 ? Math.round(r.HADIR / pctDenom * 100) : 0;
            const color = pct >= 80 ? 'var(--color-success)' : pct >= 60 ? 'var(--color-warning,#f59e0b)' : 'var(--color-danger)';
            return `<tr>
                <td><span style="font-weight:500">${esc(r.full_name)}</span><br><span style="font-size:0.78rem;color:var(--color-text-muted,#9ca3af)">${esc(r.nis)}</span></td>
                <td style="text-align:center">${r.HADIR}</td>
                <td style="text-align:center">${r.IZIN}</td>
                <td style="text-align:center">${r.SAKIT}</td>
                <td style="text-align:center">${r.TIDAK_HADIR}</td>
                <td style="text-align:center;font-weight:600;color:${color}">${r.total > 0 ? pct + '%' : '—'}</td>
            </tr>`;
        }).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="6" style="color:var(--color-danger)">${esc(fe(err))}</td></tr>`;
    }
}

// ─── TAB BK ──────────────────────────────────────────────────

async function initBkTab() {
    const hintEl = document.getElementById('bk-obs-hint');
    const listEl = document.getElementById('bk-obs-list');
    hintEl.textContent = 'Memuat observasi…';
    listEl.innerHTML = '';

    try {
        const { data, error } = await supabase
            .from('observations')
            .select(`observation_id, sentiment, dimension, content, observed_at, created_at,
                student:students(full_name, nis),
                author:users!observations_author_user_id_fkey(full_name)`)
            .order('created_at', { ascending: false })
            .limit(100);
        if (error) throw error;

        if (!data?.length) { hintEl.textContent = 'Belum ada observasi.'; return; }
        hintEl.style.display = 'none';
        listEl.innerHTML = data.map(r => `
            <div class="obs-card obs-${(r.sentiment ?? '').toLowerCase()}">
                <div class="obs-meta">
                    <strong>${esc(r.student?.full_name ?? '—')}</strong> (${esc(r.student?.nis ?? '—')})
                    &middot; ${esc(DIMENSION_LABELS[r.dimension] ?? r.dimension)}
                    &middot; oleh ${esc(r.author?.full_name ?? '—')}
                    &middot; ${fmt(r.observed_at ?? r.created_at)}
                </div>
                <p class="obs-content">${esc(r.content)}</p>
            </div>`).join('');
    } catch (err) {
        hintEl.textContent = `Gagal memuat data. ${fe(err)}`;
    }
}

// ─── TAB WAKA KESISWAAN ──────────────────────────────────────

async function initWakaKesiswaanTab() {
    const today        = localDateStr();
    const firstOfMonth = today.slice(0, 8) + '01';
    document.getElementById('wk-att-start').value = firstOfMonth;
    document.getElementById('wk-att-end').value   = today;
    document.getElementById('wk-att-filter-btn').onclick = loadWkAttendanceRecap;

    await Promise.all([
        loadWkAttendanceRecap(),
        loadWkObservations(),
        loadWkOpenCases(),
    ]);
}

async function loadWkAttendanceRecap() {
    const dateStart = document.getElementById('wk-att-start').value;
    const dateEnd   = document.getElementById('wk-att-end').value;
    const tbody     = document.getElementById('wk-att-body');
    const emptyEl   = document.getElementById('wk-att-empty');
    tbody.innerHTML = '<tr><td colspan="7" class="hint">Memuat…</td></tr>';
    emptyEl.style.display = 'none';

    try {
        const rows = await getAttendanceRecapPerClass(dateStart || null, dateEnd || null);
        if (rows.length === 0) {
            tbody.innerHTML = '';
            emptyEl.style.display = 'block';
            return;
        }
        tbody.innerHTML = rows.map(r => {
            const pctDenom = r.HADIR + r.IZIN + r.TIDAK_HADIR;
            const pct   = pctDenom > 0 ? Math.round(r.HADIR / pctDenom * 100) : 0;
            const color = pct >= 80 ? 'var(--color-success)' : pct >= 60 ? 'var(--color-warning,#f59e0b)' : 'var(--color-danger)';
            return `<tr class="wk-class-row" data-class-id="${esc(r.class_id)}" data-class-name="${esc(r.name)}" style="cursor:pointer" title="Klik untuk lihat detail siswa">
                <td style="color:var(--color-primary,#4ade80)">${esc(r.name)}</td>
                <td style="text-align:center">${r.HADIR}</td>
                <td style="text-align:center">${r.IZIN}</td>
                <td style="text-align:center">${r.SAKIT}</td>
                <td style="text-align:center">${r.TIDAK_HADIR}</td>
                <td style="text-align:center">${r.total}</td>
                <td style="text-align:center;font-weight:600;color:${color}">${r.total > 0 ? pct + '%' : '—'}</td>
            </tr>`;
        }).join('');

        tbody.querySelectorAll('tr.wk-class-row').forEach(tr => {
            tr.addEventListener('click', () => wkOpenClassModal(tr, dateStart, dateEnd));
        });

        // Setup tombol tutup & backdrop
        const modal = document.getElementById('wk-class-modal');
        document.getElementById('wk-modal-close').onclick = () => { modal.style.display = 'none'; };
        modal.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" style="color:var(--color-danger)">${esc(fe(err))}</td></tr>`;
    }
}

async function wkOpenClassModal(tr, dateStart, dateEnd) {
    const classId   = tr.dataset.classId;
    const className = tr.dataset.className;
    const modal     = document.getElementById('wk-class-modal');
    const title     = document.getElementById('wk-modal-title');
    const body      = document.getElementById('wk-modal-body');

    title.textContent = `Detail Kehadiran — ${className}`;
    body.innerHTML = '<p class="hint">Memuat detail siswa…</p>';
    modal.style.display = '';

    try {
        const students = await getWaliAttendanceSummary(classId, config.current_academic_year, dateStart || null, dateEnd || null);
        if (students.length === 0) {
            body.innerHTML = '<p class="hint">Belum ada data kehadiran siswa pada rentang ini.</p>';
            return;
        }
        const tableRows = students.map(s => {
            const pctDenom = s.HADIR + s.IZIN + s.TIDAK_HADIR;
            const pct   = pctDenom > 0 ? Math.round(s.HADIR / pctDenom * 100) : 0;
            const color = pct >= 80 ? 'var(--color-success)' : pct >= 60 ? 'var(--color-warning,#f59e0b)' : 'var(--color-danger)';
            return `<tr>
                <td><span style="font-weight:500">${esc(s.full_name)}</span><br><span style="font-size:0.78rem;color:var(--color-text-muted,#9ca3af)">${esc(s.nis)}</span></td>
                <td style="text-align:center">${s.HADIR}</td>
                <td style="text-align:center">${s.IZIN}</td>
                <td style="text-align:center">${s.SAKIT}</td>
                <td style="text-align:center">${s.TIDAK_HADIR}</td>
                <td style="text-align:center">${s.total}</td>
                <td style="text-align:center;font-weight:600;color:${color}">${pctDenom > 0 ? pct + '%' : '—'}</td>
            </tr>`;
        }).join('');
        body.innerHTML = `
            <div class="table-wrapper">
            <table class="table" style="margin:0">
                <thead><tr>
                    <th>Nama / NIS</th>
                    <th style="text-align:center">Hadir</th><th style="text-align:center">Izin</th>
                    <th style="text-align:center">Sakit</th><th style="text-align:center">Alpa</th>
                    <th style="text-align:center">Total Sesi</th><th style="text-align:center">% Hadir</th>
                </tr></thead>
                <tbody>${tableRows}</tbody>
            </table>
            </div>`;
    } catch (err) {
        body.innerHTML = `<p style="color:var(--color-danger)">${esc(fe(err))}</p>`;
    }
}

async function loadWkObservations() {
    const hintEl = document.getElementById('wk-obs-hint');
    const listEl = document.getElementById('wk-obs-list');
    hintEl.textContent = 'Memuat…';
    listEl.innerHTML = '';

    try {
        const { data, error } = await supabase
            .from('observations')
            .select(`observation_id, sentiment, dimension, content, observed_at, created_at,
                student:students(full_name, nis),
                author:users!observations_author_user_id_fkey(full_name)`)
            .eq('school_id', currentUser.school_id)
            .order('created_at', { ascending: false })
            .limit(50);
        if (error) throw error;

        if (!data?.length) { hintEl.textContent = 'Belum ada observasi.'; return; }
        hintEl.style.display = 'none';
        listEl.innerHTML = data.map(r => `
            <div class="obs-card obs-${(r.sentiment ?? '').toLowerCase()}">
                <div class="obs-meta">
                    <strong>${esc(r.student?.full_name ?? '—')}</strong> (${esc(r.student?.nis ?? '—')})
                    &middot; ${esc(DIMENSION_LABELS[r.dimension] ?? r.dimension)}
                    &middot; oleh ${esc(r.author?.full_name ?? '—')}
                    &middot; ${fmt(r.observed_at ?? r.created_at)}
                </div>
                <p class="obs-content">${esc(r.content)}</p>
            </div>`).join('');
    } catch (err) {
        hintEl.textContent = `Gagal memuat data. ${fe(err)}`;
    }
}

const HANDLER_ROLE_LABELS = {
    GURU: 'Guru', WALI_KELAS: 'Wali Kelas', BK: 'BK', KAPRODI: 'Kaprodi',
    KEPSEK: 'Kepala Sekolah', WAKA_KESISWAAN: 'Waka Kesiswaan',
    WAKA_KURIKULUM: 'Waka Kurikulum', DUDI: 'DUDI',
};

async function loadWkOpenCases() {
    const tbody   = document.getElementById('wk-cases-body');
    const emptyEl = document.getElementById('wk-cases-empty');
    tbody.innerHTML = '<tr><td colspan="4" class="hint">Memuat…</td></tr>';
    emptyEl.style.display = 'none';

    try {
        const rows = await getOpenCases(currentUser.school_id);
        if (rows.length === 0) {
            tbody.innerHTML = '';
            emptyEl.style.display = 'block';
            return;
        }
        tbody.innerHTML = rows.map(c => `<tr>
            <td>${esc(c.student?.full_name ?? '—')} (${esc(c.student?.nis ?? '—')})</td>
            <td>${esc(c.title)}</td>
            <td>${esc(HANDLER_ROLE_LABELS[c.current_handler_role] ?? c.current_handler_role ?? '—')}</td>
            <td>${fmt(c.created_at)}</td>
        </tr>`).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="4" style="color:var(--color-danger)">${esc(fe(err))}</td></tr>`;
    }
}

// ─── TAB KAPRODI ─────────────────────────────────────────────

async function initKaprodiTab() {
    const programId = currentUser.kaprodi_program_id ??
        (currentUser.role_type === 'KAPRODI' ? currentUser.program_id : null);
    kpProgramId = programId;
    if (!programId) {
        document.getElementById('tab-kaprodi').querySelector('.page-body').innerHTML =
            '<div class="section-card"><p class="hint">Akun ini belum terhubung ke program keahlian. Hubungi admin.</p></div>';
        return;
    }

    try {
        const [program, students, aktifStudents, dudi] = await Promise.all([
            getProgram(programId),
            fetchPklStudents(programId),
            fetchNonPklStudents(programId),
            fetchDudiPartners(programId),
        ]);
        kpStudents = students;
        kpDudiList = dudi;
        kpAktifStudents = aktifStudents;

        // Gabung PKL + aktif untuk pool pencarian siswa (Observasi & Buat Kasus)
        const seen = new Set(kpStudents.map(s => s.student_id));
        kaprodiAllStudents = [...kpStudents, ...kpAktifStudents.filter(s => !seen.has(s.student_id))];

        renderKpSummary();
        renderKpStudents();
        renderKpDudi();

        const today    = localDateStr();
        const monthAgo = localDateStr(new Date(Date.now() - 30*86400000));

        document.getElementById('kp-date-start').value  = monthAgo;
        document.getElementById('kp-date-end').value    = today;
        document.getElementById('kp-cls-start').value   = monthAgo;
        document.getElementById('kp-cls-end').value     = today;

        document.getElementById('kp-filter-btn').onclick     = loadKpRecap;
        document.getElementById('kp-cls-filter-btn').onclick = loadKpClsRecap;

        document.getElementById('kp-students-body').addEventListener('click', e => {
            const btn = e.target.closest('.kp-finish-btn');
            if (btn) handleFinishPkl(btn);
        });

        await Promise.all([loadKpRecap(), loadKpClsRecap(), loadKpObs(), initKpPlacementForm(programId)]);
    } catch (err) {
        console.error('[kaprodi]', err);
    }
}

function renderKpSummary() {
    const placed = kpStudents.filter(s => s.has_placement).length;
    document.getElementById('kp-stat-total').textContent   = kpStudents.length;
    document.getElementById('kp-stat-placed').textContent  = placed;
    document.getElementById('kp-stat-unplaced').textContent = kpStudents.length - placed;
}

function renderKpStudents() {
    const tbody = document.getElementById('kp-students-body');
    const thead = tbody.closest('table').querySelector('thead tr');
    const empty = document.getElementById('kp-students-empty');

    // Pastikan kolom Aksi ada di header
    if (!thead.querySelector('th[data-aksi]')) {
        const th = document.createElement('th');
        th.dataset.aksi = '1';
        th.textContent = 'Aksi';
        thead.appendChild(th);
    }

    if (kpStudents.length === 0) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
    empty.style.display = 'none';
    tbody.innerHTML = kpStudents.map(s => `<tr>
        <td>${esc(s.full_name)}</td><td>${esc(s.nis)}</td>
        <td>${esc(s.dudi_name)}</td>
        <td>${s.has_placement ? `${fmt(s.start_date)} – ${fmt(s.end_date)}` : '<span class="badge badge-tidak-hadir">Belum</span>'}</td>
        <td>${s.has_placement
            ? `<button class="btn btn-sm btn-secondary kp-finish-btn"
                data-student-id="${esc(s.student_id)}"
                data-placement-id="${esc(s.placement_id)}"
                data-nama="${esc(s.full_name)}"
                style="font-size:11px;padding:3px 8px">Selesaikan PKL</button>`
            : '—'}</td>
    </tr>`).join('');
}

async function handleFinishPkl(btn) {
    const { studentId, placementId, nama } = btn.dataset;
    if (!confirm(`Selesaikan PKL ${nama}? Status akan kembali ke AKTIF.`)) return;
    btn.disabled = true; btn.textContent = 'Memproses…';
    try {
        await finishPlacement(studentId, placementId);
        kpStudents = await fetchPklStudents(kpProgramId);
        const seen = new Set(kpStudents.map(s => s.student_id));
        kpAktifStudents = [...kpAktifStudents.filter(s => !seen.has(s.student_id))];
        renderKpSummary();
        renderKpStudents();
        // Reload dropdown siswa di form penempatan
        const sel = document.getElementById('kp-pl-student');
        if (sel) {
            const nonPkl = await fetchNonPklStudents(kpProgramId).catch(() => []);
            sel.innerHTML = '<option value="">-- Pilih siswa --</option>';
            nonPkl.forEach(s => {
                const o = document.createElement('option');
                o.value = s.student_id; o.textContent = `${s.full_name} (${s.nis})`;
                sel.appendChild(o);
            });
        }
    } catch (err) {
        btn.disabled = false; btn.textContent = 'Selesaikan PKL';
        alert(`Gagal: ${fe(err)}`);
    }
}

function renderKpDudi() {
    const tbody = document.getElementById('kp-dudi-body');
    const empty = document.getElementById('kp-dudi-empty');
    if (kpDudiList.length === 0) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
    empty.style.display = 'none';
    tbody.innerHTML = kpDudiList.map(d => `<tr>
        <td>${esc(d.org_name)}</td><td>${esc(d.pic_name)}</td>
    </tr>`).join('');
}

async function loadKpRecap() {
    const ids   = kpStudents.map(s => s.student_id);
    const start = document.getElementById('kp-date-start').value;
    const end   = document.getElementById('kp-date-end').value;
    const tbody = document.getElementById('kp-recap-body');
    const empty = document.getElementById('kp-recap-empty');
    tbody.innerHTML = '<tr><td colspan="7" class="hint">Memuat…</td></tr>';
    empty.style.display = 'none';

    if (ids.length === 0) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
    try {
        const rows = await fetchPklAttendance(ids, start, end);
        const byStudent = new Map(kpStudents.map(s => [s.student_id, { name: s.full_name, nis: s.nis, HADIR:0, TIDAK_HADIR:0, IZIN:0, SAKIT:0, total:0 }]));
        for (const r of rows) {
            const a = byStudent.get(r.student_id);
            if (!a) continue;
            if (a[r.status] !== undefined) a[r.status]++;
            a.total++;
        }
        const recap = [...byStudent.values()];
        if (recap.every(a => a.total === 0)) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
        tbody.innerHTML = recap.map(a => {
            const pct   = a.total > 0 ? Math.round(a.HADIR / a.total * 100) : 0;
            const color = pct >= 80 ? 'var(--color-success)' : pct >= 60 ? 'var(--color-warning,#f59e0b)' : 'var(--color-danger)';
            return `<tr>
                <td><span style="font-weight:500">${esc(a.name)}</span><br><span style="font-size:0.78rem;color:var(--color-text-muted,#9ca3af)">${esc(a.nis ?? '—')}</span></td>
                <td style="text-align:center">${a.HADIR}</td>
                <td style="text-align:center">${a.IZIN}</td>
                <td style="text-align:center">${a.SAKIT}</td>
                <td style="text-align:center">${a.TIDAK_HADIR}</td>
                <td style="text-align:center">${a.total}</td>
                <td style="text-align:center;font-weight:600;color:${color}">${a.total > 0 ? pct+'%' : '—'}</td>
            </tr>`;
        }).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" style="color:var(--color-danger)">${esc(fe(err))}</td></tr>`;
    }
}

async function loadKpClsRecap() {
    const start = document.getElementById('kp-cls-start').value;
    const end   = document.getElementById('kp-cls-end').value;
    const tbody = document.getElementById('kp-cls-recap-body');
    const empty = document.getElementById('kp-cls-recap-empty');
    tbody.innerHTML = '<tr><td colspan="8" class="hint">Memuat…</td></tr>';
    empty.style.display = 'none';

    if (!kpAktifStudents.length) {
        tbody.innerHTML = '';
        empty.style.display = 'block';
        return;
    }
    try {
        const rows = await getAttendanceSummaryByStudents(kpAktifStudents, start || null, end || null);
        if (rows.every(r => r.total === 0)) {
            tbody.innerHTML = '';
            empty.style.display = 'block';
            return;
        }
        tbody.innerHTML = rows.map(s => {
            const pct   = s.total > 0 ? Math.round(s.HADIR / s.total * 100) : 0;
            const color = pct >= 80 ? 'var(--color-success)' : pct >= 60 ? 'var(--color-warning,#f59e0b)' : 'var(--color-danger)';
            return `<tr>
                <td><span style="font-weight:500">${esc(s.full_name)}</span><br><span style="font-size:0.78rem;color:var(--color-text-muted,#9ca3af)">${esc(s.nis)}</span></td>
                <td style="text-align:center">${s.HADIR}</td>
                <td style="text-align:center">${s.IZIN}</td>
                <td style="text-align:center">${s.SAKIT}</td>
                <td style="text-align:center">${s.TIDAK_HADIR}</td>
                <td style="text-align:center">${s.total}</td>
                <td style="text-align:center;font-weight:600;color:${color}">${s.total > 0 ? pct + '%' : '—'}</td>
            </tr>`;
        }).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" style="color:var(--color-danger)">${esc(fe(err))}</td></tr>`;
    }
}

async function loadKpObs() {
    const ids    = kpStudents.map(s => s.student_id);
    const hintEl = document.getElementById('kp-obs-hint');
    const listEl = document.getElementById('kp-obs-list');
    listEl.innerHTML = '';
    if (ids.length === 0) { hintEl.style.display = 'block'; return; }
    try {
        const rows = await fetchDudiObservations(ids);
        if (rows.length === 0) { hintEl.style.display = 'block'; return; }
        hintEl.style.display = 'none';
        const nameById = new Map(kpStudents.map(s => [s.student_id, s.full_name]));
        listEl.innerHTML = rows.map(r => `
            <div class="obs-card obs-${r.sentiment.toLowerCase()}">
                <div class="obs-meta"><strong>${esc(nameById.get(r.student_id) ?? '—')}</strong>
                    &middot; ${esc(r.author)} &middot; ${DIMENSION_LABELS[r.dimension] ?? r.dimension} &middot; ${fmt(r.date)}
                </div>
                <p class="obs-content">${esc(r.content)}</p>
            </div>`).join('');
    } catch (err) {
        listEl.innerHTML = `<p class="hint" style="color:var(--color-danger)">${esc(fe(err))}</p>`;
    }
}

async function initKpPlacementForm(programId) {
    // Isi dropdown siswa belum PKL
    async function reloadStudentSelect() {
        const el = document.getElementById('kp-pl-student');
        el.innerHTML = '<option value="">-- Pilih siswa --</option>';
        const nonPkl = await fetchNonPklStudents(programId).catch(() => []);
        nonPkl.forEach(s => {
            const o = document.createElement('option');
            o.value = s.student_id; o.textContent = `${s.full_name} (${s.nis})`;
            el.appendChild(o);
        });
    }
    function populateDudiSelect() {
        const el = document.getElementById('kp-pl-dudi');
        el.innerHTML = '<option value="">-- Pilih DUDI --</option>';
        kpDudiList.forEach(d => {
            const o = document.createElement('option');
            o.value = d.user_id; o.textContent = d.org_name;
            el.appendChild(o);
        });
    }
    await reloadStudentSelect();
    populateDudiSelect();

    document.getElementById('kp-placement-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const resultEl = document.getElementById('kp-placement-result');
        const btn = document.getElementById('kp-pl-submit');
        btn.disabled = true; btn.textContent = 'Menyimpan…';
        resultEl.innerHTML = '';
        try {
            await createPlacement({
                studentId:  document.getElementById('kp-pl-student').value,
                dudiUserId: document.getElementById('kp-pl-dudi').value,
                startDate:  document.getElementById('kp-pl-start').value,
                endDate:    document.getElementById('kp-pl-end').value,
            });
            resultEl.innerHTML = '<p style="color:var(--color-success)">✓ Penempatan berhasil disimpan.</p>';
            kpStudents = await fetchPklStudents(programId);
            renderKpSummary(); renderKpStudents();
            await reloadStudentSelect();
        } catch (err) {
            resultEl.innerHTML = `<p style="color:var(--color-danger)">✗ ${esc(fe(err))}</p>`;
        } finally {
            btn.disabled = false; btn.textContent = 'Simpan Penempatan';
        }
    });

    document.getElementById('kp-dl-template').addEventListener('click', () => {
        const csv = 'nis,login_dudi,tanggal_mulai,tanggal_selesai\n12345,cv-maju-bersama,2027-07-01,2027-09-30\n';
        const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([csv], { type:'text/csv' })), download:'template_penempatan_pkl.csv' });
        a.click();
    });

    const fileInput = document.getElementById('kp-file-input');
    document.getElementById('kp-import-btn').onclick = () => fileInput.click();
    fileInput.addEventListener('change', async () => {
        const file = fileInput.files[0];
        if (!file) return;
        const resultEl = document.getElementById('kp-placement-result');
        resultEl.innerHTML = '<p class="hint">Mengimpor…</p>';
        try {
            if (!file.name.endsWith('.csv')) throw new Error('Gunakan format CSV.');
            const csv = await file.text();
            const result = await bulkImportPkl(csv);
            resultEl.innerHTML = `<p style="color:var(--color-success)">✓ Selesai — ${result.success} berhasil, ${result.skipped} dilewati, ${result.failed} gagal.</p>`;
            kpStudents = await fetchPklStudents(programId);
            renderKpSummary(); renderKpStudents();
            await reloadStudentSelect();
        } catch (err) {
            resultEl.innerHTML = `<p style="color:var(--color-danger)">✗ ${esc(fe(err))}</p>`;
        } finally {
            fileInput.value = '';
        }
    });
}

// ─── TAB WAKA KURIKULUM ───────────────────────────────────────

async function initWakaKurTab() {
    const hintEl = document.getElementById('waka-kur-hint');
    const tableEl = document.getElementById('waka-kur-table');
    const tbody   = document.getElementById('waka-kur-body');
    hintEl.textContent = 'Memuat data hari ini…';
    tableEl.style.display = 'none';

    try {
        const rows = await getAbsentTeachersToday();
        if (rows.length === 0) {
            hintEl.textContent = '✓ Tidak ada guru tidak hadir hari ini.';
            return;
        }
        hintEl.style.display = 'none';
        tableEl.style.display = '';
        tbody.innerHTML = rows.map(r => `<tr>
            <td>${esc(r.teacher?.full_name ?? '—')}</td>
            <td>${esc(r.class?.name ?? '—')}</td>
            <td>${fmtTime(r.session_start)} – ${fmtTime(r.session_end)}</td>
        </tr>`).join('');
    } catch (err) {
        hintEl.textContent = `Gagal memuat data. ${fe(err)}`;
    }
}

// ─── TAB WAKA HUMAS ──────────────────────────────────────────

let whStudents = [];
let whDudiList = [];
let _whTabInit = false;

async function initWakaHumasTab() {
    if (_whTabInit) return;
    _whTabInit = true;

    const today    = localDateStr();
    const monthAgo = localDateStr(new Date(Date.now() - 30*86400000));
    document.getElementById('wh-date-start').value = monthAgo;
    document.getElementById('wh-date-end').value   = today;
    document.getElementById('wh-filter-btn').onclick = loadWhRecap;

    try {
        [whStudents, whDudiList] = await Promise.all([
            fetchAllPklStudents(),
            fetchAllDudiPartners(),
        ]);
        renderWhStats();
        renderWhStudents();
        renderWhDudi();
        await Promise.all([loadWhRecap(), loadWhObs(), loadWhCases()]);
    } catch (err) {
        console.error('[waka_humas]', err);
    }
}

function renderWhStats() {
    const placed = whStudents.filter(s => s.has_placement).length;
    document.getElementById('wh-stat-total').textContent  = whStudents.length;
    document.getElementById('wh-stat-placed').textContent = placed;
    document.getElementById('wh-stat-dudi').textContent   = whDudiList.length;
}

function renderWhStudents() {
    const tbody = document.getElementById('wh-students-body');
    const empty = document.getElementById('wh-students-empty');
    if (whStudents.length === 0) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
    empty.style.display = 'none';
    tbody.innerHTML = whStudents.map(s => `<tr>
        <td>${esc(s.full_name)}</td><td>${esc(s.nis)}</td>
        <td>${esc(s.program_name)}</td>
        <td>${esc(s.dudi_name)}</td>
        <td>${s.has_placement ? `${fmt(s.start_date)} – ${fmt(s.end_date)}` : '<span class="badge badge-tidak-hadir">Belum</span>'}</td>
    </tr>`).join('');
}

function renderWhDudi() {
    const tbody = document.getElementById('wh-dudi-body');
    const empty = document.getElementById('wh-dudi-empty');
    if (whDudiList.length === 0) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
    empty.style.display = 'none';
    tbody.innerHTML = whDudiList.map(d => `<tr>
        <td>${esc(d.org_name)}</td><td>${esc(d.pic_name)}</td><td>${esc(d.program_name)}</td>
    </tr>`).join('');
}

async function loadWhRecap() {
    const ids   = whStudents.map(s => s.student_id);
    const start = document.getElementById('wh-date-start').value;
    const end   = document.getElementById('wh-date-end').value;
    const tbody = document.getElementById('wh-recap-body');
    const empty = document.getElementById('wh-recap-empty');
    tbody.innerHTML = '<tr><td colspan="7" class="hint">Memuat…</td></tr>';
    empty.style.display = 'none';

    if (ids.length === 0) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
    try {
        const rows = await fetchPklAttendance(ids, start, end);
        const nameMap = new Map(whStudents.map(s => [s.student_id, { name: s.full_name, prog: s.program_name }]));
        const byStudent = new Map(whStudents.map(s => [s.student_id, { name: s.full_name, prog: s.program_name, HADIR:0, TIDAK_HADIR:0, IZIN:0, SAKIT:0, total:0 }]));
        for (const r of rows) {
            const a = byStudent.get(r.student_id);
            if (!a) continue;
            if (a[r.status] !== undefined) a[r.status]++;
            a.total++;
        }
        const recap = [...byStudent.values()];
        if (recap.every(a => a.total === 0)) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
        tbody.innerHTML = recap.map(a => {
            const pct = a.total > 0 ? Math.round(a.HADIR / a.total * 100) : 0;
            return `<tr><td>${esc(a.name)}</td><td>${esc(a.prog)}</td><td>${a.HADIR}</td><td>${a.SAKIT}</td><td>${a.IZIN}</td><td>${a.TIDAK_HADIR}</td><td>${a.total > 0 ? pct+'%' : '—'}</td></tr>`;
        }).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" style="color:var(--color-danger)">${esc(fe(err))}</td></tr>`;
    }
}

async function loadWhObs() {
    const ids    = whStudents.map(s => s.student_id);
    const hintEl = document.getElementById('wh-obs-hint');
    const listEl = document.getElementById('wh-obs-list');
    listEl.innerHTML = '';
    if (ids.length === 0) { hintEl.style.display = 'block'; return; }
    try {
        const rows = await fetchDudiObservations(ids);
        if (rows.length === 0) { hintEl.style.display = 'block'; return; }
        hintEl.style.display = 'none';
        const nameById = new Map(whStudents.map(s => [s.student_id, s.full_name]));
        listEl.innerHTML = rows.map(r => `
            <div class="obs-card obs-${r.sentiment.toLowerCase()}">
                <div class="obs-meta"><strong>${esc(nameById.get(r.student_id) ?? '—')}</strong>
                    &middot; ${esc(r.author)} &middot; ${DIMENSION_LABELS[r.dimension] ?? r.dimension} &middot; ${fmt(r.date)}
                </div>
                <p class="obs-content">${esc(r.content)}</p>
            </div>`).join('');
    } catch (err) {
        listEl.innerHTML = `<p class="hint" style="color:var(--color-danger)">${esc(fe(err))}</p>`;
    }
}

async function loadWhCases() {
    const tbody = document.getElementById('wh-cases-body');
    const empty = document.getElementById('wh-cases-empty');
    tbody.innerHTML = '<tr><td colspan="4" class="hint">Memuat…</td></tr>';
    empty.style.display = 'none';
    try {
        const all = await getOpenCases(currentUser.school_id);
        const cases = all.filter(c => c.track === 'PKL');
        if (cases.length === 0) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
        tbody.innerHTML = cases.map(c => `<tr>
            <td>${esc(c.student?.full_name ?? '—')}</td>
            <td>${esc(c.title)}</td>
            <td>${esc(c.current_handler_role ?? '—')}</td>
            <td>${fmt(c.created_at)}</td>
        </tr>`).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="4" style="color:var(--color-danger)">${esc(fe(err))}</td></tr>`;
    }
}

// ─── TAB KEPSEK (Monitoring) ─────────────────────────────────

const BULAN_ID = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];

function fmtChartLabel(dateStr, byMonth) {
    const d = new Date(dateStr + 'T00:00:00');
    if (byMonth) return BULAN_ID[d.getMonth()] + ' ' + d.getFullYear();
    return d.getDate() + ' ' + BULAN_ID[d.getMonth()];
}

function prevAcademicYear(current) {
    // '2025/2026' → '2024/2025'
    const y = parseInt(current?.split('/')[0] ?? new Date().getFullYear());
    return `${y - 1}/${y}`;
}

let _kepsekTabInit = false;
let _ksChart       = null;

async function initKepsekTab() {
    if (!_kepsekTabInit) {
        _kepsekTabInit = true;
        document.getElementById('ks-period-toggle').addEventListener('click', async (e) => {
            const btn = e.target.closest('.ks-period-btn');
            if (!btn) return;
            document.querySelectorAll('.ks-period-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            await loadKepsekMonitoring(btn.dataset.period);
        });
    }
    await loadKepsekMonitoring('hari_ini');
}

let _ksAdminTabInit = false;

async function initKsAdminTab() {
    if (!_ksAdminTabInit) {
        _ksAdminTabInit = true;
        document.getElementById('ks-add-admin-form').addEventListener('submit', handleAddAdmin);
    }
    await loadAdminList();
}

async function loadKepsekMonitoring(period = 'hari_ini') {
    const errEl     = document.getElementById('ks-monitoring-error');
    const pctSiswa  = document.getElementById('ks-pct-siswa');
    const pctGuru   = document.getElementById('ks-pct-guru');
    const detSiswa  = document.getElementById('ks-detail-siswa');
    const detGuru   = document.getElementById('ks-detail-guru');
    pctSiswa.textContent = '…';
    pctGuru.textContent  = '…';
    detSiswa.textContent = '';
    detGuru.textContent  = '';
    errEl.style.display  = 'none';

    try {
        const ayLalu = prevAcademicYear(config?.current_academic_year);
        const d = await getKepsekMonitoring(period, period === 'tahun_ajaran_lalu' ? ayLalu : null);
        const s = d.summary ?? {};

        pctSiswa.textContent = s.pct_siswa != null ? s.pct_siswa + '%' : '—';
        pctGuru.textContent  = s.pct_guru  != null ? s.pct_guru  + '%' : '—';

        detSiswa.textContent = (s.siswa_total > 0)
            ? `${s.siswa_hadir} dari ${s.siswa_total} sesi tercatat`
            : 'Belum ada data';
        detGuru.textContent  = (s.guru_total > 0)
            ? `${s.guru_hadir} dari ${s.guru_total} sesi terjadwal`
            : 'Belum ada data';

        renderKepsekChart(d.chart ?? [], d.by_month);

    } catch (err) {
        errEl.textContent   = `Gagal memuat data: ${fe(err)}`;
        errEl.style.display = 'block';
        pctSiswa.textContent = '—';
        pctGuru.textContent  = '—';
        console.error('[kepsek monitoring]', err);
    }
}

function renderKepsekChart(chartData, byMonth) {
    const canvas = document.getElementById('ks-chart');
    const labels = chartData.map(p => fmtChartLabel(p.date, byMonth));
    const dataSiswa = chartData.map(p => p.pct_siswa);
    const dataGuru  = chartData.map(p => p.pct_guru);

    const primary = getComputedStyle(document.documentElement)
        .getPropertyValue('--color-primary').trim() || '#4361ee';

    if (_ksChart) { _ksChart.destroy(); _ksChart = null; }

    _ksChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Kehadiran Siswa (%)',
                    data: dataSiswa,
                    borderColor: primary,
                    backgroundColor: primary + '22',
                    tension: 0.3,
                    fill: true,
                    pointRadius: chartData.length <= 14 ? 4 : 2,
                    spanGaps: true,
                },
                {
                    label: 'Kehadiran Guru (%)',
                    data: dataGuru,
                    borderColor: '#e67e22',
                    backgroundColor: '#e67e2222',
                    tension: 0.3,
                    fill: true,
                    pointRadius: chartData.length <= 14 ? 4 : 2,
                    spanGaps: true,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top', labels: { boxWidth: 12, font: { size: 12 } } },
                tooltip: {
                    callbacks: {
                        label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y + '%' : '—'}`,
                    },
                },
            },
            scales: {
                y: {
                    min: 0, max: 100,
                    ticks: { callback: v => v + '%', font: { size: 11 } },
                    grid: { color: '#0001' },
                },
                x: { ticks: { font: { size: 11 }, maxRotation: 45 } },
            },
        },
    });
}

async function loadAdminList() {
    const el = document.getElementById('ks-admin-list');
    try {
        const admins = await listSchoolAdmins();
        if (!admins.length) {
            el.innerHTML = '<p class="hint">Belum ada data admin.</p>';
            return;
        }
        el.innerHTML = `
            <table class="data-table" style="width:100%">
                <thead><tr><th>Nama</th><th>Login ID</th><th></th></tr></thead>
                <tbody>
                    ${admins.map(a => `
                        <tr>
                            <td>${esc(a.full_name)}</td>
                            <td><code>${esc(a.login_identifier)}</code></td>
                            <td style="text-align:right">
                                ${a.user_id === currentUser.user_id
                                    ? '<span class="hint">(Anda)</span>'
                                    : `<button class="btn btn-sm btn-danger" data-uid="${esc(a.user_id)}" data-name="${esc(a.full_name)}" onclick="confirmRemoveAdmin(this)">Hapus</button>`
                                }
                            </td>
                        </tr>`).join('')}
                </tbody>
            </table>`;
    } catch (err) {
        el.innerHTML = `<p class="hint">Gagal memuat daftar admin: ${fe(err)}</p>`;
    }
}

async function handleAddAdmin(e) {
    e.preventDefault();
    const btn     = document.getElementById('ks-add-admin-btn');
    const msgEl   = document.getElementById('ks-add-admin-msg');
    const resultEl = document.getElementById('ks-new-admin-result');
    const name    = document.getElementById('ks-admin-name').value.trim();
    const loginId = document.getElementById('ks-admin-loginid').value.trim();

    btn.disabled = true;
    msgEl.style.display = 'none';
    resultEl.style.display = 'none';

    try {
        const result = await addSchoolAdmin({ full_name: name, login_identifier: loginId });

        document.getElementById('ks-result-loginid').textContent   = result.login_identifier;
        document.getElementById('ks-result-password').textContent  = result.temp_password;
        resultEl.style.display = 'block';

        e.target.reset();
        e.target.closest('details').open = false;

        await loadAdminList();
    } catch (err) {
        msgEl.textContent    = fe(err);
        msgEl.style.display  = 'block';
    } finally {
        btn.disabled = false;
    }
}

window.confirmRemoveAdmin = async function(btn) {
    const uid  = btn.dataset.uid;
    const name = btn.dataset.name;
    if (!confirm(`Hapus akun admin "${name}"?\n\nMereka tidak akan bisa login lagi.`)) return;

    btn.disabled = true;
    try {
        await removeSchoolAdmin(uid);
        await loadAdminList();
    } catch (err) {
        alert(`Gagal menghapus: ${fe(err)}`);
        btn.disabled = false;
    }
};

// ─── TAB KASUS ───────────────────────────────────────────────

const CASE_STATUS_LABEL = {
    OPEN:         'Buka',
    UNDER_REVIEW: 'Ditinjau',
    INTERVENTION: 'Intervensi',
    MONITORING:   'Monitoring',
    CLOSED:       'Tutup',
};
const CASE_STATUS_BADGE = {
    OPEN:         'badge-open',
    UNDER_REVIEW: 'badge-review',
    INTERVENTION: 'badge-intervention',
    MONITORING:   'badge-monitoring',
    CLOSED:       'badge-closed',
};
const CASE_TRACK_LABEL = { SEKOLAH: 'Sekolah', PKL: 'PKL' };
const ROLE_LABEL = {
    GURU: 'Guru', BK: 'BK', WALI_KELAS: 'Wali Kelas',
    KAPRODI: 'Ka. Prodi', KEPSEK: 'Kepala Sekolah',
    DUDI: 'DUDI', WAKA_KESISWAAN: 'Waka Kesiswaan', WAKA_KURIKULUM: 'Waka Kurikulum',
};
// Rantai = PENUNTUN saja (referensi untuk peringatan), BUKAN batasan.
// Eskalasi antar-internal bebas; server hanya mengunci: target wajib peran
// internal kasus, & DUDI hanya → KAPRODI (mig 20260703250000).
const ESCALATION_CHAIN = {
    SEKOLAH: ['GURU','BK','WALI_KELAS','KAPRODI','WAKA_KESISWAAN','KEPSEK'],
    PKL:     ['DUDI','KAPRODI','WAKA_KESISWAAN','KEPSEK'],
};
const STATUS_AFTER_CURRENT = {
    OPEN:         ['UNDER_REVIEW','INTERVENTION','MONITORING'],
    UNDER_REVIEW: ['INTERVENTION','MONITORING'],
    INTERVENTION: ['MONITORING'],
    MONITORING:   [],
};
const EVENT_TYPE_LABEL = {
    COMMENT_ADDED:          'Komentar',
    STATUS_CHANGED:         'Status Berubah',
    DECISION_ESCALATE:      'Eskalasi',
    DECISION_CLOSE:         'Kasus Ditutup',
    FINAL_DECISION_MADE:    'Keputusan Final',
    STUDENT_UPDATE_ADDED:   'Update Siswa',
    PARENT_MESSAGE_RECEIVED:'Pesan Orang Tua',
    PARENT_MESSAGE_LINKED:  'Pesan Terhubung',
    PARENT_REPLY_SENT:      'Balasan Terkirim',
    CASE_LOCKED:            'Kasus Dikunci',
    CASE_UNLOCKED:          'Kasus Dibuka Kunci',
};

let _kasusTabInit   = false;
let _kasusAllCases  = [];
let _kasusCurrentId = null;

async function initKasusTab() {
    markKasusAsSeen();
    if (_kasusTabInit) { renderKasusList(); return; }
    _kasusTabInit = true;

    // Filters
    document.getElementById('kasus-filter-status').addEventListener('change', renderKasusList);
    document.getElementById('kasus-filter-track').addEventListener('change',  renderKasusList);

    // Offline guard — disable tombol + banner saat tidak ada koneksi
    function syncKasusOnlineState() {
        const online = navigator.onLine;
        const btn    = document.getElementById('kasus-new-btn');
        const banner = document.getElementById('kasus-offline-banner');
        btn.disabled          = !online;
        banner.style.display  = online ? 'none' : 'block';
    }
    syncKasusOnlineState();
    window.addEventListener('online',  syncKasusOnlineState);
    window.addEventListener('offline', syncKasusOnlineState);

    // New case button
    document.getElementById('kasus-new-btn').addEventListener('click', openKasusModal);
    document.getElementById('kasus-create-cancel-btn').addEventListener('click', closeKasusModal);
    document.getElementById('kasus-back-btn').addEventListener('click', showKasusList);

    // Create form
    const createForm  = document.getElementById('kasus-create-form');
    const searchEl    = document.getElementById('kasus-c-student-search');
    const studentIdEl = document.getElementById('kasus-c-student-id');
    const listEl      = document.getElementById('kasus-c-student-list');
    const trackField  = document.getElementById('kasus-c-track-field');
    const trackEl     = document.getElementById('kasus-c-track');

    // Kaprodi bisa pilih jalur; DUDI selalu PKL; semua lain selalu Sekolah
    const isKaprodi = jabatan.includes('kaprodi');
    const isDudi    = jabatan.includes('dudi');
    if (isKaprodi) {
        trackField.style.display = '';
    } else if (isDudi) {
        trackField.style.display = 'none';
        trackEl.value = 'PKL';
    } else {
        trackField.style.display = 'none';
        trackEl.value = 'SEKOLAH';
    }

    let kasusSearchSeq = 0;
    searchEl.addEventListener('input', async () => {
        const raw = searchEl.value.trim();
        const q   = raw.toLowerCase();
        if (q.length < 2) { listEl.style.display = 'none'; return; }

        let localPool = myStudents;
        if (jabatan.includes('kaprodi') && kaprodiAllStudents.length) {
            const seen = new Set(myStudents.map(s => s.student_id));
            localPool = [...myStudents, ...kaprodiAllStudents.filter(s => !seen.has(s.student_id))];
        }
        const local = localPool.filter(s =>
            s.full_name.toLowerCase().includes(q) || s.nis?.includes(q)
        );

        let hits = local;
        if (isBroadObserver) {
            const seq = ++kasusSearchSeq;
            try {
                const remote = await searchStudents(raw, currentUser.school_id);
                if (seq !== kasusSearchSeq) return;
                const seen = new Set(local.map(s => s.student_id));
                hits = [...local, ...remote.filter(s => !seen.has(s.student_id))];
            } catch { /* fallback lokal */ }
        }

        hits = hits.slice(0, 12);
        if (!hits.length) { listEl.style.display = 'none'; return; }
        listEl.innerHTML = hits.map(r =>
            `<div style="padding:8px 12px; cursor:pointer; font-size:13px" data-id="${r.student_id}" data-name="${esc(r.full_name)}">${esc(r.full_name)} — ${esc(r.nis ?? '')}${r.class_name ? ' · ' + esc(r.class_name) : ''}</div>`
        ).join('');
        listEl.style.display = 'block';
        listEl.querySelectorAll('div').forEach(el => {
            el.addEventListener('click', () => {
                searchEl.value = el.dataset.name;
                studentIdEl.value = el.dataset.id;
                listEl.style.display = 'none';
            });
            el.addEventListener('mouseenter', () => { el.style.background = 'var(--color-bg)'; });
            el.addEventListener('mouseleave', () => { el.style.background = ''; });
        });
    });

    createForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const msgEl  = document.getElementById('kasus-create-msg');
        const btnEl  = document.getElementById('kasus-create-submit-btn');
        const sId    = studentIdEl.value;
        const title  = document.getElementById('kasus-c-title').value.trim();
        const desc   = document.getElementById('kasus-c-desc').value.trim();
        const track  = document.getElementById('kasus-c-track').value;

        msgEl.style.display = 'none';
        if (!sId)          { showCreateMsg('Pilih siswa dari daftar.', true); return; }
        if (!title)        { showCreateMsg('Judul tidak boleh kosong.', true); return; }
        if (desc.length < 20) { showCreateMsg('Deskripsi minimal 20 karakter.', true); return; }

        btnEl.disabled = true; btnEl.textContent = 'Menyimpan…';
        try {
            const audience = document.getElementById('kasus-c-audience')?.value ?? 'PRIVATE';
            const r = await createCase({
                studentId:   sId,
                title,
                description: desc,
                track,
                audience,
                authorUserId: currentUser.user_id,
                authorRole:   currentUser.role_type,
            });
            closeKasusModal();
            if (r._queued) {
                showCreateMsg('Kasus disimpan lokal. Akan dikirim saat koneksi kembali.', false);
            }
            _kasusAllCases = [];
            _kasusTabInit = false;
            await initKasusTab();
        } catch (err) {
            showCreateMsg(fe(err, 's'), true);
        } finally {
            btnEl.disabled = false; btnEl.textContent = 'Simpan';
        }
    });

    await loadKasusList();
}

function showCreateMsg(msg, isErr = false) {
    const el = document.getElementById('kasus-create-msg');
    el.style.display = 'block';
    el.style.color   = isErr ? 'var(--color-danger)' : 'var(--color-success)';
    el.textContent   = msg;
}

function openKasusModal() {
    if (!navigator.onLine) return;
    const modal = document.getElementById('kasus-create-modal');
    document.getElementById('kasus-create-form').reset();
    document.getElementById('kasus-c-student-id').value = '';
    document.getElementById('kasus-create-msg').style.display = 'none';
    document.getElementById('kasus-c-student-list').style.display = 'none';
    modal.style.display = 'flex';
}
function closeKasusModal() {
    document.getElementById('kasus-create-modal').style.display = 'none';
}

async function loadKasusList() {
    const contentEl = document.getElementById('kasus-list-content');
    contentEl.innerHTML = '<p class="hint">Memuat kasus…</p>';
    try {
        _kasusAllCases = await getCases();
        renderKasusList();
    } catch (err) {
        contentEl.innerHTML = `<p class="hint" style="color:var(--color-danger)">${esc(fe(err))}</p>`;
    }
}

function renderKasusList() {
    const contentEl   = document.getElementById('kasus-list-content');
    const statusFilter = document.getElementById('kasus-filter-status').value;
    const trackFilter  = document.getElementById('kasus-filter-track').value;

    let rows = _kasusAllCases;
    if (statusFilter) rows = rows.filter(r => r.status === statusFilter);
    if (trackFilter)  rows = rows.filter(r => r.track  === trackFilter);

    if (!rows.length) {
        contentEl.innerHTML = '<p class="hint">Tidak ada kasus yang sesuai filter.</p>';
        return;
    }

    contentEl.innerHTML = rows.map(r => `
        <div class="kasus-row" data-id="${r.case_id}" style="border:1px solid var(--color-border); border-radius:var(--radius); padding:14px 16px; margin-bottom:10px; cursor:pointer; transition:background .12s">
            <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:8px; flex-wrap:wrap">
                <strong style="font-size:14px; flex:1">${esc(r.title)}</strong>
                <span class="badge kasus-badge-${(r.status||'').toLowerCase()}">${esc(CASE_STATUS_LABEL[r.status] ?? r.status)}</span>
            </div>
            <div style="font-size:12px; color:var(--color-text-muted); margin-top:4px">
                ${esc(r.student?.full_name ?? '—')} (${esc(r.student?.nis ?? '—')})
                &middot; ${esc(CASE_TRACK_LABEL[r.track] ?? r.track)}
                &middot; Handler: ${esc(ROLE_LABEL[r.current_handler_role] ?? r.current_handler_role ?? '—')}
                &middot; ${fmt(r.created_at)}
            </div>
        </div>
    `).join('');

    contentEl.querySelectorAll('.kasus-row').forEach(el => {
        el.addEventListener('mouseenter', () => { el.style.background = 'var(--color-bg)'; });
        el.addEventListener('mouseleave', () => { el.style.background = ''; });
        el.addEventListener('click', () => openKasusDetail(el.dataset.id));
    });
}

function showKasusList() {
    document.getElementById('kasus-list-view').style.display = 'block';
    document.getElementById('kasus-detail-view').style.display = 'none';
    _kasusCurrentId = null;
}

async function openKasusDetail(caseId) {
    _kasusCurrentId = caseId;
    document.getElementById('kasus-list-view').style.display = 'none';
    document.getElementById('kasus-detail-view').style.display = 'block';
    document.getElementById('kasus-detail-header').innerHTML = '<p class="hint">Memuat…</p>';
    document.getElementById('kasus-events-list').innerHTML   = '<p class="hint">Memuat…</p>';
    document.getElementById('kasus-actions').style.display  = 'none';

    try {
        const [kasus, events] = await Promise.all([getCase(caseId), getCaseEvents(caseId)]);
        renderKasusDetail(kasus);
        renderKasusEvents(events);
        renderKasusActions(kasus);
    } catch (err) {
        document.getElementById('kasus-detail-header').innerHTML =
            `<p class="hint" style="color:var(--color-danger)">${esc(fe(err))}</p>`;
    }
}

function renderKasusDetail(k) {
    const el = document.getElementById('kasus-detail-header');
    el.innerHTML = `
        <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:8px; flex-wrap:wrap; margin-bottom:12px">
            <h3 style="margin:0; flex:1">${esc(k.title)}</h3>
            <span class="badge kasus-badge-${(k.status||'').toLowerCase()}">${esc(CASE_STATUS_LABEL[k.status] ?? k.status)}</span>
        </div>
        <div style="font-size:13px; color:var(--color-text-muted); margin-bottom:12px">
            Siswa: <strong>${esc(k.student?.full_name ?? '—')}</strong> (${esc(k.student?.nis ?? '—')})
            &middot; Track: <strong>${esc(CASE_TRACK_LABEL[k.track] ?? k.track)}</strong>
            &middot; Dibuka oleh: ${esc(ROLE_LABEL[k.initiated_by_role] ?? k.initiated_by_role)}
            &middot; Handler saat ini: <strong>${esc(ROLE_LABEL[k.current_handler_role] ?? k.current_handler_role ?? '—')}</strong>
            &middot; ${esc(AUDIENCE_LABEL[k.audience] ?? k.audience ?? 'Privat')}
            ${k.is_locked ? '&middot; <span style="color:var(--color-warning)">🔒 Terkunci</span>' : ''}
        </div>
        <p style="font-size:14px; color:var(--color-text); margin:0">${esc(k.description)}</p>
    `;
}

function renderKasusEvents(events) {
    const el = document.getElementById('kasus-events-list');
    if (!events.length) {
        el.innerHTML = '<p class="hint">Belum ada event.</p>';
        return;
    }
    el.innerHTML = events.map(ev => {
        const label = EVENT_TYPE_LABEL[ev.event_type] ?? ev.event_type;
        const text  = ev.payload?.text ?? '';
        let detail  = '';
        if (ev.event_type === 'DECISION_ESCALATE')
            detail = `→ ${esc(ROLE_LABEL[ev.new_handler_role] ?? ev.new_handler_role)}`;
        if (ev.event_type === 'STATUS_CHANGED' || ev.event_type === 'DECISION_CLOSE' || ev.event_type === 'FINAL_DECISION_MADE')
            detail = `${esc(CASE_STATUS_LABEL[ev.previous_status] ?? ev.previous_status ?? '?')} → ${esc(CASE_STATUS_LABEL[ev.new_status] ?? ev.new_status ?? '?')}`;
        return `
            <div style="border-left:3px solid var(--color-border); padding:10px 14px; margin-bottom:10px">
                <div style="font-size:12px; color:var(--color-text-muted); margin-bottom:4px">
                    <strong>${esc(label)}</strong>
                    ${detail ? `<span style="margin-left:6px">${detail}</span>` : ''}
                    &middot; ${esc(ev.author?.full_name ?? '—')} (${esc(ROLE_LABEL[ev.author_role_at_time] ?? ev.author_role_at_time)})
                    &middot; ${fmt(ev.created_at)}
                </div>
                ${text ? `<p style="font-size:13px; margin:0; color:var(--color-text)">${esc(text)}</p>` : ''}
            </div>`;
    }).join('');
}

// 6 peran yang boleh jadi handler/eskalasi tujuan kasus internal
const INTERNAL_CASE_ROLES = ['GURU','BK','WALI_KELAS','KAPRODI','WAKA_KESISWAAN','KEPSEK'];
const AUDIENCE_LABEL = { PRIVATE: '🔒 Privat', RESTRICTED: '👥 Orang Tertentu', PUBLIC: '🌐 Semua Internal' };

function renderKasusActions(kasus) {
    const actionsEl     = document.getElementById('kasus-actions');
    const escalateBlock = document.getElementById('kasus-escalate-block');
    const statusBlock   = document.getElementById('kasus-status-block');
    const audienceBlock = document.getElementById('kasus-audience-block');
    const closeBtn      = document.getElementById('kasus-close-btn');
    const escalateTo    = document.getElementById('kasus-escalate-to');
    const statusSel     = document.getElementById('kasus-new-status');

    if (kasus.status === 'CLOSED') {
        actionsEl.style.display = 'none';
        return;
    }

    actionsEl.style.display = 'block';

    // ── Eskalasi BEBAS: semua internal boleh teruskan ke peran internal mana pun ──
    const isInternal = INTERNAL_CASE_ROLES.includes(currentUser.role_type);
    if (isInternal) {
        const chain = ESCALATION_CHAIN[kasus.track] ?? [];
        const handlerIdx = chain.indexOf(kasus.current_handler_role);
        const targets = INTERNAL_CASE_ROLES.filter(r => r !== kasus.current_handler_role);
        escalateTo.innerHTML = targets.map(r => {
            const isDownstream = handlerIdx >= 0 && chain.indexOf(r) < handlerIdx;
            return `<option value="${r}" data-downstream="${isDownstream}">${esc(ROLE_LABEL[r] ?? r)}${isDownstream ? ' ↩ lebih rendah' : ''}</option>`;
        }).join('');

        // Peringatan tak-memblokir saat pilih ke bawah
        const warnEl = document.getElementById('kasus-escalate-warn');
        function updateEscWarn() {
            const sel = escalateTo.options[escalateTo.selectedIndex];
            if (sel && sel.dataset.downstream === 'true') {
                warnEl.textContent = `Peran ${esc(ROLE_LABEL[sel.value] ?? sel.value)} ada di bawah handler saat ini dalam rantai referensi. Anda tetap bisa meneruskan — pastikan ini disengaja.`;
                warnEl.style.display = 'block';
            } else {
                warnEl.style.display = 'none';
            }
        }
        escalateTo.onchange = updateEscWarn;
        updateEscWarn();
        escalateBlock.style.display = 'block';
    } else {
        escalateBlock.style.display = 'none';
    }

    // ── Status change ──
    const nextStatuses = STATUS_AFTER_CURRENT[kasus.status] ?? [];
    const isHandler = kasus.current_handler_role === currentUser.role_type;
    const canChangeStatus = isHandler || ['KEPSEK','BK','WAKA_KESISWAAN'].includes(currentUser.role_type);
    if (canChangeStatus && nextStatuses.length) {
        statusSel.innerHTML = nextStatuses.map(s =>
            `<option value="${s}">${esc(CASE_STATUS_LABEL[s])}</option>`
        ).join('');
        statusBlock.style.display = 'block';
    } else {
        statusBlock.style.display = 'none';
    }

    // Close: Kepsek/BK/handler
    const canClose = currentUser.role_type === 'KEPSEK' || isHandler;
    closeBtn.style.display = canClose ? 'inline-flex' : 'none';

    // ── Kelola Audiens (hanya internal) ──
    if (isInternal) {
        const badge = document.getElementById('kasus-audience-badge');
        const cur   = kasus.audience ?? 'PRIVATE';
        badge.textContent = AUDIENCE_LABEL[cur] ?? cur;
        badge.style.background = cur === 'PUBLIC' ? 'var(--color-success-bg, #d4edda)'
            : cur === 'RESTRICTED' ? 'var(--color-info-bg, #d1ecf1)'
            : 'var(--color-bg)';
        audienceBlock.style.display = 'block';
        renderAudiencePanel(kasus, cur);
    } else {
        audienceBlock.style.display = 'none';
    }

    // ── Wire buttons (replace listeners by cloning) ──
    const newCommentBtn = replaceEl('kasus-comment-submit-btn');
    const newEscBtn     = replaceEl('kasus-escalate-btn');
    const newStatusBtn  = replaceEl('kasus-status-btn');
    const newCloseBtn   = replaceEl('kasus-close-btn');

    newCommentBtn.addEventListener('click', async () => {
        const text  = document.getElementById('kasus-comment-text').value.trim();
        const msgEl = document.getElementById('kasus-comment-msg');
        if (!text) { msgEl.style.color = 'var(--color-danger)'; msgEl.textContent = 'Komentar tidak boleh kosong.'; return; }
        newCommentBtn.disabled = true; newCommentBtn.textContent = 'Mengirim…';
        try {
            await addCaseComment({ caseId: kasus.case_id, text, authorUserId: currentUser.user_id, authorRole: currentUser.role_type });
            document.getElementById('kasus-comment-text').value = '';
            msgEl.style.color = 'var(--color-success)'; msgEl.textContent = 'Komentar dikirim.';
            await refreshKasusDetail();
        } catch (err) {
            msgEl.style.color = 'var(--color-danger)'; msgEl.textContent = fe(err, 's');
        } finally {
            newCommentBtn.disabled = false; newCommentBtn.textContent = 'Kirim Komentar';
        }
    });

    newEscBtn.addEventListener('click', async () => {
        const to    = document.getElementById('kasus-escalate-to').value;
        const note  = document.getElementById('kasus-escalate-note').value.trim();
        const msgEl = document.getElementById('kasus-escalate-msg');
        newEscBtn.disabled = true; newEscBtn.textContent = 'Meneruskan…';
        try {
            await escalateCase({
                caseId: kasus.case_id,
                previousHandlerRole: kasus.current_handler_role,
                newHandlerRole: to,
                note,
                authorUserId:   currentUser.user_id,
                authorRole:     currentUser.role_type,
                previousStatus: kasus.status,
            });
            msgEl.style.color = 'var(--color-success)'; msgEl.textContent = `Diteruskan ke ${ROLE_LABEL[to] ?? to}.`;
            await refreshKasusDetail();
        } catch (err) {
            msgEl.style.color = 'var(--color-danger)'; msgEl.textContent = fe(err, 's');
        } finally {
            newEscBtn.disabled = false; newEscBtn.textContent = 'Teruskan';
        }
    });

    newStatusBtn.addEventListener('click', async () => {
        const newSt = document.getElementById('kasus-new-status').value;
        const note  = document.getElementById('kasus-status-note').value.trim();
        const msgEl = document.getElementById('kasus-status-msg');
        newStatusBtn.disabled = true; newStatusBtn.textContent = 'Menyimpan…';
        try {
            await changeCaseStatus({ caseId: kasus.case_id, previousStatus: kasus.status, newStatus: newSt, note, authorUserId: currentUser.user_id, authorRole: currentUser.role_type });
            msgEl.style.color = 'var(--color-success)'; msgEl.textContent = `Status diubah ke ${CASE_STATUS_LABEL[newSt]}.`;
            await refreshKasusDetail();
        } catch (err) {
            msgEl.style.color = 'var(--color-danger)'; msgEl.textContent = fe(err, 's');
        } finally {
            newStatusBtn.disabled = false; newStatusBtn.textContent = 'Ubah Status';
        }
    });

    newCloseBtn.addEventListener('click', async () => {
        const note  = document.getElementById('kasus-status-note').value.trim();
        const msgEl = document.getElementById('kasus-status-msg');
        if (newCloseBtn.dataset.confirming !== 'yes') {
            newCloseBtn.dataset.confirming = 'yes';
            msgEl.style.color   = 'var(--color-warning)';
            msgEl.textContent   = 'Kasus yang ditutup tidak bisa dibuka kembali. Klik "Tutup Kasus" sekali lagi untuk konfirmasi.';
            newCloseBtn.textContent = 'Konfirmasi Tutup';
            setTimeout(() => {
                if (newCloseBtn.dataset.confirming === 'yes') {
                    newCloseBtn.dataset.confirming = '';
                    newCloseBtn.textContent = 'Tutup Kasus';
                    msgEl.textContent = '';
                }
            }, 6000);
            return;
        }
        newCloseBtn.dataset.confirming = '';
        newCloseBtn.disabled = true; newCloseBtn.textContent = 'Menutup…';
        try {
            await closeCase({ caseId: kasus.case_id, note, authorUserId: currentUser.user_id, authorRole: currentUser.role_type });
            msgEl.style.color = 'var(--color-success)'; msgEl.textContent = 'Kasus berhasil ditutup.';
            await refreshKasusDetail();
        } catch (err) {
            msgEl.style.color = 'var(--color-danger)'; msgEl.textContent = fe(err, 's');
        } finally {
            newCloseBtn.disabled = false; newCloseBtn.textContent = 'Tutup Kasus';
        }
    });
}

function renderAudiencePanel(kasus, currentAudience) {
    const msgEl      = document.getElementById('kasus-audience-msg');
    const restricted = document.getElementById('kasus-aud-restricted-panel');

    // Highlight tombol aktif
    ['PRIVATE','RESTRICTED','PUBLIC'].forEach(a => {
        const btn = document.getElementById(`kasus-aud-${a.toLowerCase()}-btn`);
        if (!btn) return;
        btn.className = `btn btn-sm${a === currentAudience ? ' btn-primary' : ' btn-secondary'}`;
    });

    restricted.style.display = currentAudience === 'RESTRICTED' ? 'block' : 'none';
    if (currentAudience === 'RESTRICTED') loadAudienceMembers(kasus);

    ['PRIVATE','RESTRICTED','PUBLIC'].forEach(a => {
        const btn = replaceEl(`kasus-aud-${a.toLowerCase()}-btn`);
        btn.addEventListener('click', async () => {
            if (a === currentAudience) return;
            msgEl.style.color = ''; msgEl.textContent = 'Menyimpan…';
            try {
                await updateCaseAudience({ caseId: kasus.case_id, audience: a });
                msgEl.style.color = 'var(--color-success)';
                msgEl.textContent = `Audiens diubah ke: ${AUDIENCE_LABEL[a]}.`;
                await refreshKasusDetail();
            } catch (err) {
                msgEl.style.color = 'var(--color-danger)'; msgEl.textContent = fe(err, 's');
            }
        });
    });
}

async function loadAudienceMembers(kasus) {
    const listEl  = document.getElementById('kasus-aud-members-list');
    const searchEl = document.getElementById('kasus-aud-member-search');
    const dropEl   = document.getElementById('kasus-aud-member-list');
    const msgEl    = document.getElementById('kasus-audience-msg');
    listEl.textContent = 'Memuat anggota…';
    try {
        const members = await getCaseAudienceMembers(kasus.case_id);
        if (!members.length) {
            listEl.innerHTML = '<em style="color:var(--color-text-muted)">Belum ada anggota khusus.</em>';
        } else {
            listEl.innerHTML = members.map(m => {
                const name = m.users?.full_name ?? m.user_id;
                const role = ROLE_LABEL[m.users?.role_type] ?? m.users?.role_type ?? '';
                return `<span style="display:inline-flex;align-items:center;gap:4px;margin:2px 4px 2px 0;padding:2px 8px;border:1px solid var(--color-border);border-radius:20px;font-size:12px">
                    ${esc(name)} <span style="color:var(--color-text-muted)">(${esc(role)})</span>
                    <button data-uid="${m.user_id}" style="background:none;border:none;cursor:pointer;color:var(--color-danger);font-size:14px;line-height:1;padding:0 2px" title="Hapus">×</button>
                </span>`;
            }).join('');
            listEl.querySelectorAll('button[data-uid]').forEach(btn => {
                btn.addEventListener('click', async () => {
                    try {
                        await removeCaseAudienceMember({ caseId: kasus.case_id, userId: btn.dataset.uid });
                        await loadAudienceMembers(kasus);
                    } catch (err) {
                        msgEl.style.color = 'var(--color-danger)'; msgEl.textContent = fe(err, 's');
                    }
                });
            });
        }
    } catch (err) {
        listEl.textContent = 'Gagal memuat anggota.';
    }

    // Search + add
    let _searchTimer;
    searchEl.oninput = () => {
        clearTimeout(_searchTimer);
        const q = searchEl.value.trim();
        if (q.length < 2) { dropEl.style.display = 'none'; return; }
        _searchTimer = setTimeout(async () => {
            try {
                const rows = await searchInternalUsers(q);
                if (!rows.length) { dropEl.style.display = 'none'; return; }
                dropEl.innerHTML = rows.map(r =>
                    `<div style="padding:8px 12px;cursor:pointer;font-size:13px" data-id="${r.user_id}" data-name="${esc(r.full_name)}">${esc(r.full_name)} — ${esc(ROLE_LABEL[r.role_type] ?? r.role_type)}</div>`
                ).join('');
                dropEl.style.display = 'block';
                dropEl.querySelectorAll('div').forEach(el => {
                    el.addEventListener('click', async () => {
                        dropEl.style.display = 'none';
                        searchEl.value = '';
                        try {
                            await addCaseAudienceMember({ caseId: kasus.case_id, userId: el.dataset.id, schoolId: currentUser.school_id, addedByUserId: currentUser.user_id });
                            await loadAudienceMembers(kasus);
                        } catch (err) {
                            msgEl.style.color = 'var(--color-danger)'; msgEl.textContent = fe(err, 's');
                        }
                    });
                    el.addEventListener('mouseenter', () => { el.style.background = 'var(--color-bg)'; });
                    el.addEventListener('mouseleave', () => { el.style.background = ''; });
                });
            } catch(e) { console.error('[kasus-member-search]', e); dropEl.style.display = 'none'; }
        }, 250);
    };
}

function replaceEl(id) {
    const old = document.getElementById(id);
    const neu = old.cloneNode(true);
    old.parentNode.replaceChild(neu, old);
    return neu;
}

async function refreshKasusDetail() {
    if (!_kasusCurrentId) return;
    try {
        const [kasus, events] = await Promise.all([getCase(_kasusCurrentId), getCaseEvents(_kasusCurrentId)]);
        renderKasusDetail(kasus);
        renderKasusEvents(events);
        renderKasusActions(kasus);
        // Update list cache
        _kasusAllCases = await getCases();
    } catch (err) {
        console.error('[kasus] refresh error', err);
    }
}

// ─── TAB JURNAL MENGAJAR ─────────────────────────────────────

let _jurnalTabInit = false;
async function initJurnalTab() {
    if (_jurnalTabInit) return;
    _jurnalTabInit = true;

    // Tanggal default hari ini, tersembunyi
    const dateEl = document.getElementById('journal-date');
    dateEl.value = localDateStr();

    document.getElementById('journal-date-toggle').addEventListener('click', () => {
        const row = document.getElementById('journal-date-row');
        const visible = row.style.display !== 'none';
        row.style.display = visible ? 'none' : 'block';
    });

    await loadJurnalList();

    document.getElementById('journal-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn     = document.getElementById('journal-submit-btn');
        const msgEl   = document.getElementById('journal-form-msg');
        const content = document.getElementById('journal-content').value.trim();
        const date    = document.getElementById('journal-date').value;

        if (!content) return;

        btn.disabled = true;
        btn.textContent = 'Menyimpan…';
        msgEl.style.display = 'none';

        try {
            const r = await insertJournalEntry(currentUser.user_id, date, content);
            if (r.status === 'error') throw new Error(r.error);
            document.getElementById('journal-content').value = '';
            msgEl.textContent = r.status === 'queued'
                ? '⏳ Catatan disimpan lokal — akan dikirim saat online.'
                : 'Catatan berhasil disimpan.';
            msgEl.style.display = 'block';
            if (r.status === 'synced') await loadJurnalList();
        } catch (err) {
            msgEl.textContent = fe(err, 's');
            msgEl.style.display = 'block';
        } finally {
            btn.disabled = false;
            btn.textContent = 'Simpan';
        }
    });
}

function renderJurnalEntries(entries, listEl) {
    if (!entries.length) {
        listEl.innerHTML = '<p class="hint">Belum ada catatan.</p>';
        return;
    }
    listEl.innerHTML = entries.map(e => `
        <div class="section-card" style="margin-bottom:8px" data-entry-id="${esc(e.journal_id)}" data-entry-date="${esc(e.entry_date)}">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;flex-wrap:wrap;gap:6px">
                <strong>${fmt(e.entry_date)}</strong>
                <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
                    <div class="jrn-del-confirm" style="display:none;align-items:center;gap:8px">
                        <span style="font-size:13px;color:var(--color-text-muted)">Hapus catatan ini?</span>
                        <button class="btn btn-danger btn-sm jrn-del-yes">Ya, Hapus</button>
                        <button class="btn btn-secondary btn-sm jrn-del-no">Batal</button>
                    </div>
                    <button class="btn btn-secondary btn-sm jrn-edit-btn" data-id="${esc(e.journal_id)}">Edit</button>
                    <button class="btn btn-secondary btn-sm jrn-del-ask" data-delete="${esc(e.journal_id)}">Hapus</button>
                </div>
            </div>
            <p class="jrn-content-view" style="white-space:pre-wrap;margin:0">${esc(e.content)}</p>
            <div class="jrn-edit-area" style="display:none">
                <textarea class="input jrn-edit-ta" rows="4" style="width:100%;margin-bottom:6px">${esc(e.content)}</textarea>
                <div style="display:flex;gap:6px">
                    <button class="btn btn-primary btn-sm jrn-edit-save">Simpan</button>
                    <button class="btn btn-secondary btn-sm jrn-edit-cancel">Batal</button>
                </div>
                <p class="jrn-edit-err" style="display:none;font-size:13px;color:var(--color-danger);margin:4px 0 0"></p>
            </div>
            <p class="jrn-del-err" style="display:none;font-size:13px;color:var(--color-danger);margin:4px 0 0"></p>
        </div>
    `).join('');

    listEl.querySelectorAll('[data-entry-id]').forEach(card => {
        const id        = card.dataset.entryId;
        const entryDate = card.dataset.entryDate;
        const askBtn    = card.querySelector('.jrn-del-ask');
        const confirmEl = card.querySelector('.jrn-del-confirm');
        const yesBtn    = card.querySelector('.jrn-del-yes');
        const noBtn     = card.querySelector('.jrn-del-no');
        const errEl     = card.querySelector('.jrn-del-err');
        const editBtn   = card.querySelector('.jrn-edit-btn');
        const editArea  = card.querySelector('.jrn-edit-area');
        const editTa    = card.querySelector('.jrn-edit-ta');
        const editSave  = card.querySelector('.jrn-edit-save');
        const editCancel= card.querySelector('.jrn-edit-cancel');
        const editErr   = card.querySelector('.jrn-edit-err');
        const contentP  = card.querySelector('.jrn-content-view');

            askBtn.addEventListener('click', () => {
                confirmEl.style.display = 'flex';
                askBtn.style.display    = 'none';
            });
            noBtn.addEventListener('click', () => {
                confirmEl.style.display = 'none';
                askBtn.style.display    = 'inline-flex';
            });
            yesBtn.addEventListener('click', async () => {
                yesBtn.disabled = true; yesBtn.textContent = 'Menghapus…';
                try {
                    await deleteJournalEntry(askBtn.dataset.delete);
                    await loadJurnalList();
                } catch (err) {
                    errEl.textContent = fe(err, 'h');
                    errEl.style.display = 'block';
                    yesBtn.disabled = false; yesBtn.textContent = 'Ya, Hapus';
                }
            });

            editBtn.addEventListener('click', () => {
                editArea.style.display  = 'block';
                contentP.style.display  = 'none';
                editBtn.style.display   = 'none';
                askBtn.style.display    = 'none';
                editErr.style.display   = 'none';
            });
            editCancel.addEventListener('click', () => {
                editArea.style.display  = 'none';
                contentP.style.display  = '';
                editBtn.style.display   = '';
                askBtn.style.display    = '';
            });
            editSave.addEventListener('click', async () => {
                const newContent = editTa.value.trim();
                if (!newContent) return;
                editSave.disabled = true; editSave.textContent = 'Menyimpan…';
                try {
                    const r = await updateJournalEntry(id, entryDate, newContent, currentUser.user_id);
                    if (r.status === 'error') throw new Error(r.error);
                    LC.clear(`jurnal-${currentUser.user_id}`);
                    if (r.status === 'queued') {
                        editErr.textContent = '⏳ Tersimpan di perangkat — akan dikirim saat online.';
                        editErr.style.color = 'var(--color-warning,#b45309)';
                        editErr.style.display = 'block';
                        editSave.disabled = false; editSave.textContent = 'Simpan';
                    } else {
                        await loadJurnalList();
                    }
                } catch (err) {
                    editErr.textContent = fe(err, 's');
                    editErr.style.color = 'var(--color-danger)';
                    editErr.style.display = 'block';
                    editSave.disabled = false; editSave.textContent = 'Simpan';
                }
            });
        });
}

async function loadJurnalList() {
    const listEl   = document.getElementById('journal-list');
    const cacheKey = `jurnal-${currentUser.user_id}`;

    // Tampilkan cache dulu
    const cached = LC.get(cacheKey);
    if (cached) {
        renderJurnalEntries(cached, listEl);
    } else {
        listEl.innerHTML = '<p class="hint">Memuat…</p>';
    }

    try {
        const entries = await getJournalEntries(currentUser.user_id);
        LC.set(cacheKey, entries);
        renderJurnalEntries(entries, listEl);
    } catch (err) {
        if (!cached) {
            listEl.innerHTML = `<p class="hint">Gagal memuat data. ${esc(fe(err))}</p>`;
        }
    }
}

// ─── Logout ──────────────────────────────────────────────────

// ── Lonceng notifikasi ────────────────────────────────────────
document.getElementById('notif-bell-btn')?.addEventListener('click', openNotifDropdown);

// Tutup dropdown jika klik di luar
document.addEventListener('click', (e) => {
    const panel = document.getElementById('notif-dropdown');
    if (!panel || panel.style.display === 'none') return;
    if (!e.target.closest('#notif-bell-btn') && !e.target.closest('#notif-dropdown')) {
        panel.style.display = 'none';
    }
});

document.getElementById('logout-btn')?.addEventListener('click', async () => {
    // Cek antrian tertunda — peringatkan jika ada yang belum tersinkron
    const n = await pendingCount().catch(() => 0);
    if (n > 0) {
        const el = document.getElementById('sync-banner');
        if (el) {
            el.style.background  = 'var(--color-danger-bg,#fef2f2)';
            el.style.color       = 'var(--color-danger,#dc2626)';
            el.style.borderColor = 'var(--color-danger,#dc2626)';
            el.textContent       = `⚠️ ${n} item belum tersinkron akan dihapus saat logout. Pastikan online dulu sebelum keluar.`;
            el.style.display     = 'block';
            await new Promise(r => setTimeout(r, 3000));
        }
    }
    await clearOfflineQueue();
    LC.clear('');   // hapus semua cache smkhr:* dari localStorage
    await logout();
    window.location.href = getLoginUrl();
});

// ─── Start ───────────────────────────────────────────────────
init();
