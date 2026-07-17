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

    getSchoolStats, getKepsekMonitoring,
    getPendingAttendanceSessions, getPendingSessionsByTeacher, getPendingSessionsDetail,
    getAttendanceFillRate,
    getAttendanceRecapPerClass, getOpenCases,
    getPrograms, getStudentAttendanceSessions,
    getJournalEntries, insertJournalEntry, deleteJournalEntry, updateJournalEntry,
    getMyObservations, getStudentUserId, getStudentParents,
    getCases, getCase, getCaseEvents, createCase,
    addCaseComment, escalateCase, changeCaseStatus, closeCase,
    updateCaseAudience, logCaseAudienceChange, getCaseAudienceMembers,
    addCaseAudienceMember, removeCaseAudienceMember, searchInternalUsers,
    getUnreadNotifCount, getRecentNotifications, markNotificationsRead,
    registerLoginDevice,
    getForumPosts, getForumCategories, getForumStudents, createForumPost,
    addForumAcknowledgement, addForumComment, getForumPostComments, getForumClasses,
    withdrawForumPost, updateForumPost, withdrawForumComment,
    getMyTeachingSubjects, getCpBySubject, getTpBySubject,
    saveCp, saveTp, updateTp, generateAtp,
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
            badge.className = 'notif-badge-count';
            btn.style.position = 'relative';
            btn.appendChild(badge);
        }
        badge.textContent = n > 99 ? '99+' : String(n);
    } else {
        badge?.remove();
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
const _studentSubjectCache = new Map(); // studentId → { userId, parents }
let config       = null;   // { current_academic_year, current_semester }
let jabatan      = [];
let isTeacher    = false;  // hanya GURU & WALI_KELAS yang mengajar
let myStudents         = [];     // for observation selector
let isBroadObserver    = false;  // BK/Waka/Kepsek — bisa cari siswa seluruh sekolah
let kaprodiAllStudents = [];     // PKL + aktif di prodi Kaprodi, untuk batas pencarian
let _studentPoolInit   = false;  // guard: ensureStudentPool hanya load sekali
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
    if (!auth?.user) { window.location.replace(getLoginUrl()); return; }

    currentUser = await getCurrentUserRow(auth.user);
    if (!currentUser || !GURU_ROLES.includes(currentUser.role_type) || currentUser.is_active === false) {
        await supabase.auth.signOut();
        window.location.replace(getLoginUrl());
        return;
    }

    await Promise.all([
        applyBrandingById(currentUser.school_id, supabase),
        checkMustChangePassword(supabase, currentUser),
        initLoginGuard(supabase, currentUser),
        getSchoolConfig().then(c => { config = c; }),
    ]);
    jabatan   = getJabatan(currentUser);
    isTeacher = !!currentUser.teacher_code
        || (currentUser.teaching_assignments?.[0]?.count ?? 0) > 0;

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
    kepsek: 'Kepsek', ks_admin: 'Admin',
    kasus: 'Pembinaan', jurnal: 'Jurnal', observasi: 'Catatan', forum: 'Forum',
    kurikulum: 'ATP',
};
const TAB_ICON = {
    guru: 'ti-home', wali_kelas: 'ti-users', bk: 'ti-heart-handshake', kaprodi: 'ti-building',
    waka_kesiswaan: 'ti-school', waka_kurikulum: 'ti-book', waka_humas: 'ti-briefcase',
    kepsek: 'ti-chart-line', ks_admin: 'ti-shield-check',
    kasus: 'ti-alert-triangle', jurnal: 'ti-notebook', observasi: 'ti-notes', forum: 'ti-messages',
    kurikulum: 'ti-school',
};

function buildTabs() {
    const nav    = document.getElementById('tab-nav');
    const botNav = document.getElementById('bottom-nav');
    const tabs = [];
    if (isTeacher) tabs.push({ key: 'guru', label: 'Dashboard Guru' });
    jabatan.forEach(j => tabs.push({ key: j, label: jabatanLabel(j) }));
    tabs.push({ key: 'kasus', label: 'Pembinaan Siswa' });
    if (jabatan.includes('kepsek')) tabs.push({ key: 'ks_admin', label: 'Kelola Admin' });
    if (isTeacher) tabs.push({ key: 'observasi', label: 'Catatan Siswa' });
    if (isTeacher) tabs.push({ key: 'jurnal', label: 'Jurnal Mengajar' });
    if (isTeacher) tabs.push({ key: 'kurikulum', label: 'Kurikulum Merdeka' });
    tabs.push({ key: 'forum', label: 'Forum Kelas' });

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
        case 'kurikulum':   await initKurikulumTab(); break;
        case 'forum':       await initForumTab(); break;
    }
}

// ─── TAB GURU ────────────────────────────────────────────────

let _guruTabInit     = false;
let _guruRekapRows      = [];
let _guruRekapPage      = 0;
let _guruRekapDateStart = null;
let _guruRekapDateEnd   = null;
let _guruRekapClassName = null;
async function initGuruTab() {
    const dateEl = document.getElementById('sched-date');
    if (!dateEl.value) dateEl.value = localDateStr();

    if (!_guruTabInit) {
        _guruTabInit = true;
        const recapBtn = document.getElementById('guru-recap-btn');
        recapBtn.addEventListener('click', async () => {
            const content = document.getElementById('guru-recap-content');
            if (recapBtn.textContent.trim() === 'Sembunyikan') {
                content.style.display = 'none';
                recapBtn.textContent = 'Tampilkan';
                return;
            }
            content.style.display = '';
            await loadGuruRecap();
        });
        // Default rentang: awal bulan ini s/d hari ini
        const today = localDateStr();
        const firstOfMonth = today.slice(0, 8) + '01';
        document.getElementById('guru-recap-start').value = firstOfMonth;
        document.getElementById('guru-recap-end').value   = today;
        await initGuruRekapDropdown();

        // Toggle hari / minggu — auto-load saat switch
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
    }

    await loadWeekSchedule();
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

function renderGuruRekapPage() {
    const container = document.getElementById('guru-rekap-accordion');
    if (!container) return;

    const STATUS_COLOR = {
        HADIR: 'var(--color-success)',
        IZIN:  'var(--color-warning,#f59e0b)',
        SAKIT: 'var(--color-primary)',
        ALPA:  'var(--color-danger)',
    };
    const STATUS_LABEL = { HADIR:'Hadir', IZIN:'Izin', SAKIT:'Sakit', ALPA:'Alpa' };

    container.innerHTML = _guruRekapRows
        .sort((a, b) => a.full_name.localeCompare(b.full_name, 'id'))
        .map(s => {
            const pct   = s.total > 0 ? Math.round(s.HADIR / s.total * 100) : null;
            const color = pct === null ? 'var(--color-text-muted)' : pct >= 80 ? 'var(--color-success)' : pct >= 60 ? 'var(--color-warning,#f59e0b)' : 'var(--color-danger)';
            return `
            <details class="att-accordion" style="margin-bottom:6px"
                     data-student-id="${esc(s.student_id)}"
                     data-date-start="${esc(_guruRekapDateStart ?? '')}"
                     data-date-end="${esc(_guruRekapDateEnd ?? '')}">
                <summary class="att-accordion-summary">
                    <span class="att-acc-name">
                        ${esc(s.full_name)}
                    </span>
                    <span style="display:flex;gap:10px;align-items:center;font-size:11px;font-weight:500">
                        <span>${s.HADIR}H · ${s.IZIN}I · ${s.SAKIT}S · ${s.ALPA}A</span>
                        <span style="color:${color};font-weight:600">${pct !== null ? pct + '%' : '—'}</span>
                    </span>
                </summary>
                <div style="padding:4px 0">
                    <p class="acc-empty">Memuat sesi…</p>
                </div>
            </details>`;
        }).join('');

    container.querySelectorAll('details[data-student-id]').forEach(det => {
        det.addEventListener('toggle', async () => {
            if (!det.open) return;
            const body = det.querySelector('div');
            if (!body || body.dataset.loaded) return;
            body.dataset.loaded = '1';
            const sid = det.dataset.studentId;
            const ds  = det.dataset.dateStart || null;
            const de  = det.dataset.dateEnd   || null;
            try {
                const sessions = await getStudentAttendanceSessions(sid, ds, de, currentUser.user_id);
                if (!sessions.length) {
                    body.innerHTML = '<p class="acc-empty">Belum ada sesi tercatat.</p>';
                    return;
                }
                body.innerHTML = sessions.map(s => `
                    <div style="display:flex;align-items:center;gap:8px;
                        padding:7px 16px;border-top:0.5px solid var(--color-border)">
                        <span style="font-size:12px;color:var(--color-text-muted);min-width:90px">
                            ${esc(s.schedule.session_date)} ${fmtTime(s.schedule.session_start)}
                        </span>
                        <span style="flex:1;font-size:12px;color:var(--color-text-muted)">
                            ${esc(s.schedule.subject?.name ?? '—')}
                        </span>
                        <span style="font-size:11px;font-weight:600;
                            color:${STATUS_COLOR[s.status] ?? 'var(--color-text-muted)'}">
                            ${STATUS_LABEL[s.status] ?? esc(s.status)}
                        </span>
                    </div>`).join('');
            } catch(err) {
                body.innerHTML = `<div class="alert alert-danger" style="margin:8px 16px">${esc(fe(err))}</div>`;
            }
        });
    });
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
        const enrolled = await getEnrolledStudents(classId, config.current_academic_year);
        if (enrolled.length === 0) {
            content.innerHTML = '<p class="hint">Belum ada siswa aktif di kelas ini untuk tahun ajaran ini.</p>';
            return;
        }
        const rows = await getAttendanceSummaryByStudents(classId, config.current_academic_year, dateStart || null, dateEnd || null, currentUser.user_id);

        _guruRekapRows      = rows;
        _guruRekapPage      = 0;
        _guruRekapDateStart = dateStart || null;
        _guruRekapDateEnd   = dateEnd   || null;
        _guruRekapClassName = className;

        content.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px">
                <p style="font-size:0.82rem;color:var(--color-text-muted);margin:0">
                    ${esc(className)} · ${rows.length} siswa · akumulasi ${dateStart || '—'} s/d ${dateEnd || '—'}
                </p>
                <button class="btn btn-secondary btn-sm" id="guru-recap-export">Unduh Excel</button>
            </div>
            <div id="guru-rekap-accordion"></div>`;

        document.getElementById('guru-recap-export').addEventListener('click', () => {
            const rows = _guruRekapRows;
            if (!rows.length) return;

            const wsData = [
                ['Nama', 'Hadir', 'Izin', 'Sakit', 'Alpa', 'Total Sesi', '% Hadir'],
                ...rows.map(s => {
                    const tot = s.HADIR + s.IZIN + s.SAKIT + s.ALPA;
                    const pct = tot > 0 ? Math.round(s.HADIR / tot * 100) : 0;
                    return [s.full_name, s.HADIR, s.IZIN, s.SAKIT, s.ALPA, s.total, tot > 0 ? pct + '%' : '—'];
                })
            ];

            const ws = XLSX.utils.aoa_to_sheet(wsData);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Rekap Kehadiran');
            const start = document.getElementById('guru-recap-start').value;
            const end   = document.getElementById('guru-recap-end').value;
            XLSX.writeFile(wb, `kehadiran_${_guruRekapClassName ?? 'kelas'}_${start}_${end}.xlsx`);
        });

        renderGuruRekapPage();
        document.getElementById('guru-recap-btn').textContent = 'Sembunyikan';
    } catch (err) {
        content.innerHTML = `<div class="status-err">Gagal memuat rekap. ${esc(fe(err))}</div>`;
    }
}

function localDateStr(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function fmtDayLabel(dateStr) {
    if (!dateStr) return '';
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function isConsecutive(endTime, startTime) {
    const toMin = t => { const [h, m] = t.slice(0, 5).split(':').map(Number); return h * 60 + m; };
    return toMin(startTime) - toMin(endTime) <= 40;
}

function mergeConsecutiveSessions(sessions) {
    const sorted = [...sessions].sort((a, b) => a.session_start.localeCompare(b.session_start));
    const merged = [];
    for (const s of sorted) {
        const last = merged[merged.length - 1];
        const sameBlock = last
            && last.class?.class_id === s.class?.class_id
            && isConsecutive(last.merged_end, s.session_start);
        if (sameBlock) {
            last.merged_end = s.session_end;
            last.schedule_ids.push(s.schedule_id);
        } else {
            merged.push({
                ...s,
                merged_start: s.session_start,
                merged_end:   s.session_end,
                schedule_ids: [s.schedule_id],
            });
        }
    }
    return merged;
}

function renderScheduleRows(rows, contentEl, date) {
    const today     = localDateStr();
    const isToday   = date === today;
    const label     = fmtDayLabel(date);
    const sesiCount = rows.length;
    const now       = new Date();
    const nowTime   = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;

    const mergedRows = mergeConsecutiveSessions(rows);
    const tableHtml = sesiCount === 0
        ? '<p class="hint" style="margin:8px 0 4px">Tidak ada jadwal mengajar pada tanggal ini.</p>'
        : `<div class="table-wrapper">
           <table class="table">
               <thead><tr><th>Jam</th><th>Kelas</th><th>Kehadiran</th></tr></thead>
               <tbody>
               ${mergedRows.map(r => {
                   const ended = date < today || (isToday && nowTime > r.merged_end);
                   return `
                   <tr>
                       <td>${fmtTime(r.merged_start)} – ${fmtTime(r.merged_end)}</td>
                       <td>${esc(r.class?.name ?? '—')}</td>
                       <td>
                           <button class="btn btn-secondary btn-xs att-open-btn"
                               data-schedule="${r.schedule_ids[0]}"
                               data-schedule-ids='${JSON.stringify(r.schedule_ids)}'
                               data-class="${r.class?.class_id}"
                               data-classname="${esc(r.class?.name ?? '')}"
                               data-ispast="${ended}"
                               ${ended ? 'disabled title="Sesi sudah berakhir — tidak dapat diubah"' : 'style="background:var(--color-primary);color:#fff;border-color:var(--color-primary)"'}>
                               ${ended ? 'Sesi Berakhir' : 'Input Kehadiran'}
                           </button>
                       </td>
                   </tr>`;
               }).join('')}
               </tbody>
           </table>
           </div>`;

    contentEl.innerHTML = `
        <details class="att-accordion" ${isToday || sesiCount > 0 ? 'open' : ''}>
            <summary class="att-accordion-summary">
                <span>${esc(label)}</span>
                <span class="att-acc-names">${sesiCount > 0 ? `${sesiCount} sesi` : 'tidak ada jadwal'}</span>
            </summary>
            <div style="padding:0 12px 8px">${tableHtml}</div>
        </details>`;

    contentEl.querySelectorAll('.att-open-btn').forEach(btn => {
        btn.addEventListener('click', () => openAttModal(btn));
    });
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
        (isPast ? '<p class="hint" style="background:var(--color-bg-alt);padding:8px 10px;border-radius:6px;margin-bottom:12px">Data kehadiran sebelumnya sudah ditampilkan. Ubah jika perlu lalu klik Simpan.</p>' : '') +
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
            contentEl.innerHTML = `<div class="status-err">Gagal memuat data. ${esc(fe(err))}</div>`;
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
        const todayStr  = localDateStr();
        contentEl.innerHTML = results.map((r, idx) => {
            const dayLabel  = `${DAY_NAMES[idx]}, ${fmtDayLabel(r.date).split(',')[1]?.trim() ?? r.date}`;
            const isToday   = r.date === todayStr;
            const mergedSessions = mergeConsecutiveSessions(r.rows);
            const sesiCount = mergedSessions.length;
            const tableHtml = sesiCount === 0
                ? '<p class="hint" style="margin:8px 0 4px">Tidak ada jadwal</p>'
                : `<div class="table-wrapper">
                   <table class="table">
                       <thead><tr><th>Jam</th><th>Kelas</th></tr></thead>
                       <tbody>${mergedSessions.map(s => `
                           <tr>
                               <td>${fmtTime(s.merged_start)} – ${fmtTime(s.merged_end)}</td>
                               <td>${esc(s.class?.name ?? '—')}</td>
                           </tr>`).join('')}
                       </tbody>
                   </table>
                   </div>`;

            return `
                <details class="att-accordion">
                    <summary class="att-accordion-summary">
                        <span>${esc(dayLabel)}</span>
                        <span class="att-acc-names">${sesiCount > 0 ? `${sesiCount} sesi` : 'tidak ada jadwal'}</span>
                    </summary>
                    <div style="padding:0 12px 8px">${tableHtml}</div>
                </details>`;
        }).join('');

        // Single-expand: tutup semua accordion lain saat satu dibuka
        contentEl.querySelectorAll('details.att-accordion').forEach(det => {
            det.addEventListener('toggle', () => {
                if (det.open) {
                    contentEl.querySelectorAll('details.att-accordion').forEach(other => {
                        if (other !== det) other.removeAttribute('open');
                    });
                }
            });
        });

        contentEl.querySelectorAll('.att-open-btn').forEach(btn => {
            btn.addEventListener('click', () => openAttModal(btn));
        });
    } catch (err) {
        contentEl.innerHTML = `<div class="status-err">Gagal memuat. ${esc(fe(err))}</div>`;
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

        const statuses = ['HADIR','IZIN','SAKIT','ALPA'];
        const statusLabel = { HADIR:'Hadir', IZIN:'Izin', SAKIT:'Sakit', ALPA:'Alpa' };

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
                    </div>
                    <div class="att-radio-group">${radios}</div>
                    <input type="text" id="notes_${scheduleId}_${s.student_id}"
                           class="input att-notes-input"
                           placeholder="Alasan izin (opsional)…"
                           value="${esc(curNotes)}"
                           style="display:${cur === 'IZIN' ? 'block' : 'none'}; margin-top:4px; width:100%; font-size:0.85em">
                </div>`;
        }

        // Carousel per-5-siswa
        const CHUNK = 5;
        const chunks = [];
        for (let i = 0; i < students.length; i += CHUNK)
            chunks.push(students.slice(i, i + CHUNK));

        const slidesHtml = chunks.map(group => `
            <div class="att-carousel-slide">${group.map(renderStudentRow).join('')}</div>`).join('');

        const lastChunkEnd = students.length;
        panel.innerHTML = `
            <div class="att-carousel-nav">
                <button class="att-prev" aria-label="Sebelumnya">&#8592;</button>
                <div class="att-carousel-counter">
                    Siswa <span class="att-cur-range">1–${Math.min(CHUNK, students.length)}</span> / ${students.length}
                </div>
                <button class="att-next" aria-label="Berikutnya">&#8594;</button>
            </div>
            <div class="att-carousel-track-wrap">
                <div class="att-carousel-track">${slidesHtml}</div>
            </div>
            <div class="att-save-btn">
                <button class="btn btn-success btn-sm att-save" data-schedule="${scheduleId}" data-count="${students.length}">
                    Simpan Kehadiran (${students.length} siswa)
                </button>
                <span class="status-msg" id="att-status-${scheduleId}" style="display:none; margin-left:8px"></span>
            </div>`;

        // Carousel logic
        let cur = 0;
        const track    = panel.querySelector('.att-carousel-track');
        const curRange = panel.querySelector('.att-cur-range');
        const prevBtn  = panel.querySelector('.att-prev');
        const nextBtn  = panel.querySelector('.att-next');

        function goTo(idx) {
            cur = Math.max(0, Math.min(chunks.length - 1, idx));
            track.style.transform = `translateX(-${cur * 100}%)`;
            const start = cur * CHUNK + 1;
            const end   = Math.min(start + CHUNK - 1, students.length);
            curRange.textContent = `${start}–${end}`;
            prevBtn.disabled = cur === 0;
            nextBtn.disabled = cur === chunks.length - 1;
        }
        goTo(0);
        prevBtn.addEventListener('click', () => goTo(cur - 1));
        nextBtn.addEventListener('click', () => goTo(cur + 1));

        // Touch swipe
        let tx0 = null;
        track.parentElement.addEventListener('touchstart', e => { tx0 = e.touches[0].clientX; }, { passive: true });
        track.parentElement.addEventListener('touchend', e => {
            if (tx0 === null) return;
            const dx = e.changedTouches[0].clientX - tx0;
            if (Math.abs(dx) > 40) goTo(dx < 0 ? cur + 1 : cur - 1);
            tx0 = null;
        }, { passive: true });

        const scheduleIds = (() => { try { return JSON.parse(document.querySelector(`.att-open-btn[data-schedule="${scheduleId}"]`)?.dataset?.scheduleIds ?? 'null'); } catch { return null; } })() ?? [scheduleId];
        panel.querySelector('.att-save').addEventListener('click', () => saveAttendance(scheduleIds, students));
    } catch (err) {
        panel.innerHTML = `<div class="status-err">Gagal memuat data. ${esc(fe(err))}</div>`;
    }
}

async function saveAttendance(scheduleIds, students) {
    const scheduleId = Array.isArray(scheduleIds) ? scheduleIds[0] : scheduleIds;
    const allIds     = Array.isArray(scheduleIds) ? scheduleIds : [scheduleIds];
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

        const sessionDate = document.getElementById('sched-date').value;
        const results = await Promise.all(allIds.map(sid => saveAttendanceBatch({
            idempotency_key: crypto.randomUUID(),
            schedule_id:     sid,
            submitted_by:    currentUser.user_id,
            session_date:    sessionDate,
            records,
        })));

        const anyQueued = results.some(r => r.status === 'queued');
        const anyFailed = results.find(r => r.status !== 'synced' && r.status !== 'queued');
        if (anyFailed) {
            statusEl.textContent = `✗ ${anyFailed.error}`;
            statusEl.className   = 'status-msg status-err';
            statusEl.style.display = 'inline-block';
            await updateSyncBanner();
        } else if (anyQueued) {
            statusEl.textContent = `⏳ Tersimpan di perangkat — menunggu sinkron (${records.length} siswa × ${allIds.length} sesi)`;
            statusEl.className   = 'status-msg status-warn';
            statusEl.style.display = 'inline-block';
            await updateSyncBanner();
            setTimeout(() => closeAttModal(), 1800);
        } else {
            statusEl.textContent = `✓ Tersimpan — ${records.length} siswa × ${allIds.length} sesi`;
            statusEl.className   = 'status-msg status-ok';
            statusEl.style.display = 'inline-block';
            await updateSyncBanner();
            setTimeout(() => closeAttModal(), 1200);
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
        el.className = 'sync-banner';
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

// ── Student pool (dipakai Observasi & Kasus) ─────────────────

async function ensureStudentPool() {
    if (_studentPoolInit) return;
    _studentPoolInit = true;
    isBroadObserver = jabatan.some(j => ['bk', 'waka_kesiswaan', 'kepsek'].includes(j));
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
}

// ── Observasi ─────────────────────────────────────────────────

let _obsFormInit = false;
async function initObsForm() {
    if (_obsFormInit) return;
    _obsFormInit = true;
    await ensureStudentPool();

    const searchEl      = document.getElementById('obs-student-search');
    const hiddenEl      = document.getElementById('obs-student-id');
    const listEl        = document.getElementById('obs-student-list');
    const form          = document.getElementById('obs-form');
    const submitBtn     = document.getElementById('obs-submit');
    const statusEl      = document.getElementById('obs-status');
    const obsContentEl  = document.getElementById('obs-content');
    const obsCharCountEl= document.getElementById('obs-char-count');
    const visSelect     = document.getElementById('obs-visibility');
    obsContentEl.addEventListener('input', () => {
        obsCharCountEl.textContent = obsContentEl.value.length;
    });

    // Audience ditentukan oleh select obs-visibility — tidak ada picker.

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
            statusEl.textContent = r.status === 'queued'
                ? '⏳ Catatan disimpan lokal — akan dikirim saat online.'
                : '✓ Catatan berhasil disimpan.';
            statusEl.className = 'status-msg status-ok';
            statusEl.style.display = 'block';
            form.reset();
            hiddenEl.value = '';
            if (r.status === 'synced') await loadObsHistory();
        } catch (err) {
            statusEl.textContent   = `✗ ${fe(err, 's')}`;
            statusEl.className     = 'status-msg status-err';
            statusEl.style.display = 'block';
        } finally {
            submitBtn.disabled    = false;
            submitBtn.textContent = 'Simpan Catatan';
        }
    });
}

async function initObsTab() {
    await initObsForm();
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
        if (!cached) listEl.innerHTML = `<div class="status-err">Gagal memuat. ${esc(fe(err))}</div>`;
    }
}

const DIMENSION_LABELS_OBS = { AKADEMIK:'Akademik', KEHADIRAN:'Kehadiran', PERILAKU:'Perilaku', SOSIAL:'Sosial', AFEKTIF:'Afektif', BAKAT_MINAT:'Bakat & Minat', FISIK:'Fisik', LAINNYA:'Lainnya' };
const SENTIMENT_LABELS = { POSITIF:'Positif', NETRAL:'Netral', NEGATIF:'Perlu Perhatian' };
const SENTIMENT_COLOR  = { POSITIF:'var(--color-success)', NETRAL:'var(--color-text-muted)', NEGATIF:'var(--color-danger)' };

const OBS_VIS_LABEL = {
    SISWA_SAJA:    '🎓 Siswa saja',
    ORTU_SAJA:     '👨‍👩‍👧 Orang Tua saja',
    SISWA_DAN_ORTU:'👨‍👩‍👦 Siswa & Orang Tua',
};

function renderObsHistory(rows, listEl) {
    if (!rows.length) {
        listEl.innerHTML = '<p class="hint">Belum ada catatan yang ditulis.</p>';
        return;
    }
    listEl.innerHTML = rows.map(r => {
        const nama      = r.student?.full_name ?? '—';
        const nis       = r.student?.nis ? ` · ${r.student.nis}` : '';
        const dim       = DIMENSION_LABELS_OBS[r.dimension] ?? r.dimension;
        const sent      = SENTIMENT_LABELS[r.sentiment]  ?? r.sentiment;
        const sentColor = SENTIMENT_COLOR[r.sentiment] ?? 'inherit';
        const vis      = r.visibility ?? 'SISWA_DAN_ORTU';
        const visLabel = OBS_VIS_LABEL[vis] ?? vis;
        const visColor  = 'var(--color-primary)';
        const isVoid    = !!r.is_void;
        const voidStyle = isVoid ? 'opacity:0.55;' : '';
        return `
        <div data-obs-id="${esc(r.observation_id)}" data-obs-vis="${esc(vis)}"
             data-student-id="${esc(r.student_id ?? '')}"
             data-author-id="${esc(r.author_user_id ?? '')}"
             data-student-name="${esc(r.student?.full_name ?? '')}"
             style="border-bottom:0.5px solid var(--color-border);padding:10px 0;font-size:13px;${voidStyle}">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:4px">
                <strong>${esc(nama)}<span style="font-weight:400;color:var(--color-text-muted)">${esc(nis)}</span></strong>
                <span style="font-size:11px;color:var(--color-text-muted)">${fmt(r.observed_at)}</span>
            </div>
            ${isVoid ? `<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;font-size:11px;color:var(--color-danger)">
                <span>⊘ Disembunyikan oleh admin</span>
                ${r.void_reason ? `<span style="color:var(--color-text-muted)">— ${esc(r.void_reason)}</span>` : ''}
            </div>` : ''}
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;align-items:center">
                <span style="font-size:11px;padding:2px 8px;border-radius:20px;background:var(--color-bg-alt)">${esc(dim)}</span>
                <span style="font-size:11px;padding:2px 8px;border-radius:20px;color:${sentColor};background:var(--color-bg-alt)">${esc(sent)}</span>
                <span style="font-size:11px;padding:2px 8px;border-radius:20px;color:${visColor};background:var(--color-bg-alt)">${visLabel}</span>
            </div>
            <p style="margin:0 0 6px;white-space:pre-wrap;color:var(--color-text)">${esc(r.content)}</p>
        </div>`;
    }).join('');

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

    document.getElementById('wali-recap-export').onclick = async () => {
        const btn = document.getElementById('wali-recap-export');
        btn.disabled = true;
        btn.textContent = 'Menyiapkan…';

        try {
            const classId   = currentUser.wali_kelas_class_id;
            const dateStart = document.getElementById('wali-date-start').value;
            const dateEnd   = document.getElementById('wali-date-end').value;

            const students = await getWaliAttendanceSummary(classId, config.current_academic_year, dateStart, dateEnd);

            const allSessions = await Promise.all(
                students.map(s => getStudentAttendanceSessions(s.student_id, dateStart, dateEnd)
                    .then(sessions => ({ student: s, sessions }))
                )
            );

            const wb = XLSX.utils.book_new();

            const summaryData = [
                ['Nama', 'Hadir', 'Izin', 'Sakit', 'Alpa', 'Total Sesi', '% Hadir'],
                ...students.map(s => {
                    const tot = s.HADIR + s.IZIN + s.SAKIT + s.ALPA;
                    const pct = tot > 0 ? Math.round(s.HADIR / tot * 100) : 0;
                    return [s.full_name, s.HADIR, s.IZIN, s.SAKIT, s.ALPA, s.total,
                            tot > 0 ? pct + '%' : '—'];
                })
            ];
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryData), 'Ringkasan');

            for (const { student, sessions } of allSessions) {
                const sheetData = [
                    ['Tanggal', 'Jam', 'Mata Pelajaran', 'Guru', 'Status'],
                    ...sessions.map(s => [
                        s.schedule?.session_date ?? '',
                        s.schedule?.session_start ? fmtTime(s.schedule.session_start) : '',
                        s.schedule?.subject?.name ?? '',
                        s.schedule?.teacher?.full_name ?? '',
                        s.status ?? '',
                    ])
                ];
                const sheetName = student.full_name.slice(0, 31);
                XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheetData), sheetName);
            }

            const className = document.getElementById('wali-class-title')
                .textContent.replace('Kelas Walian — ', '').trim();
            XLSX.writeFile(wb, `rekap_wali_${className}_${dateStart}_${dateEnd}.xlsx`);

        } catch (err) {
            alert('Gagal mengunduh: ' + fe(err));
        } finally {
            btn.disabled = false;
            btn.textContent = 'Unduh Excel';
        }
    };

    await loadWaliSummary();
}

async function loadWaliSummary() {
    const classId   = currentUser.wali_kelas_class_id;
    const dateStart = document.getElementById('wali-date-start').value || null;
    const dateEnd   = document.getElementById('wali-date-end').value   || null;
    const container = document.getElementById('wali-att-recap');
    container.innerHTML = '<p class="hint">Memuat…</p>';

    try {
        const students = await getWaliAttendanceSummary(
            classId, config.current_academic_year, dateStart, dateEnd
        );
        if (!students.length) {
            container.innerHTML = '<p class="hint">Belum ada siswa di kelas ini.</p>';
            return;
        }

        container.innerHTML = buildAttStatCards(students) + students
            .sort((a, b) => a.full_name.localeCompare(b.full_name, 'id'))
            .map(s => {
                const pct   = s.total > 0 ? Math.round(s.HADIR / s.total * 100) : null;
                const color = pct === null ? 'var(--color-text-muted)' : pct >= 80 ? 'var(--color-success)' : pct >= 60 ? 'var(--color-warning,#f59e0b)' : 'var(--color-danger)';
                return `
                <details class="att-accordion" style="margin-bottom:6px"
                         data-student-id="${esc(s.student_id)}"
                         data-date-start="${esc(dateStart ?? '')}"
                         data-date-end="${esc(dateEnd ?? '')}">
                    <summary class="att-accordion-summary">
                        <span class="att-acc-name">
                            ${esc(s.full_name)}
                        </span>
                        <span class="att-acc-status" style="color:${color};font-weight:600">
                            ${pct !== null ? pct + '%' : '—'}
                        </span>
                    </summary>
                    <div style="padding:4px 0">
                        <p class="acc-empty">Memuat sesi…</p>
                    </div>
                </details>`;
            }).join('');

        // Lazy load sesi per siswa
        container.querySelectorAll('details[data-student-id]').forEach(det => {
            det.addEventListener('toggle', async () => {
                if (!det.open) return;
                const body = det.querySelector('div');
                if (!body || body.dataset.loaded) return;
                body.dataset.loaded = '1';
                const sid = det.dataset.studentId;
                const ds  = det.dataset.dateStart || null;
                const de  = det.dataset.dateEnd   || null;
                try {
                    const sessions = await getStudentAttendanceSessions(sid, ds, de);
                    if (!sessions.length) {
                        body.innerHTML = '<p class="acc-empty">Belum ada sesi tercatat.</p>';
                        return;
                    }
                    const STATUS_COLOR = {
                        HADIR: 'var(--color-success)',
                        IZIN:  'var(--color-warning,#f59e0b)',
                        SAKIT: 'var(--color-primary)',
                        ALPA: 'var(--color-danger)',
                    };
                    const STATUS_LABEL = { HADIR:'Hadir', IZIN:'Izin', SAKIT:'Sakit', ALPA:'Alpa' };
                    body.innerHTML = sessions.map(s => `
                        <div style="display:flex;align-items:center;gap:8px;
                            padding:7px 16px;border-top:0.5px solid var(--color-border)">
                            <span style="font-size:12px;color:var(--color-text-muted);min-width:90px">
                                ${esc(s.schedule.session_date)} ${fmtTime(s.schedule.session_start)}
                            </span>
                            <span style="flex:1;font-size:12px;color:var(--color-text-muted)">
                                ${esc(s.schedule.subject?.name ?? '—')} · ${esc(s.schedule.teacher?.full_name ?? '—')}
                            </span>
                            <span style="font-size:11px;font-weight:600;
                                color:${STATUS_COLOR[s.status] ?? 'var(--color-text-muted)'}">
                                ${STATUS_LABEL[s.status] ?? esc(s.status)}
                            </span>
                        </div>`).join('');
                } catch(err) {
                    body.innerHTML = `<div class="alert alert-danger" style="margin:8px 16px">${esc(fe(err))}</div>`;
                }
            });
        });

        document.getElementById('wali-recap-export').style.display = '';

    } catch (err) {
        container.innerHTML = `<div class="alert alert-danger">${esc(fe(err))}</div>`;
    }
}

// ─── TAB BK ──────────────────────────────────────────────────

async function initBkTab() {
    const today        = localDateStr();
    const firstOfMonth = today.slice(0, 8) + '01';
    document.getElementById('bk-att-start').value = firstOfMonth;
    document.getElementById('bk-att-end').value   = today;
    document.getElementById('bk-att-filter-btn').onclick = loadBkAttendanceRecap;
    await loadBkAttendanceRecap();
}

async function loadBkAttendanceRecap() {
    const dateStart = document.getElementById('bk-att-start').value || null;
    const dateEnd   = document.getElementById('bk-att-end').value   || null;
    const container = document.getElementById('bk-att-recap');
    container.innerHTML = '<p class="hint">Memuat…</p>';
    try {
        const [programs, rows] = await Promise.all([
            getPrograms(),
            getAttendanceRecapPerClass(dateStart, dateEnd),
        ]);

        if (!rows.length) {
            container.innerHTML = '<p class="hint">Belum ada data kehadiran.</p>';
            return;
        }

        const classMap = new Map(rows.map(r => [r.class_id, r]));
        const progMap  = new Map();
        for (const prog of programs) progMap.set(prog.program_id, { ...prog, classes: [] });

        const { data: classProgData, error: cpErr } = await supabase
            .from('classes')
            .select('class_id, program_id')
            .in('class_id', rows.map(r => r.class_id));
        if (cpErr) throw cpErr;

        for (const cp of classProgData ?? []) {
            const prog = progMap.get(cp.program_id);
            const cls  = classMap.get(cp.class_id);
            if (prog && cls) prog.classes.push(cls);
        }

        const activeProgs = [...progMap.values()].filter(p => p.classes.length > 0);

        const html = activeProgs.map(prog => {
            const classAccordions = prog.classes
                .sort((a, b) => a.name.localeCompare(b.name, 'id'))
                .map(r => {
                    const tot  = r.HADIR + r.IZIN + r.SAKIT + r.ALPA;
                    const pctH = tot > 0 ? Math.round(r.HADIR       / tot * 100) : 0;
                    const pctI = tot > 0 ? Math.round(r.IZIN        / tot * 100) : 0;
                    const pctS = tot > 0 ? Math.round(r.SAKIT       / tot * 100) : 0;
                    const pctA = tot > 0 ? Math.round(r.ALPA / tot * 100) : 0;
                    const colH = pctH >= 80 ? 'var(--color-success)' : pctH >= 60 ? 'var(--color-warning,#f59e0b)' : 'var(--color-danger)';
                    return `
                    <details class="att-accordion wz-accordion-inner" style="margin:4px 0 4px 16px">
                        <summary class="att-accordion-summary">
                            <span>${esc(r.name)}</span>
                            <span class="att-acc-names" style="display:flex;gap:10px;font-size:11px;font-weight:500">
                                <span style="color:${colH}">${pctH}%H</span>
                                <span style="color:var(--color-warning,#f59e0b)">${pctI}%I</span>
                                <span style="color:var(--color-primary)">${pctS}%S</span>
                                <span style="color:var(--color-danger)">${pctA}%A</span>
                            </span>
                        </summary>
                        <div data-class-id="${esc(r.class_id)}"
                             data-date-start="${esc(dateStart ?? '')}"
                             data-date-end="${esc(dateEnd ?? '')}"
                             style="padding:4px 0">
                            <p class="hint" style="padding:8px 16px">Memuat siswa…</p>
                        </div>
                    </details>`;
                }).join('');

            return `
            <details class="att-accordion" style="margin-bottom:8px">
                <summary class="att-accordion-summary">
                    <span>${esc(prog.name)}</span>
                    <span class="att-acc-names">${prog.classes.length} kelas</span>
                </summary>
                <div style="padding:4px 0">${classAccordions}</div>
            </details>`;
        }).join('');

        container.innerHTML = buildAttStatCards(rows) + html;

        container.querySelectorAll('details.wz-accordion-inner').forEach(det => {
            det.addEventListener('toggle', async () => {
                if (!det.open) return;
                const body = det.querySelector('[data-class-id]');
                if (!body || body.dataset.loaded) return;
                body.dataset.loaded = '1';
                const classId = body.dataset.classId;
                const dStart  = body.dataset.dateStart || null;
                const dEnd    = body.dataset.dateEnd   || null;
                try {
                    const students = await getWaliAttendanceSummary(
                        classId, config.current_academic_year, dStart, dEnd
                    );
                    if (!students.length) {
                        body.innerHTML = '<p class="hint" style="padding:8px 16px">Belum ada data kehadiran siswa.</p>';
                        return;
                    }
                    body.innerHTML = students
                        .sort((a, b) => a.full_name.localeCompare(b.full_name, 'id'))
                        .map(s => {
                            const pct   = s.total > 0 ? Math.round(s.HADIR / s.total * 100) : null;
                            const color = pct === null ? 'var(--color-text-muted)' : pct >= 80 ? 'var(--color-success)' : pct >= 60 ? 'var(--color-warning,#f59e0b)' : 'var(--color-danger)';
                            return `
                            <details class="att-accordion wz-accordion-inner"
                                     style="margin:4px 8px 4px 24px"
                                     data-student-id="${esc(s.student_id)}"
                                     data-date-start="${esc(dStart ?? '')}"
                                     data-date-end="${esc(dEnd ?? '')}">
                                <summary class="att-accordion-summary">
                                    <span>
                                        ${esc(s.full_name)}
                                        <span class="sub-label" style="margin-left:4px">${esc(s.nis)}</span>
                                    </span>
                                    <span style="color:${color};font-weight:600">
                                        ${pct !== null ? pct + '%' : '—'}
                                    </span>
                                </summary>
                                <div style="padding:4px 0">
                                    <p class="hint" style="padding:8px 24px">Memuat sesi…</p>
                                </div>
                            </details>`;
                        }).join('');

                    body.querySelectorAll('details[data-student-id]').forEach(stuDet => {
                        stuDet.addEventListener('toggle', async () => {
                            if (!stuDet.open) return;
                            const sBody = stuDet.querySelector('div');
                            if (!sBody || sBody.dataset.loaded) return;
                            sBody.dataset.loaded = '1';
                            const sid = stuDet.dataset.studentId;
                            const ds  = stuDet.dataset.dateStart || null;
                            const de  = stuDet.dataset.dateEnd   || null;
                            try {
                                const sessions = await getStudentAttendanceSessions(sid, ds, de);
                                if (!sessions.length) {
                                    sBody.innerHTML = '<p class="hint" style="padding:8px 24px">Belum ada sesi tercatat.</p>';
                                    return;
                                }
                                const STATUS_COLOR = {
                                    HADIR: 'var(--color-success)',
                                    IZIN:  'var(--color-warning,#f59e0b)',
                                    SAKIT: 'var(--color-primary)',
                                    ALPA: 'var(--color-danger)',
                                };
                                const STATUS_LABEL = { HADIR: 'Hadir', IZIN: 'Izin', SAKIT: 'Sakit', ALPA: 'Alpa' };
                                sBody.innerHTML = sessions.map(s => `
                                    <div style="display:flex;align-items:center;gap:8px;
                                        padding:7px 24px;border-top:0.5px solid var(--color-border)">
                                        <span style="font-size:12px;color:var(--color-text-muted);min-width:90px">
                                            ${esc(s.schedule.session_date)} ${fmtTime(s.schedule.session_start)}
                                        </span>
                                        <span style="flex:1;font-size:12px;color:var(--color-text-muted)">
                                            ${esc(s.schedule.subject?.name ?? '—')} · ${esc(s.schedule.teacher?.full_name ?? '—')}
                                        </span>
                                        <span style="font-size:11px;font-weight:600;
                                            color:${STATUS_COLOR[s.status] ?? 'var(--color-text-muted)'}">
                                            ${STATUS_LABEL[s.status] ?? esc(s.status)}
                                        </span>
                                    </div>`).join('');
                            } catch(err) {
                                sBody.innerHTML = `<div class="alert alert-danger" style="margin:8px 24px">${esc(fe(err))}</div>`;
                            }
                        });
                    });
                } catch (err) {
                    body.innerHTML = `<div class="alert alert-danger" style="margin:8px 16px">${esc(fe(err))}</div>`;
                }
            });
        });

    } catch (err) {
        container.innerHTML = `<div class="alert alert-danger">${esc(fe(err))}</div>`;
    }
}

// ─── TAB WAKA KESISWAAN ──────────────────────────────────────

async function initWakaKesiswaanTab() {
    const today        = localDateStr();
    const firstOfMonth = today.slice(0, 8) + '01';
    document.getElementById('wk-att-start').value = firstOfMonth;
    document.getElementById('wk-att-end').value   = today;
    document.getElementById('wk-att-filter-btn').onclick = loadWkAttendanceRecap;

    await loadWkAttendanceRecap();
}

function buildAttStatCards(rows) {
    const tot  = rows.reduce((s,r) => s + r.HADIR + r.IZIN + r.SAKIT + r.ALPA, 0);
    const h    = rows.reduce((s,r) => s + r.HADIR,       0);
    const i    = rows.reduce((s,r) => s + r.IZIN,        0);
    const sk   = rows.reduce((s,r) => s + r.SAKIT,       0);
    const a    = rows.reduce((s,r) => s + r.ALPA, 0);
    const pctH = tot > 0 ? Math.round(h  / tot * 100) : 0;
    const pctI = tot > 0 ? Math.round(i  / tot * 100) : 0;
    const pctS = tot > 0 ? Math.round(sk / tot * 100) : 0;
    const pctA = tot > 0 ? Math.round(a  / tot * 100) : 0;
    const muted = 'var(--color-text-muted)';
    const colH = tot === 0 ? muted : pctH >= 80 ? 'var(--color-success)' : pctH >= 60 ? 'var(--color-warning,#f59e0b)' : 'var(--color-danger)';
    const colI = tot === 0 ? muted : 'var(--color-warning,#f59e0b)';
    const colS = tot === 0 ? muted : 'var(--color-primary)';
    const colA = tot === 0 ? muted : 'var(--color-danger)';
    const lbl  = 'font-size:11px;color:var(--color-text-muted);margin-top:2px';
    return `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px">
        <div style="background:var(--color-bg);border:0.5px solid var(--color-border);border-radius:var(--radius);padding:10px;text-align:center">
            <div style="font-size:20px;font-weight:500;color:${colH}">${pctH}%</div>
            <div style="${lbl}">Hadir</div>
        </div>
        <div style="background:var(--color-bg);border:0.5px solid var(--color-border);border-radius:var(--radius);padding:10px;text-align:center">
            <div style="font-size:20px;font-weight:500;color:${colI}">${pctI}%</div>
            <div style="${lbl}">Izin</div>
        </div>
        <div style="background:var(--color-bg);border:0.5px solid var(--color-border);border-radius:var(--radius);padding:10px;text-align:center">
            <div style="font-size:20px;font-weight:500;color:${colS}">${pctS}%</div>
            <div style="${lbl}">Sakit</div>
        </div>
        <div style="background:var(--color-bg);border:0.5px solid var(--color-border);border-radius:var(--radius);padding:10px;text-align:center">
            <div style="font-size:20px;font-weight:500;color:${colA}">${pctA}%</div>
            <div style="${lbl}">Alpa</div>
        </div>
    </div>`;
}

async function loadWkAttendanceRecap() {
    const dateStart = document.getElementById('wk-att-start').value || null;
    const dateEnd   = document.getElementById('wk-att-end').value   || null;
    const container = document.getElementById('wk-att-recap');
    container.innerHTML = '<p class="hint">Memuat…</p>';
    try {
        const [programs, rows] = await Promise.all([
            getPrograms(),
            getAttendanceRecapPerClass(dateStart, dateEnd),
        ]);

        if (!rows.length) {
            container.innerHTML = '<p class="hint">Belum ada data kehadiran.</p>';
            return;
        }

        // Kelompokkan kelas per program
        const classMap = new Map(rows.map(r => [r.class_id, r]));
        const progMap  = new Map();
        for (const prog of programs) {
            progMap.set(prog.program_id, { ...prog, classes: [] });
        }

        // Ambil class → program mapping
        const { data: classProgData, error: cpErr } = await supabase
            .from('classes')
            .select('class_id, program_id')
            .in('class_id', rows.map(r => r.class_id));
        if (cpErr) throw cpErr;

        for (const cp of classProgData ?? []) {
            const prog = progMap.get(cp.program_id);
            const cls  = classMap.get(cp.class_id);
            if (prog && cls) prog.classes.push(cls);
        }

        // Filter program yang punya kelas
        const activeProgs = [...progMap.values()].filter(p => p.classes.length > 0);

        // Render accordion per program
        const html = activeProgs.map(prog => {
            const classAccordions = prog.classes
                .sort((a, b) => a.name.localeCompare(b.name, 'id'))
                .map(r => {
                    const tot  = r.HADIR + r.IZIN + r.SAKIT + r.ALPA;
                    const pctH = tot > 0 ? Math.round(r.HADIR       / tot * 100) : 0;
                    const pctI = tot > 0 ? Math.round(r.IZIN        / tot * 100) : 0;
                    const pctS = tot > 0 ? Math.round(r.SAKIT       / tot * 100) : 0;
                    const pctA = tot > 0 ? Math.round(r.ALPA / tot * 100) : 0;
                    const colH = pctH >= 80 ? 'var(--color-success)' : pctH >= 60 ? 'var(--color-warning,#f59e0b)' : 'var(--color-danger)';
                    const safeId = r.class_id.replace(/[^a-z0-9]/gi, '_');
                    return `
                    <details class="att-accordion wz-accordion-inner" style="margin:4px 0 4px 16px">
                        <summary class="att-accordion-summary">
                            <span>${esc(r.name)}</span>
                            <span class="att-acc-names" style="display:flex;gap:10px;font-size:11px;font-weight:500">
                                <span style="color:${colH}">${pctH}%H</span>
                                <span style="color:var(--color-warning,#f59e0b)">${pctI}%I</span>
                                <span style="color:var(--color-primary)">${pctS}%S</span>
                                <span style="color:var(--color-danger)">${pctA}%A</span>
                            </span>
                        </summary>
                        <div id="wkdet-body-${safeId}"
                             data-class-id="${esc(r.class_id)}"
                             data-date-start="${esc(dateStart ?? '')}"
                             data-date-end="${esc(dateEnd ?? '')}"
                             style="padding:4px 0">
                            <p class="hint" style="padding:8px 16px">Memuat siswa…</p>
                        </div>
                    </details>`;
                }).join('');

            return `
            <details class="att-accordion" style="margin-bottom:8px">
                <summary class="att-accordion-summary">
                    <span>${esc(prog.name)}</span>
                    <span class="att-acc-names">${prog.classes.length} kelas</span>
                </summary>
                <div style="padding:4px 0">${classAccordions}</div>
            </details>`;
        }).join('');

        container.innerHTML = buildAttStatCards(rows) + html;

        // Lazy load siswa saat accordion kelas dibuka
        container.querySelectorAll('details.wz-accordion-inner').forEach(det => {
            det.addEventListener('toggle', async () => {
                if (!det.open) return;
                const body = det.querySelector('[data-class-id]');
                if (!body || body.dataset.loaded) return;
                body.dataset.loaded = '1';

                const classId  = body.dataset.classId;
                const dStart   = body.dataset.dateStart || null;
                const dEnd     = body.dataset.dateEnd   || null;

                try {
                    const students = await getWaliAttendanceSummary(
                        classId, config.current_academic_year, dStart, dEnd
                    );
                    if (!students.length) {
                        body.innerHTML = '<p class="hint" style="padding:8px 16px">Belum ada data kehadiran siswa.</p>';
                        return;
                    }
                    body.innerHTML = students
                        .sort((a, b) => a.full_name.localeCompare(b.full_name, 'id'))
                        .map(s => {
                            const pct = s.total > 0 ? Math.round(s.HADIR / s.total * 100) : null;
                            const color = pct === null ? 'var(--color-text-muted)' : pct >= 80 ? 'var(--color-success)' : pct >= 60 ? 'var(--color-warning,#f59e0b)' : 'var(--color-danger)';
                            const safeId = s.student_id.replace(/[^a-z0-9]/gi, '_');
                            return `
                            <details class="att-accordion wz-accordion-inner"
                                     style="margin:4px 8px 4px 24px"
                                     data-student-id="${esc(s.student_id)}"
                                     data-date-start="${esc(dStart ?? '')}"
                                     data-date-end="${esc(dEnd ?? '')}">
                                <summary class="att-accordion-summary">
                                    <span>
                                        ${esc(s.full_name)}
                                        <span class="sub-label" style="margin-left:4px">${esc(s.nis)}</span>
                                    </span>
                                    <span style="color:${color};font-weight:600">
                                        ${pct !== null ? pct + '%' : '—'}
                                    </span>
                                </summary>
                                <div id="wkstu-body-${safeId}" style="padding:4px 0">
                                    <p class="hint" style="padding:8px 24px">Memuat sesi…</p>
                                </div>
                            </details>`;
                        }).join('');

                    // Lazy load sesi per siswa
                    body.querySelectorAll('details[data-student-id]').forEach(stuDet => {
                        stuDet.addEventListener('toggle', async () => {
                            if (!stuDet.open) return;
                            const sBody = stuDet.querySelector('[id^="wkstu-body-"]');
                            if (!sBody || sBody.dataset.loaded) return;
                            sBody.dataset.loaded = '1';
                            const sid    = stuDet.dataset.studentId;
                            const ds     = stuDet.dataset.dateStart || null;
                            const de     = stuDet.dataset.dateEnd   || null;
                            try {
                                const sessions = await getStudentAttendanceSessions(sid, ds, de);
                                if (!sessions.length) {
                                    sBody.innerHTML = '<p class="hint" style="padding:8px 24px">Belum ada sesi tercatat.</p>';
                                    return;
                                }
                                const STATUS_COLOR = {
                                    HADIR: 'var(--color-success)',
                                    IZIN:  'var(--color-warning,#f59e0b)',
                                    SAKIT: 'var(--color-primary)',
                                    ALPA: 'var(--color-danger)',
                                };
                                const STATUS_LABEL = { HADIR: 'Hadir', IZIN: 'Izin', SAKIT: 'Sakit', ALPA: 'Alpa' };
                                sBody.innerHTML = sessions.map(s => `
                                    <div style="display:flex;align-items:center;gap:8px;
                                        padding:7px 24px;border-top:0.5px solid var(--color-border)">
                                        <span style="font-size:12px;color:var(--color-text-muted);min-width:90px">
                                            ${esc(s.schedule.session_date)} ${fmtTime(s.schedule.session_start)}
                                        </span>
                                        <span style="flex:1;font-size:12px;color:var(--color-text-muted)">
                                            ${esc(s.schedule.subject?.name ?? '—')} · ${esc(s.schedule.teacher?.full_name ?? '—')}
                                        </span>
                                        <span style="font-size:11px;font-weight:600;
                                            color:${STATUS_COLOR[s.status] ?? 'var(--color-text-muted)'}">
                                            ${STATUS_LABEL[s.status] ?? esc(s.status)}
                                        </span>
                                    </div>`).join('');
                            } catch(err) {
                                sBody.innerHTML = `<div class="alert alert-danger" style="margin:8px 24px">${esc(fe(err))}</div>`;
                            }
                        });
                    });

                } catch (err) {
                    body.innerHTML = `<div class="alert alert-danger" style="margin:8px 16px">${esc(fe(err))}</div>`;
                }
            });
        });

    } catch (err) {
        container.innerHTML = `<div class="alert alert-danger">${esc(fe(err))}</div>`;
    }
}


const HANDLER_ROLE_LABELS = {
    GURU: 'Guru', WALI_KELAS: 'Wali Kelas', BK: 'BK', KAPRODI: 'Kaprodi',
    KEPSEK: 'Kepala Sekolah', WAKA_KESISWAAN: 'Waka Kesiswaan',
    WAKA_KURIKULUM: 'Waka Kurikulum', DUDI: 'DUDI',
};


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
    tbody.innerHTML = '<tr><td colspan="6" class="hint">Memuat…</td></tr>';
    empty.style.display = 'none';

    if (ids.length === 0) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
    try {
        const rows = await fetchPklAttendance(ids, start, end);
        const nameById = new Map(kpStudents.map(s => [s.student_id, { name: s.full_name, nis: s.nis }]));
        const recap = rows.map(r => ({ ...nameById.get(r.student_id), ...r }));
        if (recap.every(a => a.total === 0)) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
        tbody.innerHTML = recap.map(a => {
            const pct   = a.total > 0 ? Math.round(a.HADIR / a.total * 100) : 0;
            const color = pct >= 80 ? 'var(--color-success)' : pct >= 60 ? 'var(--color-warning,#f59e0b)' : 'var(--color-danger)';
            return `<tr>
                <td><span style="font-weight:500">${esc(a.name)}</span><br><span style="font-size:0.78rem;color:var(--color-text-muted)">${esc(a.nis ?? '—')}</span></td>
                <td style="text-align:center">${a.HADIR}</td>
                <td style="text-align:center">${a.IZIN}</td>
                <td style="text-align:center">${a.SAKIT}</td>
                <td style="text-align:center">${a.ALPA}</td>
                <td style="text-align:center;font-weight:600;color:${color}">${a.total > 0 ? pct+'%' : '—'}</td>
            </tr>`;
        }).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="6" style="color:var(--color-danger)">${esc(fe(err))}</td></tr>`;
    }
}

async function loadKpClsRecap() {
    const dateStart = document.getElementById('kp-cls-start').value || null;
    const dateEnd   = document.getElementById('kp-cls-end').value   || null;
    const container = document.getElementById('kp-cls-recap');
    container.innerHTML = '<p class="hint">Memuat…</p>';

    if (!kpAktifStudents.length) {
        container.innerHTML = '<p class="hint">Belum ada siswa aktif di program ini.</p>';
        return;
    }

    try {
        // Ambil kelas di program Kaprodi
        const classes = await getClassesByProgram(kpProgramId);
        if (!classes.length) {
            container.innerHTML = '<p class="hint">Belum ada kelas di program ini.</p>';
            return;
        }

        // Rekap agregat per kelas
        const allRows = await getAttendanceRecapPerClass(dateStart, dateEnd);
        const classIds = new Set(classes.map(c => c.class_id));
        const rows = allRows.filter(r => classIds.has(r.class_id));

        if (!rows.length) {
            container.innerHTML = '<p class="hint">Belum ada kelas di program ini untuk rentang tanggal tersebut.</p>';
            return;
        }

        const html = rows
            .sort((a, b) => a.name.localeCompare(b.name, 'id'))
            .map(r => {
                const tot  = r.HADIR + r.IZIN + r.SAKIT + r.ALPA;
                const pctH = tot > 0 ? Math.round(r.HADIR       / tot * 100) : 0;
                const pctI = tot > 0 ? Math.round(r.IZIN        / tot * 100) : 0;
                const pctS = tot > 0 ? Math.round(r.SAKIT       / tot * 100) : 0;
                const pctA = tot > 0 ? Math.round(r.ALPA / tot * 100) : 0;
                const colH = pctH >= 80 ? 'var(--color-success)' : pctH >= 60 ? 'var(--color-warning,#f59e0b)' : 'var(--color-danger)';
                return `
                <details class="att-accordion" style="margin-bottom:8px">
                    <summary class="att-accordion-summary">
                        <span>${esc(r.name)}</span>
                        <span class="att-acc-names" style="display:flex;gap:10px;font-size:11px;font-weight:500">
                            <span style="color:${colH}">${pctH}%H</span>
                            <span style="color:var(--color-warning,#f59e0b)">${pctI}%I</span>
                            <span style="color:var(--color-primary)">${pctS}%S</span>
                            <span style="color:var(--color-danger)">${pctA}%A</span>
                        </span>
                    </summary>
                    <div data-class-id="${esc(r.class_id)}"
                         data-date-start="${esc(dateStart ?? '')}"
                         data-date-end="${esc(dateEnd ?? '')}"
                         style="padding:4px 0">
                        <p class="hint" style="padding:8px 16px">Memuat siswa…</p>
                    </div>
                </details>`;
            }).join('');

        container.innerHTML = buildAttStatCards(rows) + html;

        // Lazy load siswa saat accordion kelas dibuka
        container.querySelectorAll('details.att-accordion').forEach(det => {
            det.addEventListener('toggle', async () => {
                if (!det.open) return;
                const body = det.querySelector('[data-class-id]');
                if (!body || body.dataset.loaded) return;
                body.dataset.loaded = '1';
                const classId = body.dataset.classId;
                const dStart  = body.dataset.dateStart || null;
                const dEnd    = body.dataset.dateEnd   || null;
                try {
                    const students = await getWaliAttendanceSummary(
                        classId, config.current_academic_year, dStart, dEnd
                    );
                    if (!students.length) {
                        body.innerHTML = '<p class="hint" style="padding:8px 16px">Belum ada data kehadiran siswa.</p>';
                        return;
                    }
                    body.innerHTML = students
                        .sort((a, b) => a.full_name.localeCompare(b.full_name, 'id'))
                        .map(s => {
                            const pct   = s.total > 0 ? Math.round(s.HADIR / s.total * 100) : null;
                            const color = pct === null ? 'var(--color-text-muted)' : pct >= 80 ? 'var(--color-success)' : pct >= 60 ? 'var(--color-warning,#f59e0b)' : 'var(--color-danger)';
                            return `
                            <details class="att-accordion wz-accordion-inner"
                                     style="margin:4px 8px 4px 24px"
                                     data-student-id="${esc(s.student_id)}"
                                     data-date-start="${esc(dStart ?? '')}"
                                     data-date-end="${esc(dEnd ?? '')}">
                                <summary class="att-accordion-summary">
                                    <span>
                                        ${esc(s.full_name)}
                                        <span class="sub-label" style="margin-left:4px">${esc(s.nis)}</span>
                                    </span>
                                    <span style="color:${color};font-weight:600">
                                        ${pct !== null ? pct + '%' : '—'}
                                    </span>
                                </summary>
                                <div style="padding:4px 0">
                                    <p class="hint" style="padding:8px 24px">Memuat sesi…</p>
                                </div>
                            </details>`;
                        }).join('');

                    body.querySelectorAll('details[data-student-id]').forEach(stuDet => {
                        stuDet.addEventListener('toggle', async () => {
                            if (!stuDet.open) return;
                            const sBody = stuDet.querySelector('div');
                            if (!sBody || sBody.dataset.loaded) return;
                            sBody.dataset.loaded = '1';
                            const sid = stuDet.dataset.studentId;
                            const ds  = stuDet.dataset.dateStart || null;
                            const de  = stuDet.dataset.dateEnd   || null;
                            try {
                                const sessions = await getStudentAttendanceSessions(sid, ds, de);
                                if (!sessions.length) {
                                    sBody.innerHTML = '<p class="hint" style="padding:8px 24px">Belum ada sesi tercatat.</p>';
                                    return;
                                }
                                const STATUS_COLOR = {
                                    HADIR: 'var(--color-success)',
                                    IZIN:  'var(--color-warning,#f59e0b)',
                                    SAKIT: 'var(--color-primary)',
                                    ALPA: 'var(--color-danger)',
                                };
                                const STATUS_LABEL = { HADIR: 'Hadir', IZIN: 'Izin', SAKIT: 'Sakit', ALPA: 'Alpa' };
                                sBody.innerHTML = sessions.map(s => `
                                    <div style="display:flex;align-items:center;gap:8px;
                                        padding:7px 24px;border-top:0.5px solid var(--color-border)">
                                        <span style="font-size:12px;color:var(--color-text-muted);min-width:90px">
                                            ${esc(s.schedule.session_date)} ${fmtTime(s.schedule.session_start)}
                                        </span>
                                        <span style="flex:1;font-size:12px;color:var(--color-text-muted)">
                                            ${esc(s.schedule.subject?.name ?? '—')} · ${esc(s.schedule.teacher?.full_name ?? '—')}
                                        </span>
                                        <span style="font-size:11px;font-weight:600;
                                            color:${STATUS_COLOR[s.status] ?? 'var(--color-text-muted)'}">
                                            ${STATUS_LABEL[s.status] ?? esc(s.status)}
                                        </span>
                                    </div>`).join('');
                            } catch(err) {
                                sBody.innerHTML = `<div class="alert alert-danger" style="margin:8px 24px">${esc(fe(err))}</div>`;
                            }
                        });
                    });
                } catch (err) {
                    body.innerHTML = `<div class="alert alert-danger" style="margin:8px 16px">${esc(fe(err))}</div>`;
                }
            });
        });

    } catch (err) {
        container.innerHTML = `<div class="alert alert-danger">${esc(fe(err))}</div>`;
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
        listEl.innerHTML = `<div class="status-err">${esc(fe(err))}</div>`;
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

let _wkKur1Visible = false;
let _wkKur2Visible = false;
let _wkKurTabInit  = false;

async function initWakaKurTab() {
    if (!_wkKurTabInit) {
        _wkKurTabInit = true;
        // Default Panel 2: 7 hari terakhir — selaras dengan scope Panel 1 (hari ini)
        const weekAgo = localDateStr(new Date(Date.now() - 6 * 86400000));
        document.getElementById('wk-kur-start').value = weekAgo;
        document.getElementById('wk-kur-end').value   = localDateStr();
        document.getElementById('wk-kur1-refresh').onclick = () => { loadWkKurStats(localDateStr(), localDateStr()); loadWkKur1(localDateStr()); };
        document.getElementById('wk-kur1-btn').onclick = handleWkKur1Btn;
        document.getElementById('wk-kur2-btn').onclick = handleWkKur2Btn;
    }
    // Selalu reload Panel 1 + stats saat tab dibuka agar data terbaru tampil
    await Promise.all([loadWkKurStats(localDateStr(), localDateStr()), loadWkKur1(localDateStr())]);
}

async function loadWkKurStats(dateStart, dateEnd, prefix = 'wk-kur', emptyMsg = 'Tidak ada sesi hari ini') {
    const elHadir       = document.getElementById(`${prefix}-val-hadir`);
    const elPending     = document.getElementById(`${prefix}-val-pending`);
    const elTidak       = document.getElementById(`${prefix}-val-tidak`);
    const elDetailSudah = document.getElementById(`${prefix}-detail-sudah`);
    const elDetailBelum = document.getElementById(`${prefix}-detail-belum`);
    const elDetailTidak = document.getElementById(`${prefix}-detail-tidak`);

    if (!elHadir) return;

    elHadir.textContent = '…'; elPending.textContent = '…'; elTidak.textContent = '…';

    try {
        const today = localDateStr();
        const isHariIniPanel = (dateStart === today && dateEnd === today)
            || (!dateStart && !dateEnd);

        let hariIniData, tidakData;

        if (isHariIniPanel) {
            // Panel 1: card 1+2 = hari ini, card 3 = 7 hari terakhir
            const sevenDaysAgo = new Date(Date.now() - 6 * 86400000).toISOString().split('T')[0];
            [hariIniData, tidakData] = await Promise.all([
                getAttendanceFillRate(today, today),
                getAttendanceFillRate(sevenDaysAgo, today),
            ]);
        } else {
            // Panel 2: semua card pakai rentang yang dipilih user
            hariIniData = await getAttendanceFillRate(dateStart, dateEnd);
            tidakData = hariIniData;
        }

        // Card 1 — Sudah isi
        elHadir.textContent = hariIniData.hadir;
        if (elDetailSudah) {
            elDetailSudah.textContent = hariIniData.total > 0
                ? `${hariIniData.hadir} dari ${hariIniData.total} sesi`
                : emptyMsg;
        }

        // Card 2 — Belum diisi
        elPending.textContent = hariIniData.pending;
        if (elDetailBelum) {
            elDetailBelum.textContent = hariIniData.pending > 0
                ? `${hariIniData.pending} sesi belum diisi`
                : 'semua sesi sudah diproses';
        }

        // Card 3 — Tidak hadir
        elTidak.textContent = tidakData.tidak;
        if (elDetailTidak) {
            elDetailTidak.textContent = isHariIniPanel
                ? `${tidakData.tidak} sesi, 7 hari terakhir`
                : `${tidakData.tidak} sesi dalam rentang ini`;
        }

    } catch (e) {
        elHadir.textContent = '!'; elPending.textContent = '!'; elTidak.textContent = '!';
        console.error('[loadWkKurStats]', e);
    }
}

async function loadWkKur1(date) {
    const hintEl = document.getElementById('wk-kur1-hint');
    const wrapEl = document.getElementById('wk-kur1-wrap');
    const tbody  = document.getElementById('wk-kur1-body');
    const btn    = document.getElementById('wk-kur1-btn');

    hintEl.style.display = 'none';
    wrapEl.style.display = 'none';
    btn.style.display    = 'none';

    try {
        const rows = await getPendingAttendanceSessions(date);
        tbody.innerHTML = rows.length === 0
            ? `<tr><td colspan="5" class="hint" style="text-align:center;padding:12px">✓ Tidak ada sesi yang menunggu pengisian absensi hari ini.</td></tr>`
            : rows.map((r, i) => `<tr>
            <td style="text-align:center">${i + 1}</td>
            <td>${esc(r.teacher?.full_name ?? '—')}</td>
            <td>${esc(r.subject?.name ?? '—')}</td>
            <td>${esc(r.class?.name ?? '—')}</td>
            <td>${fmtTime(r.session_start)} – ${fmtTime(r.session_end)}</td>
        </tr>`).join('');
        wrapEl.style.display = '';
        btn.style.display    = '';
        btn.textContent      = 'Sembunyikan';
        _wkKur1Visible = true;
    } catch (err) {
        hintEl.textContent   = `Gagal memuat data. ${fe(err)}`;
        hintEl.style.display = 'block';
    }
}

function handleWkKur1Btn() {
    const wrapEl = document.getElementById('wk-kur1-wrap');
    const btn    = document.getElementById('wk-kur1-btn');
    _wkKur1Visible = !_wkKur1Visible;
    wrapEl.style.display = _wkKur1Visible ? '' : 'none';
    btn.textContent      = _wkKur1Visible ? 'Sembunyikan' : 'Tampilkan';
}

async function loadWkKur2() {
    const hintEl    = document.getElementById('wk-kur2-hint');
    const wrapEl    = document.getElementById('wk-kur2-wrap');
    const tbody     = document.getElementById('wk-kur2-body');
    const btn       = document.getElementById('wk-kur2-btn');
    const dateStart = document.getElementById('wk-kur-start').value;
    const dateEnd   = document.getElementById('wk-kur-end').value;

    const statsRow = document.getElementById('wk-kur2-stats-row');
    hintEl.style.display    = 'none';
    wrapEl.style.display    = 'none';
    statsRow.style.display  = 'none';
    btn.disabled            = true;
    btn.textContent         = 'Memuat…';

    try {
        const [groups] = await Promise.all([
            getPendingSessionsByTeacher(dateStart || null, dateEnd || null),
            loadWkKurStats(dateStart || null, dateEnd || null, 'wk-kur2', 'Tidak ada sesi pada rentang ini'),
        ]);
        statsRow.style.display = 'grid';
        btn.disabled = false;
        if (groups.length === 0) {
            hintEl.textContent   = '✓ Tidak ada sesi yang menunggu pengisian absensi pada rentang ini.';
            hintEl.style.display = 'block';
            btn.textContent      = 'Sembunyikan';
            _wkKur2Visible = true;
            return;
        }

        const THRESHOLD = 10;
        let html = '';
        groups.forEach((row, idx) => {
            const count    = Number(row.jumlah);
            const alert    = count >= THRESHOLD;
            const detailId = `wk-kur2-detail-${idx}`;
            const color    = alert ? 'var(--color-danger,#ef4444)' : '';
            const badge    = alert
                ? `<span style="font-size:11px;background:var(--color-danger,#ef4444);color:#fff;border-radius:4px;padding:1px 6px;margin-left:6px">≥${THRESHOLD}×</span>`
                : '';
            html += `<tr style="cursor:pointer" onclick="_wkKur2ToggleDetail('${detailId}','${row.teacher_id}','${esc(dateStart||'')}','${esc(dateEnd||'')}')">
                <td style="text-align:center">${idx + 1}</td>
                <td style="color:${color};font-weight:${alert?'600':'400'}">${esc(row.teacher_name)}${badge}</td>
                <td style="text-align:center;color:${color};font-weight:${alert?'600':'400'}">${count} sesi</td>
                <td style="text-align:center;font-size:18px;color:var(--color-text-muted)">&#8250;</td>
            </tr>
            <tr id="${detailId}" style="display:none" data-loaded="0">
                <td colspan="4" style="padding:0">
                    <table style="width:100%;border-collapse:collapse;background:var(--color-surface-raised,rgba(0,0,0,.15))">
                        <thead><tr style="font-size:11px;color:var(--color-text-muted)">
                            <th style="padding:6px 12px;text-align:left">Tanggal</th>
                            <th style="padding:6px 12px;text-align:left">Sesi</th>
                            <th style="padding:6px 12px;text-align:left">Mata Pelajaran</th>
                            <th style="padding:6px 12px;text-align:left">Kelas</th>
                        </tr></thead>
                        <tbody id="${detailId}-body"><tr><td colspan="4" style="padding:8px 12px;color:var(--color-text-muted)">Memuat…</td></tr></tbody>
                    </table>
                </td>
            </tr>`;
        });
        tbody.innerHTML = html;
        wrapEl.style.display = '';
        btn.textContent      = 'Sembunyikan';
        _wkKur2Visible = true;
    } catch (err) {
        btn.disabled         = false;
        btn.textContent      = 'Tampilkan';
        hintEl.textContent   = `Gagal memuat data. ${fe(err)}`;
        hintEl.style.display = 'block';
    }
}

async function _wkKur2ToggleDetail(detailId, teacherId, dateStart, dateEnd) {
    const row = document.getElementById(detailId);
    if (!row) return;
    const visible = row.style.display !== 'none';
    row.style.display = visible ? 'none' : '';
    if (!visible && row.dataset.loaded === '0') {
        row.dataset.loaded = '1';
        const bodyEl = document.getElementById(detailId + '-body');
        try {
            const sesi = await getPendingSessionsDetail(teacherId, dateStart || null, dateEnd || null);
            bodyEl.innerHTML = sesi.length === 0
                ? `<tr><td colspan="4" style="padding:8px 12px;color:var(--color-text-muted)">Tidak ada data.</td></tr>`
                : sesi.map(s => `<tr style="font-size:13px">
                    <td style="padding:5px 12px">${esc(s.session_date ?? '—')}</td>
                    <td style="padding:5px 12px">${fmtTime(s.session_start)} – ${fmtTime(s.session_end)}</td>
                    <td style="padding:5px 12px">${esc(s.subject_name ?? '—')}</td>
                    <td style="padding:5px 12px">${esc(s.class_name ?? '—')}</td>
                </tr>`).join('');
        } catch (err) {
            bodyEl.innerHTML = `<tr><td colspan="4" style="padding:8px 12px;color:var(--color-danger,#ef4444)">Gagal memuat. ${fe(err)}</td></tr>`;
        }
    }
}

function handleWkKur2Btn() {
    if (_wkKur2Visible) {
        document.getElementById('wk-kur2-wrap').style.display = 'none';
        document.getElementById('wk-kur2-stats-row').style.display = 'none';
        document.getElementById('wk-kur2-hint').style.display = 'none';
        _wkKur2Visible = false;
        document.getElementById('wk-kur2-btn').textContent = 'Tampilkan';
    } else {
        loadWkKur2();
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
        const byStudent = new Map(whStudents.map(s => [s.student_id, { name: s.full_name, prog: s.program_name, HADIR:0, ALPA:0, IZIN:0, SAKIT:0, total:0 }]));
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
            return `<tr><td>${esc(a.name)}</td><td>${esc(a.prog)}</td><td>${a.HADIR}</td><td>${a.SAKIT}</td><td>${a.IZIN}</td><td>${a.ALPA}</td><td>${a.total > 0 ? pct+'%' : '—'}</td></tr>`;
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
        listEl.innerHTML = `<div class="status-err">${esc(fe(err))}</div>`;
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

function _prevAcademicYear() {
    const y = parseInt(config?.current_academic_year?.split('/')[0] ?? new Date().getFullYear());
    return `${y - 1}/${y}`;
}

function fmtChartLabel(dateStr, byMonth) {
    const d = new Date(dateStr + 'T00:00:00');
    return byMonth
        ? BULAN_ID[d.getMonth()] + ' ' + d.getFullYear()
        : d.getDate() + ' ' + BULAN_ID[d.getMonth()];
}

let _ksTabInit = false;
let _ksChart   = null;

async function initKepsekTab() {
    if (!_ksTabInit) {
        _ksTabInit = true;

        // Wire period preset buttons
        document.getElementById('ks-period-toggle').addEventListener('click', e => {
            const btn = e.target.closest('.ks-period-btn');
            if (!btn) return;
            document.querySelectorAll('.ks-period-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const period = btn.dataset.period;
            const ayLalu = period === 'tahun_ajaran_lalu' ? _prevAcademicYear() : null;
            loadKepsekMonitoring(period, ayLalu);
        });

        // Wire date range button
        document.getElementById('ks-range-btn').addEventListener('click', () => {
            const start = document.getElementById('ks-range-start').value;
            const end   = document.getElementById('ks-range-end').value;
            if (!start || !end) return;
            document.querySelectorAll('.ks-period-btn').forEach(b => b.classList.remove('active'));
            loadKepsekMonitoring('rentang', null, start, end);
        });

        // Default date range: 7 hari terakhir
        document.getElementById('ks-range-start').value = localDateStr(new Date(Date.now() - 6 * 86400000));
        document.getElementById('ks-range-end').value   = localDateStr();
    }
    await loadKepsekMonitoring('7_hari');
}

let _ksAdminTabInit = false;

async function initKsAdminTab() {
    if (!_ksAdminTabInit) {
        _ksAdminTabInit = true;
        document.getElementById('ks-add-admin-form').addEventListener('submit', handleAddAdmin);
    }
    await loadAdminList();
}

async function loadKepsekMonitoring(period, academicYear = null, dateStart = null, dateEnd = null) {
    const errEl    = document.getElementById('ks-monitoring-error');
    const pctSiswa = document.getElementById('ks-pct-siswa');
    const pctGuru  = document.getElementById('ks-pct-guru');
    const detSiswa = document.getElementById('ks-detail-siswa');
    const detGuru  = document.getElementById('ks-detail-guru');
    const hintEl   = document.getElementById('ks-chart-hint');

    pctSiswa.textContent = '…';
    pctGuru.textContent  = '…';
    detSiswa.textContent = '';
    detGuru.textContent  = '';
    errEl.style.display  = 'none';

    try {
        const d = await getKepsekMonitoring(period, academicYear, dateStart, dateEnd);
        const s = d.summary ?? {};

        pctSiswa.textContent = s.pct_siswa != null ? s.pct_siswa + '%' : '—';
        pctGuru.textContent  = s.pct_guru  != null ? s.pct_guru  + '%' : '—';
        detSiswa.textContent = (s.siswa_total > 0)
            ? `${s.siswa_hadir} dari ${s.siswa_total} sesi tercatat`
            : 'Belum ada data';
        detGuru.textContent = (s.guru_total > 0)
            ? `${s.guru_hadir} dari ${s.guru_total} sesi terjadwal`
            : 'Belum ada data';

        const chartData = d.chart ?? [];
        hintEl.textContent = chartData.length === 0
            ? 'Belum ada data pada periode ini'
            : d.by_month ? 'Persentase kehadiran per bulan' : 'Persentase kehadiran per hari';

        renderKepsekChart(chartData, d.by_month);
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
    const labels     = chartData.map(p => fmtChartLabel(p.date, byMonth));
    const dataSiswa  = chartData.map(p => p.pct_siswa);
    const dataGuru   = chartData.map(p => p.pct_guru);

    if (_ksChart) { _ksChart.destroy(); _ksChart = null; }

    _ksChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Kehadiran Siswa (%)',
                    data: dataSiswa,
                    borderColor: '#1D9E75',
                    backgroundColor: '#1D9E7518',
                    tension: 0.3,
                    fill: true,
                    pointRadius: chartData.length <= 14 ? 4 : 2,
                    spanGaps: true,
                },
                {
                    label: 'Kehadiran Guru (%)',
                    data: dataGuru,
                    borderColor: '#185FA5',
                    backgroundColor: '#185FA518',
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
                legend: { display: false },
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
                <thead><tr><th>Nama</th><th></th></tr></thead>
                <tbody>
                    ${admins.map(a => `
                        <tr>
                            <td>${esc(a.full_name)}</td>
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
    const idType  = document.getElementById('ks-admin-idtype').value;

    if (loginId.length < 9) {
        msgEl.textContent   = 'NIP/NIK minimal 9 karakter.';
        msgEl.style.display = 'block';
        return;
    }

    btn.disabled = true;
    msgEl.style.display = 'none';
    resultEl.style.display = 'none';

    try {
        const result = await addSchoolAdmin({ full_name: name, login_identifier: loginId, identifier_type: idType });

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
    AUDIENCE_CHANGED:       'Visibilitas Diubah',
};

const KASUS_PAGE    = 50;
let _kasusTabInit   = false;
let _kasusAllCases  = [];
let _kasusOffset    = 0;
let _kasusHasMore   = false;
let _kasusCurrentId = null;

async function initKasusTab() {
    markKasusAsSeen();
    if (_kasusTabInit) { renderKasusList(); return; }
    _kasusTabInit = true;

    await ensureStudentPool();

    // Filters
    document.getElementById('kasus-filter-status').addEventListener('change', () => loadKasusList());
    document.getElementById('kasus-filter-track').addEventListener('change',  () => loadKasusList());

    // Sembunyikan tombol buat kasus untuk role ADMINISTRATIVE (bukan penanganan siswa)
    if (currentUser.role_type === 'ADMINISTRATIVE') {
        document.getElementById('kasus-new-btn').style.display = 'none';
    }

    // Offline guard — disable tombol + banner saat tidak ada koneksi
    function syncKasusOnlineState() {
        const online = navigator.onLine;
        const btn    = document.getElementById('kasus-new-btn');
        const banner = document.getElementById('kasus-offline-banner');
        if (btn) btn.disabled         = !online;
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
        if (!sId)             { showCreateMsg('Pilih siswa dari daftar.', true); return; }
        if (title.length < 5) { showCreateMsg('Judul minimal 5 karakter.', true); return; }
        if (desc.length < 20) { showCreateMsg('Deskripsi minimal 20 karakter.', true); return; }

        btnEl.disabled = true; btnEl.textContent = 'Menyimpan…';
        try {
            const r = await createCase({
                studentId:   sId,
                title,
                description: desc,
                track,
                audience: 'PRIVATE',
                authorUserId: currentUser.user_id,
                authorRole:   currentUser.role_type,
            });
            closeKasusModal();
            if (r._queued) {
                showCreateMsg('Kasus disimpan lokal. Akan dikirim saat koneksi kembali.', false);
            }
            await loadKasusList();
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

async function loadKasusList(append = false) {
    const contentEl = document.getElementById('kasus-list-content');
    if (!append) {
        _kasusAllCases = [];
        _kasusOffset   = 0;
        contentEl.innerHTML = '<p class="hint">Memuat kasus…</p>';
    }
    const status = document.getElementById('kasus-filter-status').value;
    const track  = document.getElementById('kasus-filter-track').value;
    try {
        const rows = await getCases({ status, track, offset: _kasusOffset, limit: KASUS_PAGE + 1 });
        _kasusHasMore  = rows.length > KASUS_PAGE;
        const page     = _kasusHasMore ? rows.slice(0, KASUS_PAGE) : rows;
        _kasusAllCases = append ? [..._kasusAllCases, ...page] : page;
        _kasusOffset   = _kasusAllCases.length;
        renderKasusList();
    } catch (err) {
        if (!append) contentEl.innerHTML = `<div class="status-err">${esc(fe(err))}</div>`;
    }
}

function renderKasusList() {
    const contentEl = document.getElementById('kasus-list-content');

    if (!_kasusAllCases.length) {
        contentEl.innerHTML = '<p class="hint">Tidak ada kasus yang sesuai filter.</p>';
        return;
    }

    contentEl.innerHTML = _kasusAllCases.map(r => `
        <div class="kasus-row" data-id="${r.case_id}">
            <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:8px; flex-wrap:wrap">
                <strong style="font-size:14px; flex:1">${esc(r.title)}</strong>
                <span class="badge kasus-badge-${(r.status||'').toLowerCase()}">${esc(CASE_STATUS_LABEL[r.status] ?? r.status)}</span>
            </div>
            <div style="font-size:12px; color:var(--color-text-muted); margin-top:4px">
                ${esc(r.student?.full_name ?? 'Siswa tidak dapat ditampilkan')}${r.student?.nis ? ' (' + esc(r.student.nis) + ')' : ''}
                &middot; ${esc(CASE_TRACK_LABEL[r.track] ?? r.track)}
                &middot; Handler: ${esc(ROLE_LABEL[r.current_handler_role] ?? r.current_handler_role ?? '—')}
                &middot; ${fmt(r.created_at)}
            </div>
        </div>
    `).join('') + (_kasusHasMore
        ? `<div style="text-align:center;padding:12px">
               <button class="btn btn-secondary btn-sm" id="kasus-load-more-btn">Muat lebih…</button>
           </div>`
        : '');

    contentEl.querySelectorAll('.kasus-row').forEach(el => {
        el.addEventListener('click', () => openKasusDetail(el.dataset.id));
    });
    const moreBtn = document.getElementById('kasus-load-more-btn');
    if (moreBtn) moreBtn.addEventListener('click', async () => {
        moreBtn.disabled = true;
        moreBtn.textContent = 'Memuat…';
        await loadKasusList(true);
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
            `<div class="status-err">${esc(fe(err))}</div>`;
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
        if (ev.event_type === 'AUDIENCE_CHANGED')
            detail = `${esc(AUDIENCE_LABEL[ev.payload?.previous] ?? ev.payload?.previous ?? '?')} → ${esc(AUDIENCE_LABEL[ev.payload?.next] ?? ev.payload?.next ?? '?')}`;
        return `
            <div class="case-event-item">
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
    const isHandler = kasus.current_handler_role === currentUser.role_type
        && (
            currentUser.role_type !== 'GURU'
            || kasus.created_by_user_id === currentUser.user_id
        );
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
            : cur === 'RESTRICTED' ? 'var(--color-primary-bg)'
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
            await closeCase({ caseId: kasus.case_id, note, authorUserId: currentUser.user_id, authorRole: currentUser.role_type, previousStatus: kasus.status });
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
                await logCaseAudienceChange({
                    caseId: kasus.case_id,
                    previousAudience: currentAudience,
                    newAudience: a,
                    authorUserId: currentUser.user_id,
                    authorRole: currentUser.role_type,
                });
                msgEl.style.color = 'var(--color-success)';
                msgEl.textContent = `Audiens diubah ke: ${AUDIENCE_LABEL[a]}.`;
                await refreshKasusDetail();
            } catch (err) {
                msgEl.style.color = 'var(--color-danger)'; msgEl.textContent = fe(err, 's');
            }
        });
    });
}

async function fetchStudentSubject(studentId, knownUserId = null) {
    if (_studentSubjectCache.has(studentId)) return _studentSubjectCache.get(studentId);
    const [userId, parents] = await Promise.all([
        knownUserId != null ? Promise.resolve(knownUserId) : getStudentUserId(studentId),
        getStudentParents(studentId),
    ]);
    const result = { userId, parents };
    _studentSubjectCache.set(studentId, result);
    return result;
}

async function loadAudienceMembers(kasus) {
    const restrictedPanel = document.getElementById('kasus-aud-restricted-panel');
    const listEl  = document.getElementById('kasus-aud-members-list');
    const searchEl = document.getElementById('kasus-aud-member-search');
    const dropEl   = document.getElementById('kasus-aud-member-list');
    const msgEl    = document.getElementById('kasus-audience-msg');
    listEl.textContent = 'Memuat anggota…';

    // Pastikan container toggle subjek ada (inject sekali, innerHTML-nya ditimpa tiap panggil)
    let subjectPanel = document.getElementById('kasus-aud-subject-panel');
    if (!subjectPanel) {
        subjectPanel = document.createElement('div');
        subjectPanel.id = 'kasus-aud-subject-panel';
        restrictedPanel.insertBefore(subjectPanel, restrictedPanel.firstChild);
    }

    try {
        const studentId   = kasus.student?.student_id ?? null;
        const knownUserId = kasus.student?.user_id ?? null;

        const [members, subject] = await Promise.all([
            getCaseAudienceMembers(kasus.case_id),
            studentId ? fetchStudentSubject(studentId, knownUserId) : Promise.resolve(null),
        ]);
        const memberSet = new Set(members.map(m => m.user_id));
        const subjectUidSet = new Set();

        // ── Toggle siswa & ortu ──
        if (subject) {
            const rows = [];
            if (subject.userId) {
                rows.push({ uid: subject.userId, label: esc(kasus.student?.full_name ?? 'Siswa'), role: 'Siswa' });
            }
            subject.parents.forEach(p => {
                rows.push({ uid: p.parent_user_id, label: esc(p.users?.full_name ?? p.parent_user_id), role: 'Ortu' });
            });
            rows.forEach(r => subjectUidSet.add(r.uid));
            if (rows.length) {
                subjectPanel.innerHTML = `
                    <div style="font-size:12px;font-weight:600;color:var(--color-text-muted);margin-bottom:6px">Siswa &amp; Orang Tua Terkait</div>
                    ${rows.map(row => `
                        <label style="display:flex;align-items:center;gap:8px;font-size:12px;margin-bottom:4px;cursor:pointer">
                            <input type="checkbox" data-uid="${row.uid}" ${memberSet.has(row.uid) ? 'checked' : ''}
                                style="width:14px;height:14px;accent-color:var(--color-primary,#6366f1);cursor:pointer">
                            ${row.label} <span style="color:var(--color-text-muted)">(${row.role})</span>
                        </label>
                    `).join('')}
                    <div style="border-bottom:1px solid var(--color-border);margin:8px 0"></div>`;
                subjectPanel.querySelectorAll('input[type=checkbox][data-uid]').forEach(cb => {
                    cb.addEventListener('change', async () => {
                        const uid = cb.dataset.uid;
                        const nowChecked = cb.checked;
                        cb.disabled = true;
                        try {
                            if (nowChecked) {
                                await addCaseAudienceMember({ caseId: kasus.case_id, userId: uid, schoolId: currentUser.school_id, addedByUserId: currentUser.user_id });
                            } else {
                                await removeCaseAudienceMember({ caseId: kasus.case_id, userId: uid });
                            }
                            await loadAudienceMembers(kasus);
                        } catch (err) {
                            if (err?.code === '23505') {
                                await loadAudienceMembers(kasus);
                            } else {
                                cb.checked = !nowChecked;
                                cb.disabled = false;
                                msgEl.style.color = 'var(--color-danger)';
                                msgEl.textContent = fe(err, 's');
                            }
                        }
                    });
                });
            } else {
                subjectPanel.innerHTML = '';
            }
        } else {
            subjectPanel.innerHTML = '';
        }

        // ── Chip staf (kecualikan siswa/ortu yang sudah tampil di subjectPanel) ──
        const staffMembers = members.filter(m => !subjectUidSet.has(m.user_id));
        if (!staffMembers.length) {
            listEl.innerHTML = '<em style="color:var(--color-text-muted)">Belum ada staf yang ditambahkan.</em>';
        } else {
            listEl.innerHTML = staffMembers.map(m => {
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
    if (!old) return { addEventListener: () => {}, style: {}, dataset: {}, disabled: false };
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
        // Update entri di list cache tanpa re-fetch seluruh halaman
        const idx = _kasusAllCases.findIndex(c => c.case_id === _kasusCurrentId);
        if (idx >= 0) _kasusAllCases[idx] = {
            ..._kasusAllCases[idx],
            status:               kasus.status,
            current_handler_role: kasus.current_handler_role,
            is_locked:            kasus.is_locked,
        };
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
            if (r.status === 'queued') {
                const cacheKey = `jurnal-${currentUser.user_id}`;
                const cached   = LC.get(cacheKey) ?? [];
                const newEntry = { journal_id: r.journal_id, entry_date: date, content, created_at: new Date().toISOString() };
                LC.set(cacheKey, [newEntry, ...cached]);
                renderJurnalEntries([newEntry, ...cached], document.getElementById('journal-list'));
            }
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
                if (!navigator.onLine) {
                    errEl.textContent = 'Hapus tidak tersedia saat offline.';
                    errEl.style.display = 'block';
                    confirmEl.style.display = 'none';
                    askBtn.style.display = 'inline-flex';
                    return;
                }
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

// ─── TAB FORUM ───────────────────────────────────────────────

let _forumClassId          = null;
let _forumAcademicYear     = null;
let _forumOffset           = 0;
let _forumHasMore          = false;
let _forumTabInit          = false;
let _forumSelectedStudents = [];
let _forumSelectedCategory = null;
let _forumAllMembers   = [];   // cache kandidat picker orang tertentu
let _forumSpecificUsers = [];  // [{user_id, full_name, role_type}] dipilih
let _forumCategories       = [];
let _forumStudents         = [];

async function initForumTab() {
    if (_forumTabInit) {
        await loadForumPosts();
        return;
    }
    _forumTabInit = true;

    const sel = document.getElementById('forum-class-select');
    sel.innerHTML = '<option value="">Memuat kelas…</option>';
    try {
        const classes = await getForumClasses(currentUser.user_id, config.current_academic_year);
        if (!classes.length) {
            sel.innerHTML = '<option value="">Tidak ada kelas</option>';
            document.getElementById('forum-loading').textContent = 'Anda tidak memiliki kelas yang bisa diakses.';
            return;
        }
        sel.innerHTML = [...classes]
            .sort((a, b) => a.name.localeCompare(b.name, 'id'))
            .map(c => `<option value="${esc(c.class_id)}">${esc(c.name)}</option>`)
            .join('');
        const first = classes[0];
        _forumClassId      = first.class_id;
        _forumAcademicYear = config.current_academic_year;
    } catch (err) {
        sel.innerHTML = '<option value="">Gagal memuat</option>';
        document.getElementById('forum-loading').textContent = fe(err);
        return;
    }

    sel.addEventListener('change', () => {
        _forumClassId      = sel.value || null;
        _forumOffset = 0;
        loadForumPosts();
    });

    document.getElementById('btn-create-post').addEventListener('click', openCreatePostModal);
    document.getElementById('btn-load-more-posts').addEventListener('click', async (e) => {
        e.currentTarget.disabled = true;
        await loadForumPosts(true);
        e.currentTarget.disabled = false;
    });
    document.getElementById('btn-cancel-post').addEventListener('click', closeCreatePostModal);
    document.getElementById('modal-create-post').addEventListener('click', e => {
        if (e.target === e.currentTarget) closeCreatePostModal();
    });
    document.getElementById('btn-submit-post').addEventListener('click', submitCreatePost);
    document.getElementById('forum-audience-select').addEventListener('change', updateAudienceWarning);

    await loadForumPosts();
}

async function loadForumPosts(append = false) {
    const loadingEl = document.getElementById('forum-loading');
    const listEl    = document.getElementById('forum-posts-list');
    const moreBtn   = document.getElementById('btn-load-more-posts');

    if (!_forumClassId) {
        loadingEl.textContent = 'Pilih kelas untuk melihat forum.';
        loadingEl.style.display = 'block';
        listEl.innerHTML = '';
        moreBtn.style.display = 'none';
        return;
    }

    if (!append) {
        _forumOffset = 0;
        listEl.innerHTML = '';
        loadingEl.textContent = 'Memuat forum…';
        loadingEl.style.display = 'block';
    }
    moreBtn.style.display = 'none';

    const LIMIT = 20;
    try {
        // Waka/Kepsek/Kaprodi: tampilkan semua posting kelas (tidak filter by audience table).
        // RLS fn_can_read_forum_post tetap menjadi penjaga akses di sisi database.
        const isOversight = ['WAKA_KESISWAAN', 'KEPSEK', 'ADMINISTRATIVE'].includes(currentUser.role_type)
            || currentUser.is_waka_kesiswaan === true
            || currentUser.is_kepsek === true;
        const isKaprodi = currentUser.role_type === 'KAPRODI' || !!currentUser.kaprodi_program_id;
        const skipAudienceFilter = isOversight || isKaprodi;
        const posts = await getForumPosts(
            _forumClassId, _forumAcademicYear,
            currentUser.user_id, currentUser.school_id,
            LIMIT, _forumOffset, skipAudienceFilter
        );
        loadingEl.style.display = 'none';

        if (!posts.length && !append) {
            listEl.innerHTML = '<p class="hint">Belum ada posting di forum ini.</p>';
            return;
        }

        listEl.insertAdjacentHTML('beforeend', posts.map(renderForumPostCard).join(''));
        _forumOffset += posts.length;
        _forumHasMore = posts.length === LIMIT;
        moreBtn.style.display = _forumHasMore ? 'inline-block' : 'none';

        wireForumCards(listEl, posts);
    } catch (err) {
        loadingEl.textContent = fe(err);
        loadingEl.style.display = 'block';
    }
}

function renderForumPostCard(post) {
    const isWithdrawn = !!post.is_withdrawn;
    const isAuthor    = post.author_user_id === currentUser.user_id;
    const authorName  = post.author?.full_name ?? '—';
    const ts = post.created_at
        ? new Date(post.created_at).toLocaleString('id-ID', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })
        : '—';
    const edited = post.updated_at && post.updated_at !== post.created_at
        ? ` <span style="color:var(--color-text-muted);font-size:11px">(diedit)</span>` : '';

    const subjects = (post.subjects ?? []).map(s => s.student?.full_name).filter(Boolean);
    const catLabel  = post.category?.label_sekolah ?? null;
    const catPol    = post.category?.polarity ?? null;
    const catColor  = catPol === 'POSITIVE' ? 'var(--color-success,#4ade80)'
                    : catPol === 'NEGATIVE' ? 'var(--color-danger,#f87171)'
                    : 'var(--color-primary)';

    const ackCount = (post.acknowledgements ?? []).length;
    const cmtCount = (post.comments ?? []).length;
    const hasAcked = (post.acknowledgements ?? []).some(a => a.user_id === currentUser.user_id);

    const canEdit = isAuthor && !isWithdrawn && cmtCount === 0;

    const bodyHtml = isWithdrawn
        ? `<p style="color:var(--color-text-muted);font-style:italic;margin:8px 0">[Posting ini telah ditarik]</p>`
        : `<p style="margin:8px 0;white-space:pre-wrap;color:var(--color-text)">${esc(post.body ?? '')}</p>`;

    return `
    <div class="forum-post-card" data-post-id="${esc(post.post_id)}"
         data-author-id="${esc(post.author_user_id ?? '')}"
         data-withdrawn="${isWithdrawn ? '1' : '0'}"
         data-comment-count="${cmtCount}"
         style="border-bottom:0.5px solid var(--color-border);padding:14px 0${isWithdrawn ? ';opacity:.6' : ''}">

        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:4px;margin-bottom:4px">
            <strong style="font-size:14px">${esc(authorName)}</strong>
            <span style="font-size:11px;color:var(--color-text-muted)">${ts}${edited}</span>
        </div>

        ${subjects.length ? `<p style="font-size:12px;color:var(--color-text-muted);margin:0 0 4px">Siswa: ${esc(subjects.join(', '))}</p>` : ''}
        ${catLabel ? `<span style="font-size:11px;padding:2px 8px;border-radius:20px;color:${catColor};background:var(--color-bg-alt);margin-bottom:6px;display:inline-block">${esc(catLabel)}</span>` : ''}

        <div class="forum-post-body">${bodyHtml}</div>

        ${!isWithdrawn ? `
        <div class="forum-post-actions" style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
            <button class="btn btn-sm ${hasAcked ? 'btn-primary' : 'btn-secondary'} btn-ack"
                    style="font-size:12px" data-acked="${hasAcked ? '1' : '0'}">
                ✓ Sudah baca${ackCount > 0 ? ` (${ackCount})` : ''}
            </button>
            <button class="btn btn-sm btn-secondary btn-comments" style="font-size:12px">
                💬 Komentar${cmtCount > 0 ? ` (${cmtCount})` : ''}
            </button>
            ${canEdit ? `<button class="btn btn-sm btn-secondary btn-edit-post" style="font-size:12px">Edit</button>` : ''}
            ${isAuthor ? `<button class="btn btn-sm btn-secondary btn-withdraw" style="font-size:12px;color:var(--color-danger)">Tarik posting</button>` : ''}
        </div>
        <div class="forum-comments-panel" style="display:none;margin-top:12px;padding:10px;background:var(--color-bg-alt);border-radius:var(--radius)">
            <div class="forum-comments-list" style="margin-bottom:8px;font-size:13px"></div>
            <div style="display:flex;gap:6px">
                <input type="text" class="input forum-comment-input" placeholder="Tulis komentar…" maxlength="1000" style="flex:1;font-size:13px">
                <button class="btn btn-primary btn-sm btn-send-comment">Kirim</button>
            </div>
            <p class="forum-comment-err" style="font-size:12px;color:var(--color-danger);margin:4px 0 0;display:none"></p>
        </div>
        ` : ''}
    </div>`;
}

function wireForumCards(containerEl, posts) {
    containerEl.querySelectorAll('.forum-post-card:not([data-wired])').forEach(card => {
        card.dataset.wired = '1';
        const postId      = card.dataset.postId;
        const isWithdrawn = card.dataset.withdrawn === '1';
        if (isWithdrawn) return;

        const ackBtn = card.querySelector('.btn-ack');
        if (ackBtn) {
            ackBtn.addEventListener('click', async () => {
                if (ackBtn.dataset.acked === '1') return;
                ackBtn.disabled = true;
                try {
                    await addForumAcknowledgement(postId, currentUser.user_id, currentUser.school_id);
                    ackBtn.dataset.acked = '1';
                    ackBtn.classList.replace('btn-secondary', 'btn-primary');
                    const cur = parseInt(ackBtn.textContent.match(/\d+/)?.[0] ?? '0', 10);
                    ackBtn.textContent = `✓ Sudah baca (${cur + 1})`;
                } catch (err) {
                    alert(fe(err));
                } finally {
                    ackBtn.disabled = false;
                }
            });
        }

        const cmtBtn   = card.querySelector('.btn-comments');
        const cmtPanel = card.querySelector('.forum-comments-panel');
        if (cmtBtn && cmtPanel) {
            cmtBtn.addEventListener('click', async () => {
                const open = cmtPanel.style.display !== 'none';
                cmtPanel.style.display = open ? 'none' : 'block';
                if (!open) await loadForumComments(postId, cmtPanel);
            });
        }

        const sendBtn  = card.querySelector('.btn-send-comment');
        const cmtInput = card.querySelector('.forum-comment-input');
        const cmtErr   = card.querySelector('.forum-comment-err');
        if (sendBtn && cmtInput) {
            sendBtn.addEventListener('click', async () => {
                const body = cmtInput.value.trim();
                if (!body) return;
                sendBtn.disabled = true; sendBtn.textContent = '…';
                cmtErr.style.display = 'none';
                try {
                    await addForumComment(postId, body, currentUser.user_id, currentUser.school_id);
                    cmtInput.value = '';
                    await loadForumComments(postId, cmtPanel);
                } catch (err) {
                    cmtErr.textContent = fe(err, 's');
                    cmtErr.style.display = 'block';
                } finally {
                    sendBtn.disabled = false; sendBtn.textContent = 'Kirim';
                }
            });
        }

        const editBtn = card.querySelector('.btn-edit-post');
        if (editBtn) {
            editBtn.addEventListener('click', () => handleEditForumPost(card, postId));
        }

        const wdBtn = card.querySelector('.btn-withdraw');
        if (wdBtn) {
            wdBtn.addEventListener('click', async () => {
                const cmtCount = parseInt(card.dataset.commentCount ?? '0', 10);
                const msg = cmtCount > 0
                    ? `Tarik posting ini? Konten akan disembunyikan, tapi ${cmtCount} komentar yang sudah ada tetap terlihat.`
                    : 'Tarik posting ini? Konten akan disembunyikan dari pembaca.';
                if (!confirm(msg)) return;
                wdBtn.disabled = true;
                try {
                    await withdrawForumPost(postId);
                    _forumOffset = 0;
                    await loadForumPosts();
                } catch (err) {
                    alert(fe(err, 's'));
                    wdBtn.disabled = false;
                }
            });
        }
    });
}

function handleEditForumPost(card, postId) {
    const bodyEl   = card.querySelector('.forum-post-body');
    const actionsEl = card.querySelector('.forum-post-actions');
    if (!bodyEl) return;

    // Ambil teks asli dari elemen <p> di dalam body
    const currentText = bodyEl.querySelector('p')?.innerText ?? '';

    const textarea = document.createElement('textarea');
    textarea.className  = 'input';
    textarea.value      = currentText;
    textarea.rows       = 4;
    textarea.maxLength  = 2000;
    textarea.style.cssText = 'width:100%;font-size:14px;margin:4px 0 6px;box-sizing:border-box';

    const saveBtn   = document.createElement('button');
    saveBtn.className   = 'btn btn-primary btn-sm';
    saveBtn.textContent = 'Simpan';
    saveBtn.style.marginRight = '6px';
    saveBtn.style.fontSize = '12px';

    const cancelBtn = document.createElement('button');
    cancelBtn.className   = 'btn btn-secondary btn-sm';
    cancelBtn.textContent = 'Batal';
    cancelBtn.style.fontSize = '12px';

    const errEl = document.createElement('p');
    errEl.style.cssText = 'color:var(--color-danger);font-size:12px;margin:4px 0 0;display:none';

    bodyEl.innerHTML = '';
    bodyEl.appendChild(textarea);
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:4px';
    btnRow.appendChild(saveBtn);
    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(errEl);
    bodyEl.appendChild(btnRow);
    if (actionsEl) actionsEl.style.display = 'none';
    textarea.focus();

    cancelBtn.addEventListener('click', () => {
        _forumOffset = 0;
        loadForumPosts();
    });

    saveBtn.addEventListener('click', async () => {
        const newBody = textarea.value.trim();
        if (newBody.length < 3) {
            errEl.textContent = 'Isi posting minimal 3 karakter.';
            errEl.style.display = 'block';
            return;
        }
        errEl.style.display = 'none';
        saveBtn.disabled    = true;
        saveBtn.textContent = 'Menyimpan…';
        try {
            await updateForumPost(postId, newBody);
            _forumOffset = 0;
            await loadForumPosts();
        } catch (err) {
            errEl.textContent  = fe(err, 's');
            errEl.style.display = 'block';
            saveBtn.disabled    = false;
            saveBtn.textContent = 'Simpan';
        }
    });
}

async function loadForumComments(postId, panel) {
    const listEl = panel.querySelector('.forum-comments-list');
    listEl.innerHTML = '<span style="color:var(--color-text-muted)">Memuat…</span>';
    try {
        const comments = await getForumPostComments(postId);
        if (!comments.length) {
            listEl.innerHTML = '<span style="color:var(--color-text-muted)">Belum ada komentar.</span>';
            return;
        }
        listEl.innerHTML = comments.map(c => {
            const ts = new Date(c.created_at).toLocaleString('id-ID', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
            const isOwn = c.author_user_id === currentUser.user_id;
            return `<div style="margin-bottom:8px;border-bottom:0.5px solid var(--color-border);padding-bottom:8px" data-comment-id="${esc(c.comment_id)}">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:4px">
                    <span>
                        <span style="font-weight:600;font-size:12px">${esc(c.author?.full_name ?? '—')}</span>
                        <span style="font-size:11px;color:var(--color-text-muted);margin-left:6px">${ts}</span>
                    </span>
                    ${isOwn ? `<button class="btn-del-comment" data-cid="${esc(c.comment_id)}" style="background:none;border:none;cursor:pointer;color:var(--color-danger);font-size:12px;padding:0 2px" title="Hapus komentar">Hapus</button>` : ''}
                </div>
                <p style="margin:4px 0 0;font-size:13px;white-space:pre-wrap">${esc(c.body)}</p>
            </div>`;
        }).join('');
        listEl.querySelectorAll('.btn-del-comment').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!confirm('Hapus komentar ini?')) return;
                btn.disabled = true;
                try {
                    await withdrawForumComment(btn.dataset.cid);
                    btn.closest('[data-comment-id]').remove();
                } catch (err) {
                    alert(fe(err));
                    btn.disabled = false;
                }
            });
        });
    } catch (err) {
        listEl.innerHTML = `<span style="color:var(--color-danger)">${fe(err)}</span>`;
    }
}

async function openCreatePostModal() {
    _forumSelectedStudents  = [];
    _forumSelectedCategory  = null;
    _forumSpecificUsers     = [];

    const modal = document.getElementById('modal-create-post');
    modal.style.display = 'flex';
    const searchEl = document.getElementById('forum-specific-search');
    if (searchEl) { searchEl.placeholder = 'Ketik nama staf atau orang tua…'; searchEl.value = ''; }
    document.getElementById('forum-post-content').value = '';
    document.getElementById('forum-post-error').style.display = 'none';
    document.getElementById('forum-category-section').style.display = 'none';
    document.getElementById('forum-audience-warning').style.display = 'none';
    document.getElementById('forum-audience-select').value = 'STAF_SAJA';

    const studentListEl = document.getElementById('forum-student-list');
    studentListEl.innerHTML = '<p class="hint" style="margin:0">Memuat…</p>';
    try {
        _forumStudents = await getForumStudents(_forumClassId, _forumAcademicYear);
        if (!_forumStudents.length) {
            studentListEl.innerHTML = '<p class="hint" style="margin:0">Tidak ada siswa di kelas ini.</p>';
        } else {
            renderForumStudentCheckboxes();
        }
    } catch (err) {
        studentListEl.innerHTML = `<p style="color:var(--color-danger);margin:0;font-size:13px">${fe(err)}</p>`;
    }

    if (!_forumCategories.length) {
        try { _forumCategories = await getForumCategories(); } catch { /* non-fatal */ }
    }
    renderForumCategoryGrid();

    // Load kandidat picker orang tertentu (sekali per buka modal)
    _forumAllMembers = [];
    renderSpecificChips();
    initForumSpecificPicker();
    if (_forumClassId) {
        try {
            _forumAllMembers = await getForumMemberDetails(
                _forumClassId, _forumAcademicYear
            );
        } catch (err) {
            const searchEl = document.getElementById('forum-specific-search');
            if (searchEl) searchEl.placeholder = 'Gagal memuat daftar anggota — coba tutup dan buka modal lagi';
        }
    } else {
        const searchEl = document.getElementById('forum-specific-search');
        if (searchEl) searchEl.placeholder = 'Pilih kelas terlebih dahulu';
    }
}

// ─── Forum: picker orang tertentu ────────────────────────

function renderSpecificChips() {
    const chipsEl = document.getElementById('forum-specific-chips');
    if (!chipsEl) return;
    if (!_forumSpecificUsers.length) {
        chipsEl.innerHTML = '';
        return;
    }
    chipsEl.innerHTML = _forumSpecificUsers.map(u => `
        <span style="display:inline-flex;align-items:center;gap:4px;
                     background:var(--color-primary-subtle,#eff6ff);
                     color:var(--color-primary,#2563eb);
                     border:1px solid var(--color-primary-light,#bfdbfe);
                     border-radius:999px;padding:2px 10px 2px 8px;
                     font-size:13px;line-height:1.4">
            ${esc(u.full_name)}
            <button type="button"
                    data-uid="${esc(u.user_id)}"
                    style="background:none;border:none;cursor:pointer;
                           color:inherit;padding:0;font-size:15px;
                           line-height:1;margin-left:2px"
                    aria-label="Hapus ${esc(u.full_name)}">×</button>
        </span>`).join('');
    chipsEl.querySelectorAll('button[data-uid]').forEach(btn => {
        btn.addEventListener('click', () => {
            _forumSpecificUsers = _forumSpecificUsers
                .filter(u => u.user_id !== btn.dataset.uid);
            renderSpecificChips();
        });
    });
}

function initForumSpecificPicker() {
    const searchEl    = document.getElementById('forum-specific-search');
    const dropdownEl  = document.getElementById('forum-specific-dropdown');
    if (!searchEl || !dropdownEl) return;

    // Reset
    searchEl.value   = '';
    dropdownEl.style.display = 'none';
    dropdownEl.innerHTML     = '';

    searchEl.addEventListener('input', () => {
        const q = searchEl.value.trim().toLowerCase();
        if (q.length < 1) {
            dropdownEl.style.display = 'none';
            dropdownEl.innerHTML = '';
            return;
        }
        const alreadyIds = new Set(_forumSpecificUsers.map(u => u.user_id));
        const matches = _forumAllMembers.filter(m =>
            !alreadyIds.has(m.user_id) &&
            m.full_name.toLowerCase().includes(q)
        );
        if (!matches.length) {
            dropdownEl.innerHTML =
                '<div style="padding:10px 12px;font-size:13px;' +
                'color:var(--color-text-muted)">Tidak ditemukan.</div>';
            dropdownEl.style.display = 'block';
            return;
        }
        dropdownEl.innerHTML = matches.slice(0, 10).map(m => `
            <div data-uid="${esc(m.user_id)}"
                 data-name="${esc(m.full_name)}"
                 data-role="${esc(m.role_type)}"
                 style="padding:8px 12px;cursor:pointer;font-size:13px;
                        border-bottom:1px solid var(--color-border-subtle,
                        var(--color-border))">
                <span style="font-weight:500">${esc(m.full_name)}</span>
                <span style="color:var(--color-text-muted);
                             margin-left:6px;font-size:11px">
                    ${esc(m.role_type)}
                </span>
            </div>`).join('');
        dropdownEl.style.display = 'block';
        dropdownEl.querySelectorAll('div[data-uid]').forEach(item => {
            item.addEventListener('mouseenter', () =>
                item.style.background = 'var(--color-hover,#f1f5f9)');
            item.addEventListener('mouseleave', () =>
                item.style.background = '');
            item.addEventListener('click', () => {
                _forumSpecificUsers.push({
                    user_id:   item.dataset.uid,
                    full_name: item.dataset.name,
                    role_type: item.dataset.role,
                });
                searchEl.value           = '';
                dropdownEl.style.display = 'none';
                dropdownEl.innerHTML     = '';
                renderSpecificChips();
            });
        });
    });

    // Tutup dropdown jika klik di luar
    document.addEventListener('click', function closeDrop(e) {
        if (!searchEl.contains(e.target) &&
            !dropdownEl.contains(e.target)) {
            dropdownEl.style.display = 'none';
        }
    }, { once: true, capture: false });
}

function closeCreatePostModal() {
    document.getElementById('modal-create-post').style.display = 'none';
}

function renderForumStudentCheckboxes() {
    const el = document.getElementById('forum-student-list');
    el.innerHTML = _forumStudents.map(s =>
        `<label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;padding:2px 0">
            <input type="checkbox" class="forum-student-cb" value="${esc(s.student_id)}"
                   style="width:15px;height:15px;cursor:pointer">
            ${esc(s.full_name)}<span style="color:var(--color-text-muted);font-size:11px"> ${esc(s.nis ?? '')}</span>
        </label>`
    ).join('');

    el.querySelectorAll('.forum-student-cb').forEach(cb => {
        cb.addEventListener('change', () => {
            _forumSelectedStudents = [...el.querySelectorAll('.forum-student-cb:checked')].map(c => c.value);
            const hasSubjects = _forumSelectedStudents.length > 0;
            document.getElementById('forum-category-section').style.display = hasSubjects ? 'block' : 'none';
            if (!hasSubjects) {
                _forumSelectedCategory = null;
                renderForumCategoryGrid();
            }
            const audienceSel = document.getElementById('forum-audience-select');
            const subjOpt = audienceSel.querySelector('option[value="ORTU_SISWA_SUBJEK"]');
            if (subjOpt) subjOpt.disabled = !hasSubjects;
            if (!hasSubjects && audienceSel.value === 'ORTU_SISWA_SUBJEK') {
                audienceSel.value = 'STAF_SAJA';
            }
            updateAudienceWarning();
        });
    });
}

function renderForumCategoryGrid() {
    const grid = document.getElementById('forum-category-grid');
    if (!_forumCategories.length) { grid.innerHTML = ''; return; }
    grid.innerHTML = _forumCategories.map(cat => {
        const color = cat.polarity === 'POSITIVE' ? 'var(--color-success,#4ade80)'
                    : cat.polarity === 'NEGATIVE' ? 'var(--color-danger,#f87171)'
                    : 'var(--color-primary)';
        const sel = _forumSelectedCategory === cat.category_code;
        return `<button type="button" class="btn btn-sm forum-cat-btn ${sel ? 'btn-primary' : 'btn-secondary'}"
                        data-code="${esc(cat.category_code)}"
                        style="font-size:12px;border-color:${color};${sel ? `background:${color};color:#fff` : `color:${color}`}">
                    ${esc(cat.label_sekolah)}
                </button>`;
    }).join('');

    grid.querySelectorAll('.forum-cat-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const code = btn.dataset.code;
            _forumSelectedCategory = _forumSelectedCategory === code ? null : code;
            renderForumCategoryGrid();
        });
    });
}

function updateAudienceWarning() {
    const val    = document.getElementById('forum-audience-select').value;
    const warnEl = document.getElementById('forum-audience-warning');
    const specificSection = document.getElementById('forum-specific-section');
    if (val === 'ORTU_SISWA_KELAS') {
        warnEl.textContent = 'Posting ini akan terlihat oleh semua siswa dan orang tua di kelas ini.';
        warnEl.style.display = 'block';
        if (specificSection) specificSection.style.display = 'none';
    } else if (val === 'PUBLIK') {
        warnEl.textContent = 'Posting ini terlihat oleh seluruh anggota forum, termasuk siswa dan semua orang tua.';
        warnEl.style.display = 'block';
        if (specificSection) specificSection.style.display = 'none';
    } else if (val === 'ORANG_TERTENTU') {
        warnEl.textContent = 'Posting hanya terlihat oleh orang yang Anda pilih di bawah ini.';
        warnEl.style.display = 'block';
        if (specificSection) specificSection.style.display = 'block';
    } else {
        warnEl.style.display = 'none';
        if (specificSection) specificSection.style.display = 'block';
    }
}

async function submitCreatePost() {
    const errEl     = document.getElementById('forum-post-error');
    const submitBtn = document.getElementById('btn-submit-post');
    const content   = document.getElementById('forum-post-content').value.trim();
    const audience  = document.getElementById('forum-audience-select').value;

    errEl.style.display = 'none';

    if (!content) {
        errEl.textContent = 'Isi catatan tidak boleh kosong.';
        errEl.style.display = 'block';
        return;
    }
    if (audience === 'ORTU_SISWA_SUBJEK' && !_forumSelectedStudents.length) {
        errEl.textContent = 'Audiens "Orang tua & siswa yang dibahas" memerlukan minimal satu siswa dipilih.';
        errEl.style.display = 'block';
        return;
    }
    if (audience === 'ORANG_TERTENTU' && !_forumSpecificUsers.length) {
        errEl.textContent = 'Pilih setidaknya satu orang sebagai penerima.';
        errEl.style.display = 'block';
        return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Menyimpan…';
    try {
        await createForumPost(
            _forumClassId, _forumAcademicYear,
            content || null,
            _forumSelectedCategory,
            _forumSelectedStudents,
            audience,
            _forumSpecificUsers.map(u => u.user_id)
        );
        closeCreatePostModal();
        _forumOffset = 0;
        await loadForumPosts();
    } catch (err) {
        errEl.textContent = fe(err, 's');
        errEl.style.display = 'block';
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Simpan';
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
    window.location.replace(getLoginUrl());
});

// ─── TAB KURIKULUM MERDEKA ────────────────────────────────────

let _kurmerInit = false;

async function initKurikulumTab() {
    if (_kurmerInit) return;
    _kurmerInit = true;

    const container = document.getElementById('kurmer-subject-list');

    let subjects;
    try {
        subjects = await getMyTeachingSubjects(currentUser.user_id, config.current_academic_year, config.current_semester);
    } catch (e) {
        container.innerHTML = `<p class="hint" style="color:var(--color-danger)">Gagal memuat mapel: ${esc(e.message)}</p>`;
        return;
    }

    if (!subjects.length) {
        container.innerHTML = '<p class="hint">Tidak ada mata pelajaran yang diajar semester ini.</p>';
        return;
    }

    // Untuk setiap mapel cek status ATP (CP/TP sudah ada atau belum)
    const rows = await Promise.all(subjects.map(async (s) => {
        const fase = s.fase_default ?? (s.grade_level === 10 ? 'E' : 'F');
        const [cpList, tpList] = await Promise.all([
            getCpBySubject(s.subject_id, fase).catch(() => []),
            getTpBySubject(s.subject_id, fase, null).catch(() => []),
        ]);
        return { ...s, fase, cpCount: cpList.length, tpCount: tpList.length };
    }));

    container.innerHTML = rows.map(s => {
        const hasAtp = s.tpCount > 0;
        const statusBadge = s.tpCount === 0
            ? `<span style="background:var(--color-danger-bg);color:var(--color-danger);padding:2px 8px;border-radius:12px;font-size:12px">Belum ada</span>`
            : `<span style="background:var(--color-success-bg,#f0fdf4);color:var(--color-success,#16a34a);padding:2px 8px;border-radius:12px;font-size:12px">${s.tpCount} TP · ${s.cpCount} CP</span>`;
        const kelompokBadge = s.kelompok_mapel
            ? `<span style="font-size:11px;color:var(--color-muted);margin-left:6px">${s.kelompok_mapel}</span>` : '';
        return `<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--color-border);flex-wrap:wrap;gap:8px" data-subject-id="${esc(s.subject_id)}">
            <div>
                <span style="font-weight:600">${esc(s.name)}</span>${kelompokBadge}
                <div style="margin-top:4px">${statusBadge} <span style="font-size:12px;color:var(--color-muted);margin-left:6px">Fase ${esc(s.fase)}</span></div>
            </div>
            <div style="display:flex;gap:8px;flex-shrink:0">
                ${hasAtp
                    ? `<button class="btn btn-secondary btn-sm kurmer-view-btn" data-subject-id="${esc(s.subject_id)}" data-fase="${esc(s.fase)}" data-name="${esc(s.name)}">Lihat &amp; Edit</button>`
                    : `<button class="btn btn-primary btn-sm kurmer-gen-btn" data-subject-id="${esc(s.subject_id)}" data-fase="${esc(s.fase)}" data-name="${esc(s.name)}" data-program="${esc(s.program_name ?? '')}" data-program-id="${esc(s.program_id ?? '')}" data-grade="${esc(s.grade_level ?? '')}">Generate dengan AI</button>`
                }
            </div>
        </div>`;
    }).join('');

    container.addEventListener('click', async (e) => {
        const genBtn  = e.target.closest('.kurmer-gen-btn');
        const viewBtn = e.target.closest('.kurmer-view-btn');
        if (genBtn)  openAtpGenerateModal(genBtn.dataset);
        if (viewBtn) openAtpViewModal(viewBtn.dataset);
    });
}

function openAtpGenerateModal({ subjectId, fase, name, program, programId, grade }) {
    const modal = document.getElementById('atp-modal');
    const body  = document.getElementById('atp-modal-body');
    document.getElementById('atp-modal-title').textContent = `Generate ATP — ${name}`;

    body.innerHTML = `
        <p style="color:var(--color-muted);font-size:13px;margin-bottom:16px">
            AI akan membuat Capaian Pembelajaran dan Tujuan Pembelajaran sesuai Kurikulum Merdeka SMK.
            Hasilnya bisa diedit sebelum disimpan.
        </p>
        <div style="display:grid;gap:12px">
            <label style="font-size:13px;font-weight:600">Nama Mata Pelajaran
                <input type="text" id="atp-subject-name" class="input" value="${esc(name)}"
                    placeholder="Contoh: Bahasa Inggris" style="margin-top:4px;width:100%">
                <small style="color:var(--color-muted);font-size:11px">Pastikan nama sudah benar sebelum generate</small>
            </label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                <label style="font-size:13px;font-weight:600">Fase
                    <select id="atp-fase" class="input" style="margin-top:4px;width:100%">
                        <option value="E" ${fase === 'E' ? 'selected' : ''}>E — Kelas X</option>
                        <option value="F" ${fase === 'F' ? 'selected' : ''}>F — Kelas XI–XII</option>
                    </select>
                </label>
                <label style="font-size:13px;font-weight:600">JP per Minggu
                    <input id="atp-jp" type="number" class="input" min="1" max="20" value="4" style="margin-top:4px;width:100%">
                </label>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                <label style="font-size:13px;font-weight:600">Minggu Efektif Semester 1
                    <input id="atp-minggu1" type="number" class="input" min="1" max="26" value="18" style="margin-top:4px;width:100%">
                </label>
                <label style="font-size:13px;font-weight:600">Minggu Efektif Semester 2
                    <input id="atp-minggu2" type="number" class="input" min="1" max="26" value="16" style="margin-top:4px;width:100%">
                </label>
            </div>
            <label style="font-size:13px;font-weight:600">Fokus Khusus (opsional)
                <textarea id="atp-fokus" class="input" rows="2" placeholder="Contoh: tekankan pada praktik industri dan digitalisasi..." style="margin-top:4px;width:100%;resize:vertical"></textarea>
            </label>
            <div>
                <label style="font-size:13px;font-weight:600">CP Referensi <span style="font-weight:400;color:var(--color-muted)">(opsional tapi dianjurkan)</span></label>
                <textarea id="atp-cp-referensi" class="input" rows="6"
                    style="margin-top:4px;width:100%;resize:vertical;font-size:12px"
                    placeholder="Paste teks CP resmi dari dokumen Kemdikbud di sini.\nContoh: Pada akhir Fase E, peserta didik menggunakan bahasa Inggris untuk berkomunikasi...\n\nJika dikosongkan, AI akan generate berdasarkan pengetahuan umum Kurikulum Merdeka."></textarea>
                <small style="color:var(--color-muted);font-size:11px">💡 Hasil lebih akurat jika CP resmi diisi. Download CP dari <a href="https://guru.kemdikbud.go.id/kurikulum/referensi-penerapan/capaian-pembelajaran" target="_blank" rel="noopener">guru.kemdikbud.go.id</a></small>
            </div>
        </div>
        <div style="margin-top:20px;display:flex;gap:8px;justify-content:flex-end">
            <button id="atp-cancel-btn" class="btn btn-secondary btn-sm">Batal</button>
            <button id="atp-generate-btn" class="btn btn-primary btn-sm">✨ Generate ATP</button>
        </div>
        <div id="atp-gen-status" style="margin-top:12px"></div>`;

    modal.style.display = 'flex';
    document.getElementById('atp-cp-referensi').value = '';

    document.getElementById('atp-cancel-btn').onclick  = () => { modal.style.display = 'none'; };
    document.getElementById('atp-modal-close').onclick = () => { modal.style.display = 'none'; };

    document.getElementById('atp-generate-btn').onclick = async () => {
        const genBtn   = document.getElementById('atp-generate-btn');
        const statusEl = document.getElementById('atp-gen-status');
        genBtn.disabled = true;
        genBtn.textContent = '⏳ Memproses…';
        statusEl.innerHTML = '<p class="hint">AI sedang menyusun CP dan ATP… ini bisa memakan 15–30 detik.</p>';

        const namaMapel    = document.getElementById('atp-subject-name').value.trim() || name;
        const faseVal      = document.getElementById('atp-fase').value;
        const jpVal        = parseInt(document.getElementById('atp-jp').value, 10) || 4;
        const minggu1      = parseInt(document.getElementById('atp-minggu1').value, 10) || 18;
        const minggu2      = parseInt(document.getElementById('atp-minggu2').value, 10) || 16;
        const fokusVal     = document.getElementById('atp-fokus').value;
        const cpReferensi  = document.getElementById('atp-cp-referensi').value.trim();
        const kelasLabel   = faseVal === 'E' ? 'Kelas X' : 'Kelas XI–XII';

        try {
            const result = await generateAtp({
                subject_name:   namaMapel,
                fase:           faseVal,
                kelas:          kelasLabel,
                program:        program || 'Umum',
                program_id:     programId || undefined,
                jp_per_minggu:  jpVal,
                minggu_sem1:    minggu1,
                minggu_sem2:    minggu2,
                fokus_khusus:   fokusVal,
                cp_referensi:   cpReferensi || undefined,
            });
            renderAtpReview(body, result, subjectId, faseVal);
        } catch (err) {
            statusEl.innerHTML = `<p style="color:var(--color-danger);font-size:13px">❌ ${esc(err.message)}</p>`;
            genBtn.disabled    = false;
            genBtn.textContent = '✨ Generate ATP';
        }
    };
}

function renderAtpReview(container, result, subjectId, fase) {
    const { capaian_pembelajaran: cpList = [], tujuan_pembelajaran: tpList = [] } = result;

    const cpRows = cpList.map((cp, i) => `
        <tr>
            <td style="padding:8px;vertical-align:top;font-weight:600;white-space:nowrap">CP-${i+1}</td>
            <td style="padding:8px;vertical-align:top">
                <input class="input" style="width:100%;font-size:12px;margin-bottom:4px" value="${esc(cp.elemen ?? '')}" data-cp="${i}" data-field="elemen" placeholder="Elemen">
                <textarea class="input" rows="2" style="width:100%;font-size:12px;resize:vertical" data-cp="${i}" data-field="deskripsi_cp" placeholder="Deskripsi CP">${esc(cp.deskripsi_cp ?? '')}</textarea>
            </td>
        </tr>`).join('');

    const tpRows = tpList.map((tp, i) => `
        <tr>
            <td style="padding:8px;vertical-align:top;font-size:12px;white-space:nowrap">${esc(tp.kode_tp ?? `TP-${i+1}`)}</td>
            <td style="padding:8px;vertical-align:top">
                <textarea class="input" rows="2" style="width:100%;font-size:12px;resize:vertical" data-tp="${i}" data-field="deskripsi_tp" placeholder="Deskripsi TP">${esc(tp.deskripsi_tp ?? '')}</textarea>
            </td>
            <td style="padding:8px;vertical-align:top">
                <input class="input" style="width:100%;font-size:12px" value="${esc(tp.materi_pokok ?? '')}" data-tp="${i}" data-field="materi_pokok" placeholder="Materi">
            </td>
            <td style="padding:8px;text-align:center;vertical-align:top">
                <input class="input" type="number" min="1" max="99" style="width:56px;font-size:12px;text-align:center" value="${tp.alokasi_jp ?? 4}" data-tp="${i}" data-field="alokasi_jp">
            </td>
            <td style="padding:8px;vertical-align:top;font-size:12px;color:var(--color-muted)">Sem ${tp.semester ?? 1}</td>
        </tr>`).join('');

    container.innerHTML = `
        <div style="margin-bottom:12px;padding:8px 12px;background:var(--color-success-bg,#f0fdf4);border-radius:6px;font-size:13px;color:var(--color-success,#16a34a)">
            ✅ AI berhasil membuat <strong>${cpList.length} CP</strong> dan <strong>${tpList.length} TP</strong>. Review dan edit jika perlu, lalu klik Simpan ke Database.
        </div>

        <h4 style="margin:0 0 8px">Capaian Pembelajaran</h4>
        <div style="overflow-x:auto;margin-bottom:20px">
            <table style="width:100%;border-collapse:collapse;font-size:13px">
                <thead><tr style="background:var(--color-surface-alt,#f8fafc)">
                    <th style="padding:8px;text-align:left;white-space:nowrap">#</th>
                    <th style="padding:8px;text-align:left">Elemen &amp; Deskripsi</th>
                </tr></thead>
                <tbody id="atp-review-cp">${cpRows}</tbody>
            </table>
        </div>

        <h4 style="margin:0 0 8px">Tujuan Pembelajaran</h4>
        <div style="overflow-x:auto;margin-bottom:20px">
            <table style="width:100%;border-collapse:collapse;font-size:13px">
                <thead><tr style="background:var(--color-surface-alt,#f8fafc)">
                    <th style="padding:8px;text-align:left">Kode</th>
                    <th style="padding:8px;text-align:left">Deskripsi TP</th>
                    <th style="padding:8px;text-align:left">Materi Pokok</th>
                    <th style="padding:8px;text-align:center">JP</th>
                    <th style="padding:8px;text-align:left">Sem</th>
                </tr></thead>
                <tbody id="atp-review-tp">${tpRows}</tbody>
            </table>
        </div>

        <div style="display:flex;gap:8px;justify-content:flex-end">
            <button id="atp-discard-btn" class="btn btn-secondary btn-sm">Buang</button>
            <button id="atp-save-btn" class="btn btn-primary btn-sm">💾 Simpan ke Database</button>
        </div>
        <div id="atp-save-status" style="margin-top:8px"></div>`;

    document.getElementById('atp-discard-btn').onclick = () => {
        document.getElementById('atp-modal').style.display = 'none';
    };

    document.getElementById('atp-save-btn').onclick = async () => {
        const saveBtn  = document.getElementById('atp-save-btn');
        const statusEl = document.getElementById('atp-save-status');
        saveBtn.disabled    = true;
        saveBtn.textContent = '⏳ Menyimpan…';

        // Kumpulkan nilai dari form yang sudah diedit
        const finalCp = cpList.map((cp, i) => ({
            ...cp,
            elemen:      container.querySelector(`[data-cp="${i}"][data-field="elemen"]`)?.value ?? cp.elemen,
            deskripsi_cp: container.querySelector(`[data-cp="${i}"][data-field="deskripsi_cp"]`)?.value ?? cp.deskripsi_cp,
        }));
        const finalTp = tpList.map((tp, i) => ({
            ...tp,
            deskripsi_tp: container.querySelector(`[data-tp="${i}"][data-field="deskripsi_tp"]`)?.value ?? tp.deskripsi_tp,
            materi_pokok: container.querySelector(`[data-tp="${i}"][data-field="materi_pokok"]`)?.value ?? tp.materi_pokok,
            alokasi_jp:   parseInt(container.querySelector(`[data-tp="${i}"][data-field="alokasi_jp"]`)?.value ?? tp.alokasi_jp, 10) || tp.alokasi_jp,
        }));

        try {
            // program_id di-inject edge function ke setiap CP/TP object
            const programId = finalCp[0]?.program_id ?? null;

            // Simpan CP
            const savedCp = await Promise.all(finalCp.map((cp, i) => saveCp({
                school_id:    currentUser.school_id,
                subject_id:   subjectId,
                program_id:   programId,
                fase,
                elemen:       cp.elemen,
                deskripsi_cp: cp.deskripsi_cp,
                generated_by: 'AI',
                created_by:   currentUser.user_id,
            })));

            // Buat map elemen → cp_id untuk link TP ke CP
            const cpIdMap = {};
            savedCp.forEach((saved, i) => { cpIdMap[finalCp[i].elemen] = saved.cp_id; });

            // Simpan TP
            await Promise.all(finalTp.map((tp, i) => saveTp({
                school_id:    currentUser.school_id,
                subject_id:   subjectId,
                program_id:   programId,
                cp_id:        cpIdMap[finalCp[0]?.elemen] ?? savedCp[0]?.cp_id ?? null,
                fase,
                semester:     tp.semester ?? 1,
                urutan:       tp.urutan ?? (i + 1),
                kode_tp:      tp.kode_tp ?? null,
                deskripsi_tp: tp.deskripsi_tp,
                materi_pokok: tp.materi_pokok ?? null,
                alokasi_jp:   tp.alokasi_jp ?? null,
                indikator:    tp.indikator ?? null,
                generated_by: 'AI',
                created_by:   currentUser.user_id,
            })));

            statusEl.innerHTML = `<p style="color:var(--color-success,#16a34a);font-size:13px">✅ Berhasil disimpan! ${savedCp.length} CP dan ${finalTp.length} TP tersimpan di database.</p>`;
            saveBtn.textContent = '✅ Tersimpan';
            // Reset tab agar list refresh saat kembali
            _kurmerInit = false;
        } catch (err) {
            statusEl.innerHTML = `<p style="color:var(--color-danger);font-size:13px">❌ Gagal menyimpan: ${esc(err.message)}</p>`;
            saveBtn.disabled    = false;
            saveBtn.textContent = '💾 Simpan ke Database';
        }
    };
}

async function openAtpViewModal({ subjectId, fase, name }) {
    const modal = document.getElementById('atp-modal');
    const body  = document.getElementById('atp-modal-body');
    document.getElementById('atp-modal-title').textContent = `ATP — ${name} (Fase ${fase})`;
    body.innerHTML = '<p class="hint">Memuat data…</p>';
    modal.style.display = 'flex';
    document.getElementById('atp-modal-close').onclick = () => { modal.style.display = 'none'; };

    try {
        const [cpList, tpList] = await Promise.all([
            getCpBySubject(subjectId, fase),
            getTpBySubject(subjectId, fase, null),
        ]);

        const tpRows = tpList.map(tp => `
            <tr data-tp-id="${esc(tp.tp_id)}">
                <td style="padding:8px;font-size:12px;white-space:nowrap">${esc(tp.kode_tp ?? '')}</td>
                <td style="padding:8px;font-size:12px" class="tp-edit-desc" contenteditable="true">${esc(tp.deskripsi_tp)}</td>
                <td style="padding:8px;font-size:12px" class="tp-edit-materi" contenteditable="true">${esc(tp.materi_pokok ?? '')}</td>
                <td style="padding:8px;font-size:12px;text-align:center">${tp.alokasi_jp ?? '—'}</td>
                <td style="padding:8px;font-size:12px;text-align:center">S${tp.semester}</td>
                <td style="padding:8px">
                    <button class="btn btn-secondary btn-sm tp-save-row-btn" style="font-size:11px">Simpan</button>
                </td>
            </tr>`).join('');

        body.innerHTML = `
            <h4 style="margin:0 0 8px">Capaian Pembelajaran (${cpList.length})</h4>
            ${cpList.map(cp => `<div style="padding:8px;background:var(--color-surface-alt,#f8fafc);border-radius:6px;margin-bottom:8px;font-size:13px"><strong>${esc(cp.elemen)}</strong><p style="margin:4px 0 0;color:var(--color-muted)">${esc(cp.deskripsi_cp)}</p></div>`).join('')}
            <h4 style="margin:16px 0 8px">Tujuan Pembelajaran (${tpList.length})</h4>
            <div style="overflow-x:auto">
                <table style="width:100%;border-collapse:collapse;font-size:13px">
                    <thead><tr style="background:var(--color-surface-alt,#f8fafc)">
                        <th style="padding:8px;text-align:left">Kode</th>
                        <th style="padding:8px;text-align:left">Deskripsi TP</th>
                        <th style="padding:8px;text-align:left">Materi Pokok</th>
                        <th style="padding:8px;text-align:center">JP</th>
                        <th style="padding:8px;text-align:center">Sem</th>
                        <th style="padding:8px"></th>
                    </tr></thead>
                    <tbody id="atp-view-tp-body">${tpRows}</tbody>
                </table>
            </div>`;

        document.getElementById('atp-view-tp-body').addEventListener('click', async (e) => {
            const btn = e.target.closest('.tp-save-row-btn');
            if (!btn) return;
            const row   = btn.closest('tr');
            const tpId  = row.dataset.tpId;
            const desc  = row.querySelector('.tp-edit-desc')?.textContent?.trim();
            const mat   = row.querySelector('.tp-edit-materi')?.textContent?.trim();
            btn.disabled    = true;
            btn.textContent = '…';
            try {
                await updateTp(tpId, { deskripsi_tp: desc, materi_pokok: mat });
                btn.textContent = '✅';
                setTimeout(() => { btn.disabled = false; btn.textContent = 'Simpan'; }, 2000);
            } catch (err) {
                btn.disabled    = false;
                btn.textContent = '❌';
                alert('Gagal simpan: ' + err.message);
            }
        });
    } catch (err) {
        body.innerHTML = `<p style="color:var(--color-danger)">Gagal memuat: ${esc(err.message)}</p>`;
    }
}

// ─── Start ───────────────────────────────────────────────────
init();
