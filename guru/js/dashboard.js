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
    getForumRecipientCandidates, getForumSekolahPosts, getForumSekolahSentPosts,
    getForumSekolahPostById, getForumSekolahSentPostById,
    getForumSekolahComments, createForumSekolahPost, updateForumSekolahPost,
    deleteForumSekolahPost, addForumSekolahComment, deleteForumSekolahComment,
    addForumSekolahAcknowledgement,
    getCorePhases, getCoreSubjectsDirect, getMyTeachingCoreSubjects,
    getMyTeacherDocuments, createTeacherDocument,
    updateDocumentStatus, deleteTeacherDocument, getPendingDocApprovals, wakaApproveDoc,
    getKepsekApprovalHistory, getWakaApprovalHistory, getDisahkanWakaDocs,
    getTeacherProfile, saveTeacherProfile,
    getTeachingContext, saveTeachingContext,
    isOnDutyToday, getTodayLateArrivals, recordLateArrival, deleteLateArrival,
    getLateArrivalsByRange, getLateArrivalsAggregate,
    getTodayExits, recordExit, updateReturnTime, deleteExit,
    getClassProgramContext, getCpForSubject, checkElementDuplicate,
} from './api.js';
import { saveAttendanceBatch, flushPending, pendingCount, clearOfflineQueue } from './offline.js';
import { showPwaBanner } from '../../shared/pwa-banner.js';

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
let kpTabInitialized = false;

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
    if (!config) throw new Error('School config tidak tersedia. Hubungi admin sekolah.');
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

    await buildTabs();
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

    initPWAInstallBanner();
    showPwaBanner({ hasBottomNav: true });
}

function initPWAInstallBanner() {
    if (!sessionStorage.getItem('pwa_show_install_banner')) return;
    sessionStorage.removeItem('pwa_show_install_banner');

    if (localStorage.getItem('pwa_install_dismissed')) return;

    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true;
    if (isStandalone) return;

    const banner = document.getElementById('pwa-install-banner');
    if (!banner) return;
    banner.style.display = 'flex';

    const autoHide = setTimeout(() => { banner.style.display = 'none'; }, 10000);

    document.getElementById('pwa-install-btn')?.addEventListener('click', () => {
        clearTimeout(autoHide);
        banner.style.display = 'none';
        localStorage.setItem('pwa_install_dismissed', '1');
        showPWAInstallInstructions();
    });

    document.getElementById('pwa-dismiss-btn')?.addEventListener('click', () => {
        clearTimeout(autoHide);
        banner.style.display = 'none';
    });
}

function showPWAInstallInstructions() {
    const isIOS     = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const isAndroid = /Android/.test(navigator.userAgent);

    let steps = '';
    if (isIOS) {
        steps = `<li>Tap tombol <strong>Bagikan</strong> (□↑) di Safari</li>
                 <li>Scroll ke bawah, tap <strong>"Tambahkan ke Layar Utama"</strong></li>
                 <li>Tap <strong>Tambahkan</strong></li>`;
    } else if (isAndroid) {
        steps = `<li>Tap menu <strong>⋮</strong> di Chrome</li>
                 <li>Tap <strong>"Tambahkan ke layar utama"</strong></li>
                 <li>Tap <strong>Tambahkan</strong></li>`;
    } else {
        steps = `<li>Klik ikon <strong>Install</strong> (⊕) di address bar browser</li>
                 <li>Klik <strong>Install</strong></li>`;
    }

    const overlay = document.createElement('div');
    overlay.innerHTML = `
      <div style="position:fixed;inset:0;background:rgba(0,0,0,0.5);
                  z-index:9999;display:flex;align-items:center;
                  justify-content:center;padding:16px">
        <div style="background:var(--color-surface,#1e293b);border-radius:16px;
                    padding:24px;max-width:360px;width:100%;color:var(--color-text,#fff)">
          <h3 style="margin:0 0 16px;font-size:18px">📱 Pasang Aplikasi SIP</h3>
          <ol style="margin:0;padding-left:20px;line-height:1.8">${steps}</ol>
          <button onclick="this.closest('div[style]').remove()"
                  style="margin-top:16px;width:100%;padding:10px;
                         background:var(--color-primary,#1d4ed8);color:white;
                         border:none;border-radius:8px;cursor:pointer;font-size:14px">
            Mengerti
          </button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
}

// ─── Tab navigation ──────────────────────────────────────────
const TAB_SHORT = {
    guru: 'Beranda', wali_kelas: 'Wali', bk: 'BK', kaprodi: 'Prodi',
    waka_kesiswaan: 'Kesiswaan', waka_kurikulum: 'Kurikulum', waka_humas: 'Humas',
    kepsek: 'Kepsek', ks_admin: 'Admin',
    kasus: 'Pembinaan', jurnal: 'Jurnal', observasi: 'Catatan', forum: 'Forum',
    perangkat_ajar: 'Perangkat', piket: 'Piket',
};
const TAB_ICON = {
    guru: 'ti-home', wali_kelas: 'ti-users', bk: 'ti-heart-handshake', kaprodi: 'ti-building',
    waka_kesiswaan: 'ti-school', waka_kurikulum: 'ti-book', waka_humas: 'ti-briefcase',
    kepsek: 'ti-chart-line', ks_admin: 'ti-shield-check',
    kasus: 'ti-alert-triangle', jurnal: 'ti-notebook', observasi: 'ti-notes', forum: 'ti-messages',
    perangkat_ajar: 'ti-book-2', piket: 'ti-clipboard-list',
};

async function buildTabs() {
    const nav    = document.getElementById('tab-nav');
    const botNav = document.getElementById('bottom-nav');
    const tabs = [];
    if (isTeacher) tabs.push({ key: 'guru', label: 'Dashboard Guru' });
    jabatan.forEach(j => tabs.push({ key: j, label: jabatanLabel(j) }));
    tabs.push({ key: 'kasus', label: 'Pembinaan Siswa' });
    if (jabatan.includes('kepsek')) tabs.push({ key: 'ks_admin', label: 'Kelola Admin' });
    const onDuty = await isOnDutyToday();
    if (onDuty) tabs.push({ key: 'piket', label: 'Piket' });
    if (isTeacher) tabs.push({ key: 'observasi', label: 'Catatan Siswa' });
    if (isTeacher) tabs.push({ key: 'jurnal', label: 'Jurnal Mengajar' });
    if (isTeacher) tabs.push({ key: 'perangkat_ajar', label: 'Perangkat Ajar' });
    tabs.push({ key: 'forum', label: 'Forum' });

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
    try {
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
            case 'piket':       await initPiketTab(); break;
            case 'jurnal':      await initJurnalTab(); break;
            case 'observasi':   await initObsTab(); break;
            case 'perangkat_ajar': await initPerangkatAjarTab(); break;
            case 'forum':       await initForumTab(); break;
        }
    } catch (err) {
        console.error('[loadTabContent]', key, err);
        const activePanel = document.querySelector('.tab-panel.active .page-body');
        if (activePanel) {
            activePanel.innerHTML = '<p style="padding:1.5rem; color:red">Gagal memuat tab ini. Silakan coba lagi atau refresh halaman.</p>';
        }
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
            if (!ds || !de) {
                body.innerHTML = '<p class="acc-empty">Pilih rentang tanggal untuk melihat detail sesi. Untuk data lengkap, gunakan fitur Unduh Excel.</p>';
                return;
            }
            try {
                const sessions = await getStudentAttendanceSessions(sid, ds, de, currentUser.user_id);
                if (!sessions.length) {
                    body.innerHTML = '<p class="acc-empty">Belum ada sesi tercatat.</p>';
                    return;
                }
                const grouped = [];
                const seen = new Map();
                for (const s of sessions) {
                    const key = `${s.schedule.session_date}|${s.schedule.subject_label ?? ''}`;
                    if (!seen.has(key)) { seen.set(key, true); grouped.push(s); }
                }
                body.innerHTML = grouped.map(s => `
                    <div style="display:flex;align-items:center;gap:8px;
                        padding:7px 16px;border-top:0.5px solid var(--color-border)">
                        <span style="font-size:12px;color:var(--color-text-muted);min-width:90px">
                            ${esc(s.schedule.session_date)}
                        </span>
                        <span style="flex:1;font-size:12px;color:var(--color-text-muted)">
                            ${esc(s.schedule.subject_label ?? '—')}
                        </span>
                        <span style="font-size:11px;font-weight:600;
                            color:${STATUS_COLOR[s.status] ?? 'var(--color-text-muted)'}">
                            ${STATUS_LABEL[s.status] ?? esc(s.status)}
                        </span>
                        <span style="font-size:11px;color:var(--color-text-muted);min-width:100px;text-align:right">
                            ${s.status === 'IZIN' && s.notes ? esc(s.notes) : '—'}
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
                <span class="att-acc-name">${esc(label)}</span>
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
                        <span class="att-acc-name">${esc(dayLabel)}</span>
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
                    ['Tanggal', 'Jam', 'Mata Pelajaran', 'Guru', 'Status', 'Keterangan'],
                    ...sessions.map(s => [
                        s.schedule?.session_date ?? '',
                        s.schedule?.session_start ? fmtTime(s.schedule.session_start) : '',
                        s.schedule?.subject_label ?? '',
                        s.schedule?.teacher?.full_name ?? '',
                        s.status ?? '',
                        s.status === 'IZIN' ? (s.notes ?? '') : '',
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
                if (!ds || !de) {
                    body.innerHTML = '<p class="acc-empty">Pilih rentang tanggal untuk melihat detail sesi. Untuk data lengkap, gunakan fitur Unduh Excel.</p>';
                    return;
                }
                try {
                    const sessions = await getStudentAttendanceSessions(sid, ds, de);
                    if (!sessions.length) {
                        body.innerHTML = '<p class="acc-empty">Belum ada sesi tercatat.</p>';
                        return;
                    }
                    const grouped = [];
                    const seen = new Map();
                    for (const s of sessions) {
                        const key = `${s.schedule.session_date}|${s.schedule.subject_label ?? ''}|${s.schedule.teacher?.full_name ?? ''}`;
                        if (!seen.has(key)) {
                            seen.set(key, true);
                            grouped.push(s);
                        }
                    }
                    const STATUS_COLOR = {
                        HADIR: 'var(--color-success)',
                        IZIN:  'var(--color-warning,#f59e0b)',
                        SAKIT: 'var(--color-primary)',
                        ALPA: 'var(--color-danger)',
                    };
                    const STATUS_LABEL = { HADIR:'Hadir', IZIN:'Izin', SAKIT:'Sakit', ALPA:'Alpa' };
                    body.innerHTML = grouped.map(s => `
                        <div style="display:flex;align-items:center;gap:8px;
                            padding:7px 16px;border-top:0.5px solid var(--color-border)">
                            <span style="font-size:12px;color:var(--color-text-muted);min-width:90px">
                                ${esc(s.schedule.session_date)}
                            </span>
                            <span style="flex:1;font-size:12px;color:var(--color-text-muted)">
                                ${esc(s.schedule.subject_label ?? '—')} · ${esc(s.schedule.teacher?.full_name ?? '—')}
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
                            <span class="att-acc-name">${esc(r.name)}</span>
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
                    <span class="att-acc-name">${esc(prog.name)}</span>
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
                                    <span class="att-acc-name">
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
                            if (!ds || !de) {
                                sBody.innerHTML = '<p class="hint" style="padding:8px 24px">Pilih rentang tanggal untuk melihat detail sesi. Untuk data lengkap, gunakan fitur Unduh Excel.</p>';
                                return;
                            }
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
                                const grouped = [];
                                const seen = new Map();
                                for (const s of sessions) {
                                    const key = `${s.schedule.session_date}|${s.schedule.subject_label ?? ''}|${s.schedule.teacher?.full_name ?? ''}`;
                                    if (!seen.has(key)) { seen.set(key, true); grouped.push(s); }
                                }
                                sBody.innerHTML = grouped.map(s => `
                                    <div style="display:flex;align-items:center;gap:8px;
                                        padding:7px 24px;border-top:0.5px solid var(--color-border)">
                                        <span style="font-size:12px;color:var(--color-text-muted);min-width:90px">
                                            ${esc(s.schedule.session_date)}
                                        </span>
                                        <span style="flex:1;font-size:12px;color:var(--color-text-muted)">
                                            ${esc(s.schedule.subject_label ?? '—')} · ${esc(s.schedule.teacher?.full_name ?? '—')}
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

    document.getElementById('wk-late-start').value = firstOfMonth;
    document.getElementById('wk-late-end').value   = today;
    document.getElementById('wk-late-filter-btn').onclick = loadWkLateRecap;

    await loadWkAttendanceRecap();
    await loadWkLateRecap();
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
                    <span class="att-acc-name">${esc(prog.name)}</span>
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
                                    <span class="att-acc-name">
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
                            if (!ds || !de) {
                                sBody.innerHTML = '<p class="hint" style="padding:8px 24px">Pilih rentang tanggal untuk melihat detail sesi. Untuk data lengkap, gunakan fitur Unduh Excel.</p>';
                                return;
                            }
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
                                const grouped = [];
                                const seen = new Map();
                                for (const s of sessions) {
                                    const key = `${s.schedule.session_date}|${s.schedule.subject_label ?? ''}|${s.schedule.teacher?.full_name ?? ''}`;
                                    if (!seen.has(key)) { seen.set(key, true); grouped.push(s); }
                                }
                                sBody.innerHTML = grouped.map(s => `
                                    <div style="display:flex;align-items:center;gap:8px;
                                        padding:7px 24px;border-top:0.5px solid var(--color-border)">
                                        <span style="font-size:12px;color:var(--color-text-muted);min-width:90px">
                                            ${esc(s.schedule.session_date)}
                                        </span>
                                        <span style="flex:1;font-size:12px;color:var(--color-text-muted)">
                                            ${esc(s.schedule.subject_label ?? '—')} · ${esc(s.schedule.teacher?.full_name ?? '—')}
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

async function loadWkLateRecap() {
    const start     = document.getElementById('wk-late-start').value;
    const end       = document.getElementById('wk-late-end').value;
    const container = document.getElementById('wk-late-recap');
    if (!start || !end || start > end) {
        container.innerHTML = '<p class="hint" style="color:var(--color-danger)">Rentang tanggal tidak valid.</p>';
        return;
    }
    container.innerHTML = '<p class="hint">Memuat…</p>';
    try {
        const rows = await getLateArrivalsByRange(start, end);
        if (!rows.length) {
            container.innerHTML = '<p class="hint">Tidak ada catatan keterlambatan pada rentang ini.</p>';
            return;
        }
        const fmtDisp = d => new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day:'numeric', month:'short', year:'numeric' });
        container.innerHTML = `
            <p class="hint" style="margin-bottom:8px">${rows.length} catatan ditemukan</p>
            <div style="overflow-x:auto">
            <table class="table" style="width:100%">
                <thead><tr>
                    <th>Tanggal</th><th>Nama Siswa</th><th>NIS</th>
                    <th>Kelas</th><th>Jam Datang</th><th>Alasan</th><th>Dicatat Oleh</th>
                </tr></thead>
                <tbody>${rows.map(r => `
                    <tr>
                        <td style="white-space:nowrap">${fmtDisp(r.date)}</td>
                        <td>${esc(r.student_name)}</td>
                        <td>${esc(r.nis)}</td>
                        <td>${esc(r.class_name)}</td>
                        <td style="white-space:nowrap">${r.arrival_time.slice(0,5)}</td>
                        <td>${esc(r.reason || '—')}</td>
                        <td>${esc(r.recorder)}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
            </div>`;
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

function handleKpStudentsClick(e) {
    const btn = e.target.closest('.kp-finish-btn');
    if (btn) handleFinishPkl(btn);
}

async function initKaprodiTab() {
    if (kpTabInitialized) return;
    kpTabInitialized = true;

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

        const studentsBody = document.getElementById('kp-students-body');
        studentsBody.removeEventListener('click', handleKpStudentsClick);
        studentsBody.addEventListener('click', handleKpStudentsClick);

        await Promise.all([loadKpRecap(), loadKpClsRecap(), loadKpObs(), initKpPlacementForm(programId)]);
        document.querySelectorAll('#kp-accordion .kp-acc-header').forEach(header => {
            const newHeader = header.cloneNode(true);
            header.parentNode.replaceChild(newHeader, header);
            newHeader.addEventListener('click', () => {
                const targetId = newHeader.dataset.target;
                const isOpen   = newHeader.closest('.kp-acc-item').classList.contains('open');
                document.querySelectorAll('#kp-accordion .kp-acc-item').forEach(item => {
                    item.classList.remove('open');
                    item.querySelector('.kp-acc-body').style.display = 'none';
                });
                if (!isOpen) {
                    const item = newHeader.closest('.kp-acc-item');
                    item.classList.add('open');
                    document.getElementById(targetId).style.display = 'block';
                }
            });
        });
    } catch (err) {
        console.error('[kaprodi]', err);
        const panel = document.getElementById('tab-kaprodi')?.querySelector('.page-body');
        if (panel) {
            panel.innerHTML = '<div class="section-card"><p style="color:red;padding:8px">Gagal memuat tab Kaprodi. Silakan coba lagi atau refresh halaman.</p></div>';
        }
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
    const empty = document.getElementById('kp-students-empty');

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
                        <span class="att-acc-name">${esc(r.name)}</span>
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
                                    <span class="att-acc-name">
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
                            if (!ds || !de) {
                                sBody.innerHTML = '<p class="hint" style="padding:8px 24px">Pilih rentang tanggal untuk melihat detail sesi. Untuk data lengkap, gunakan fitur Unduh Excel.</p>';
                                return;
                            }
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
                                const grouped = [];
                                const seen = new Map();
                                for (const s of sessions) {
                                    const key = `${s.schedule.session_date}|${s.schedule.subject_label ?? ''}|${s.schedule.teacher?.full_name ?? ''}`;
                                    if (!seen.has(key)) { seen.set(key, true); grouped.push(s); }
                                }
                                sBody.innerHTML = grouped.map(s => `
                                    <div style="display:flex;align-items:center;gap:8px;
                                        padding:7px 24px;border-top:0.5px solid var(--color-border)">
                                        <span style="font-size:12px;color:var(--color-text-muted);min-width:90px">
                                            ${esc(s.schedule.session_date)}
                                        </span>
                                        <span style="flex:1;font-size:12px;color:var(--color-text-muted)">
                                            ${esc(s.schedule.subject_label ?? '—')} · ${esc(s.schedule.teacher?.full_name ?? '—')}
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
    await loadWakaDocApprovals();
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

        // Wire keterlambatan filter
        document.getElementById('ks-late-start').value = localDateStr(new Date(Date.now() - 29 * 86400000));
        document.getElementById('ks-late-end').value   = localDateStr();
        document.getElementById('ks-late-filter-btn').addEventListener('click', loadKsLateRecap);
    }
    await loadKepsekMonitoring('7_hari');
    await loadKepsekDisahkanDocs();
    await loadKsLateRecap();
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

async function loadKsLateRecap() {
    const start     = document.getElementById('ks-late-start').value;
    const end       = document.getElementById('ks-late-end').value;
    const container = document.getElementById('ks-late-recap');
    if (!start || !end || start > end) {
        container.innerHTML = '<p class="hint" style="color:var(--color-danger)">Rentang tanggal tidak valid.</p>';
        return;
    }
    container.innerHTML = '<p class="hint">Memuat…</p>';
    try {
        const rows = await getLateArrivalsAggregate(start, end);
        if (!rows.length) {
            container.innerHTML = '<p class="hint">Tidak ada catatan keterlambatan pada rentang ini.</p>';
            return;
        }
        const total = rows.reduce((s, r) => s + r.total, 0);
        const fmtDisp = d => new Date(d + 'T00:00:00').toLocaleDateString('id-ID', { day:'numeric', month:'short', year:'numeric' });
        container.innerHTML = `
            <p class="hint" style="margin-bottom:8px">Total: <strong>${total}</strong> kejadian dalam ${rows.length} hari</p>
            <div style="overflow-x:auto">
            <table class="table" style="width:100%;max-width:420px">
                <thead><tr>
                    <th>Tanggal</th>
                    <th style="text-align:right">Jumlah Siswa Terlambat</th>
                </tr></thead>
                <tbody>${rows.map(r => `
                    <tr>
                        <td>${fmtDisp(r.date)}</td>
                        <td style="text-align:right;font-weight:600">${r.total}</td>
                    </tr>`).join('')}
                </tbody>
            </table>
            </div>`;
    } catch (err) {
        container.innerHTML = `<div class="alert alert-danger">${esc(fe(err))}</div>`;
    }
}

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

// ─── TAB PIKET ───────────────────────────────────────────────

const PIKET_OPEN_HOUR  = 7;
const PIKET_OPEN_MIN   = 0;
const PIKET_CLOSE_HOUR = 16;
const PIKET_CLOSE_MIN  = 0;
const PIKET_LATE_LIMIT = '07:15';

function _piketFormActive() {
    const now = new Date();
    const mins = now.getHours() * 60 + now.getMinutes();
    const open  = PIKET_OPEN_HOUR  * 60 + PIKET_OPEN_MIN;
    const close = PIKET_CLOSE_HOUR * 60 + PIKET_CLOSE_MIN;
    return mins >= open && mins < close;
}

let _piketTabInit = false;
let _piketDebounceTimer = null;
let _piketSelectedStudent = null;

async function initPiketTab() {
    const panel = document.querySelector('#tab-piket .page-body');
    if (!panel) return;

    panel.innerHTML = `
        <div class="section-card" id="piket-ringkasan-card">
            <h3>Ringkasan Hari Ini</h3>
            <div id="piket-ringkasan-content"><p style="color:var(--color-text-muted);font-size:13px">Memuat…</p></div>
        </div>
        <div class="section-card" id="piket-form-card">
            <h3>Catat Keterlambatan</h3>
            <div id="piket-form-wrap"></div>
        </div>
        <div class="section-card" id="piket-rekap-card">
            <h3>Rekap Hari Ini</h3>
            <div id="piket-rekap-content"><p style="color:var(--color-text-muted);font-size:13px">Memuat…</p></div>
        </div>
        <div class="section-card" id="piket-exit-form-card">
            <h3>Catat Izin Keluar</h3>
            <div id="piket-exit-form-wrap">
                <p class="hint">Form tidak tersedia di luar jam 07:00–16:00.</p>
            </div>
        </div>
        <div class="section-card" id="piket-exits-card">
            <h3>Izin Keluar Hari Ini</h3>
            <div id="piket-exits-content"><p class="hint">Memuat…</p></div>
        </div>`;

    _piketTabInit = true;
    await _piketRenderAll();
}

async function _piketRenderAll() {
    await Promise.all([_piketRenderRingkasan(), _piketRenderForm(), _piketRenderRekap(), _piketRenderExitForm(), _piketRenderExits()]);
}

async function _piketRenderRingkasan() {
    const el = document.getElementById('piket-ringkasan-content');
    if (!el) return;
    const arrivals = await getTodayLateArrivals();
    const active   = _piketFormActive();
    el.innerHTML = `
        <div style="display:flex;gap:1.5rem;flex-wrap:wrap;align-items:flex-start;font-size:14px">
            <div style="background:var(--color-bg);border-radius:8px;padding:12px 20px;text-align:center;min-width:100px">
                <div style="font-size:2rem;font-weight:700;color:var(--color-primary)">${arrivals.length}</div>
                <div style="color:var(--color-text-muted);font-size:12px">Siswa terlambat</div>
            </div>
            <div style="padding-top:4px">
                <p style="margin:0 0 4px"><strong>Batas masuk:</strong> ${PIKET_LATE_LIMIT}</p>
                <p style="margin:0"><strong>Form pencatatan:</strong>
                    <span style="color:${active ? 'var(--color-success,#16a34a)' : 'var(--color-danger,#dc2626)'}">
                        ${active ? '✓ Aktif (07:00–16:00)' : '✗ Di luar jam operasional'}
                    </span>
                </p>
            </div>
        </div>`;
}

async function _piketRenderForm() {
    const wrap = document.getElementById('piket-form-wrap');
    if (!wrap) return;
    const active = _piketFormActive();
    const nowTime = new Date().toTimeString().slice(0, 5);

    wrap.innerHTML = `
        ${!active ? `<p style="color:var(--color-text-muted);font-size:13px;font-style:italic">Form tidak tersedia di luar jam 07:00–16:00.</p>` : ''}
        <div style="${active ? '' : 'opacity:0.5;pointer-events:none'}">
            <div class="field" style="position:relative;margin-bottom:12px">
                <label for="piket-search-input" style="font-size:13px;font-weight:500;display:block;margin-bottom:4px">Cari Siswa</label>
                <input type="text" id="piket-search-input" placeholder="Ketik nama atau NIS…"
                       class="input" autocomplete="off" ${active ? '' : 'disabled'}>
                <div id="piket-search-results" style="position:absolute;top:100%;left:0;right:0;
                     background:var(--color-surface);border:1px solid var(--color-border);
                     border-radius:6px;z-index:100;display:none;max-height:200px;overflow-y:auto"></div>
            </div>
            <div id="piket-selected-student" style="display:none;margin-bottom:12px;padding:8px 12px;
                 background:var(--color-bg);border-radius:6px;font-size:13px"></div>
            <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px">
                <div class="field" style="flex:1;min-width:120px">
                    <label for="piket-arrival-time" style="font-size:13px;font-weight:500;display:block;margin-bottom:4px">Jam Datang</label>
                    <input type="time" id="piket-arrival-time" class="input"
                           value="${nowTime}" min="07:00" max="16:00" ${active ? '' : 'disabled'}>
                </div>
            </div>
            <div class="field" style="margin-bottom:12px">
                <label for="piket-reason" style="font-size:13px;font-weight:500;display:block;margin-bottom:4px">Alasan <span style="color:var(--color-text-muted)">(opsional)</span></label>
                <textarea id="piket-reason" class="input" rows="2"
                          placeholder="Misal: macet, bangun kesiangan…" ${active ? '' : 'disabled'}></textarea>
            </div>
            <button id="piket-submit-btn" class="btn btn-primary" ${active ? '' : 'disabled'}>Catat Keterlambatan</button>
            <div id="piket-form-msg" style="margin-top:8px;font-size:13px"></div>
        </div>`;

    if (!active) return;

    const searchInput = document.getElementById('piket-search-input');
    const resultsEl   = document.getElementById('piket-search-results');
    const selectedEl  = document.getElementById('piket-selected-student');
    const submitBtn   = document.getElementById('piket-submit-btn');
    const msgEl       = document.getElementById('piket-form-msg');
    _piketSelectedStudent = null;

    searchInput.addEventListener('input', () => {
        clearTimeout(_piketDebounceTimer);
        _piketDebounceTimer = setTimeout(async () => {
            const q = searchInput.value.trim();
            if (q.length < 2) { resultsEl.style.display = 'none'; return; }
            try {
                const results = await searchStudents(q, currentUser.school_id);
                if (!results.length) {
                    resultsEl.innerHTML = '<div style="padding:10px;font-size:13px;color:var(--color-text-muted)">Siswa tidak ditemukan.</div>';
                } else {
                    resultsEl.innerHTML = results.map(s => `
                        <div data-id="${esc(s.student_id)}" data-name="${esc(s.full_name)}" data-class="${esc(s.class_name)}"
                             style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--color-border)"
                             class="piket-result-item">
                            <strong>${esc(s.full_name)}</strong>
                            <span style="color:var(--color-text-muted)"> — ${esc(s.class_name || '—')} · ${esc(s.nis || '')}</span>
                        </div>`).join('');
                    resultsEl.querySelectorAll('.piket-result-item').forEach(item => {
                        item.addEventListener('mouseenter', () => { item.style.background = 'var(--color-bg)'; });
                        item.addEventListener('mouseleave', () => { item.style.background = ''; });
                        item.addEventListener('click', () => {
                            _piketSelectedStudent = { student_id: item.dataset.id, full_name: item.dataset.name, class_name: item.dataset.class };
                            searchInput.value = item.dataset.name;
                            resultsEl.style.display = 'none';
                            selectedEl.style.display = 'block';
                            selectedEl.innerHTML = `<i class="ti ti-user-check" style="color:var(--color-success,#16a34a)"></i>
                                <strong>${esc(item.dataset.name)}</strong> — ${esc(item.dataset.class)}`;
                        });
                    });
                }
                resultsEl.style.display = 'block';
            } catch { resultsEl.style.display = 'none'; }
        }, 300);
    });

    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !resultsEl.contains(e.target)) {
            resultsEl.style.display = 'none';
        }
    }, { once: false });

    submitBtn.addEventListener('click', async () => {
        msgEl.textContent = '';
        if (!_piketSelectedStudent) { msgEl.style.color = 'var(--color-danger,#dc2626)'; msgEl.textContent = 'Pilih siswa dulu dari hasil pencarian.'; return; }
        const arrivalTime = document.getElementById('piket-arrival-time').value;
        if (!arrivalTime) { msgEl.style.color = 'var(--color-danger,#dc2626)'; msgEl.textContent = 'Isi jam datang.'; return; }
        const reason = document.getElementById('piket-reason').value.trim();

        submitBtn.disabled = true;
        submitBtn.textContent = 'Menyimpan…';
        try {
            await recordLateArrival(_piketSelectedStudent.student_id, arrivalTime, reason || null, currentUser.school_id);
            msgEl.style.color = 'var(--color-success,#16a34a)';
            msgEl.textContent = `✓ Keterlambatan ${_piketSelectedStudent.full_name} berhasil dicatat.`;
            _piketSelectedStudent = null;
            searchInput.value = '';
            selectedEl.style.display = 'none';
            selectedEl.innerHTML = '';
            document.getElementById('piket-reason').value = '';
            await Promise.all([_piketRenderRingkasan(), _piketRenderRekap()]);
        } catch (err) {
            msgEl.style.color = 'var(--color-danger,#dc2626)';
            msgEl.textContent = fe(err, 's');
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Catat Keterlambatan';
        }
    });
}

async function _piketRenderRekap() {
    const el = document.getElementById('piket-rekap-content');
    if (!el) return;
    el.innerHTML = '<p style="color:var(--color-text-muted);font-size:13px">Memuat…</p>';
    const arrivals = await getTodayLateArrivals();
    if (!arrivals.length) {
        el.innerHTML = '<p style="color:var(--color-text-muted);font-size:13px;font-style:italic">Belum ada keterlambatan hari ini.</p>';
        return;
    }
    el.innerHTML = `
        <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;font-size:13px">
                <thead>
                    <tr style="border-bottom:2px solid var(--color-border);text-align:left">
                        <th style="padding:8px 10px;white-space:nowrap">Nama Siswa</th>
                        <th style="padding:8px 10px;white-space:nowrap">Kelas</th>
                        <th style="padding:8px 10px;white-space:nowrap">Jam Datang</th>
                        <th style="padding:8px 10px">Alasan</th>
                        <th style="padding:8px 10px;white-space:nowrap">Dicatat Oleh</th>
                        <th style="padding:8px 10px">Aksi</th>
                    </tr>
                </thead>
                <tbody>
                    ${arrivals.map(r => `
                        <tr style="border-bottom:1px solid var(--color-border)" data-late-id="${esc(r.late_id)}">
                            <td style="padding:8px 10px">${esc(r.student_name)}</td>
                            <td style="padding:8px 10px;white-space:nowrap">${esc(r.class_name)}</td>
                            <td style="padding:8px 10px;white-space:nowrap">${fmtTime(r.arrival_time)}</td>
                            <td style="padding:8px 10px">${r.reason ? esc(r.reason) : '<span style="color:var(--color-text-muted)">—</span>'}</td>
                            <td style="padding:8px 10px;white-space:nowrap">${esc(r.recorder_name)}</td>
                            <td style="padding:8px 10px">
                                ${r.recorded_by === currentUser.user_id
                                    ? `<button class="btn btn-sm btn-danger piket-delete-btn" data-id="${esc(r.late_id)}">Hapus</button>`
                                    : ''}
                            </td>
                        </tr>`).join('')}
                </tbody>
            </table>
        </div>`;

    el.querySelectorAll('.piket-delete-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm('Hapus catatan keterlambatan ini?')) return;
            btn.disabled = true;
            try {
                await deleteLateArrival(btn.dataset.id);
                await Promise.all([_piketRenderRingkasan(), _piketRenderRekap()]);
            } catch (err) {
                alert(fe(err, 'h'));
                btn.disabled = false;
            }
        });
    });
}

async function _piketRenderExitForm() {
    const wrap = document.getElementById('piket-exit-form-wrap');
    if (!wrap) return;
    if (!_piketFormActive()) {
        wrap.innerHTML = '<p class="hint">Form tidak tersedia di luar jam 07:00–16:00.</p>';
        return;
    }
    const now = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
    wrap.innerHTML = `
        <div class="field">
            <label for="piket-exit-search">Cari Siswa</label>
            <input type="text" id="piket-exit-search" class="input" placeholder="Ketik nama atau NIS…" autocomplete="off" />
            <div id="piket-exit-dropdown" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:20;background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius);max-height:200px;overflow-y:auto"></div>
        </div>
        <div id="piket-exit-selected" style="display:none;margin-bottom:8px"></div>
        <div class="field">
            <label for="piket-exit-time">Jam Keluar</label>
            <input type="time" id="piket-exit-time" class="input" value="${now}" min="07:00" max="16:00" />
        </div>
        <div class="field">
            <label for="piket-exit-reason">Alasan <span style="color:var(--color-text-muted)">(opsional)</span></label>
            <textarea id="piket-exit-reason" class="input" rows="2" placeholder="Keperluan keluar…"></textarea>
        </div>
        <button class="btn btn-primary" id="piket-exit-submit" disabled>Catat Izin Keluar</button>
    `;

    let _exitSelectedStudent = null;
    let _exitDebounceTimer   = null;

    const searchEl  = document.getElementById('piket-exit-search');
    const dropEl    = document.getElementById('piket-exit-dropdown');
    const selectedEl= document.getElementById('piket-exit-selected');
    const submitBtn = document.getElementById('piket-exit-submit');

    searchEl.addEventListener('input', () => {
        clearTimeout(_exitDebounceTimer);
        _exitDebounceTimer = setTimeout(async () => {
            const q = searchEl.value.trim();
            if (q.length < 2) { dropEl.style.display = 'none'; return; }
            try {
                const results = await searchStudents(q, currentUser.school_id);
                if (!results.length) { dropEl.style.display = 'none'; return; }
                dropEl.innerHTML = results.slice(0, 8).map(s =>
                    `<div class="search-result-item" data-id="${esc(s.student_id)}"
                          style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--color-border)">
                        ${esc(s.full_name)} <span style="color:var(--color-text-muted);font-size:12px">${esc(s.nis)} — ${esc(s.class_name ?? '')}</span>
                     </div>`).join('');
                dropEl.style.display = 'block';
                dropEl.querySelectorAll('.search-result-item').forEach(el => {
                    el.addEventListener('click', () => {
                        _exitSelectedStudent = results.find(s => s.student_id === el.dataset.id);
                        searchEl.value = '';
                        dropEl.style.display = 'none';
                        selectedEl.innerHTML = `<span class="badge badge-info">✓ ${esc(_exitSelectedStudent.full_name)} — ${esc(_exitSelectedStudent.class_name ?? '')}</span>
                            <button type="button" style="margin-left:8px;background:none;border:none;cursor:pointer;color:var(--color-text-muted)" id="piket-exit-clear">×</button>`;
                        selectedEl.style.display = 'block';
                        submitBtn.disabled = false;
                        document.getElementById('piket-exit-clear')?.addEventListener('click', () => {
                            _exitSelectedStudent = null;
                            selectedEl.style.display = 'none';
                            submitBtn.disabled = true;
                        });
                    });
                });
            } catch (e) {
                console.error('searchStudents (exit):', e);
                dropEl.innerHTML = `<div style="padding:8px 12px;color:var(--color-danger,#dc2626)">Pencarian gagal. Coba lagi.</div>`;
                dropEl.style.display = 'block';
            }
        }, 300);
    });

    submitBtn.addEventListener('click', async () => {
        if (!_exitSelectedStudent) return;
        const exitTime = document.getElementById('piket-exit-time').value;
        const reason   = document.getElementById('piket-exit-reason').value.trim();
        if (!exitTime) { alert('Jam keluar wajib diisi.'); return; }
        submitBtn.disabled = true;
        submitBtn.textContent = 'Menyimpan…';
        try {
            await recordExit(_exitSelectedStudent.student_id, exitTime, reason || null, currentUser.school_id, currentUser.user_id);
            _exitSelectedStudent = null;
            selectedEl.style.display = 'none';
            submitBtn.disabled = true;
            document.getElementById('piket-exit-reason').value = '';
            await _piketRenderAll();
        } catch (e) {
            alert('Gagal mencatat: ' + (e.message ?? e));
            submitBtn.disabled = false;
        } finally {
            submitBtn.textContent = 'Catat Izin Keluar';
        }
    });
}

async function _piketRenderExits() {
    const content = document.getElementById('piket-exits-content');
    if (!content) return;
    const exits = await getTodayExits();
    const currentUserId = currentUser?.user_id ?? null;
    if (!exits.length) {
        content.innerHTML = '<p class="hint">Belum ada siswa izin keluar hari ini.</p>';
        return;
    }
    content.innerHTML = `
        <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;font-size:13px">
                <thead>
                    <tr style="border-bottom:2px solid var(--color-border);text-align:left">
                        <th style="padding:8px 10px">Nama Siswa</th>
                        <th style="padding:8px 10px">Kelas</th>
                        <th style="padding:8px 10px">Jam Keluar</th>
                        <th style="padding:8px 10px">Jam Kembali</th>
                        <th style="padding:8px 10px">Alasan</th>
                        <th style="padding:8px 10px">Aksi</th>
                    </tr>
                </thead>
                <tbody>
                    ${exits.map(r => `
                        <tr style="border-bottom:1px solid var(--color-border)" data-exit-id="${esc(r.exit_id)}">
                            <td style="padding:8px 10px">${esc(r.student_name)}</td>
                            <td style="padding:8px 10px">${esc(r.class_name)}</td>
                            <td style="padding:8px 10px">${r.exit_time ? r.exit_time.slice(0,5) : '—'}</td>
                            <td style="padding:8px 10px">
                                ${r.return_time
                                    ? r.return_time.slice(0,5)
                                    : (r.recorder_id === currentUserId
                                        ? `<button class="btn btn-sm btn-secondary piket-return-btn" data-exit-id="${esc(r.exit_id)}">Catat Kembali</button>`
                                        : '—')}
                            </td>
                            <td style="padding:8px 10px">${r.reason ? esc(r.reason) : '<span style="color:var(--color-text-muted)">—</span>'}</td>
                            <td style="padding:8px 10px">
                                ${r.recorder_id === currentUserId
                                    ? `<button class="btn btn-sm btn-danger piket-exit-delete-btn" data-exit-id="${esc(r.exit_id)}">Hapus</button>`
                                    : ''}
                            </td>
                        </tr>`).join('')}
                </tbody>
            </table>
        </div>`;

    content.querySelectorAll('.piket-return-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const now = new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
            const returnTime = prompt('Jam kembali (HH:MM):', now);
            if (!returnTime) return;
            try {
                await updateReturnTime(btn.dataset.exitId, returnTime);
                await _piketRenderExits();
            } catch (e) { alert('Gagal mencatat jam kembali: ' + (e.message ?? e)); }
        });
    });

    content.querySelectorAll('.piket-exit-delete-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm('Hapus catatan izin keluar ini?')) return;
            try {
                await deleteExit(btn.dataset.exitId);
                await _piketRenderAll();
            } catch (e) { alert('Gagal menghapus: ' + (e.message ?? e)); }
        });
    });
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

    // Inisialisasi logika sub-tab Penilaian (pasang event listener switching)
    await initPenilaianTab();
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

// ─── Forum Sekolah — State ─────────────────────────────────────
let _forumMode        = 'masuk';   // 'masuk' | 'terkirim'
let _forumOffset      = 0;
let _forumHasMore     = false;
let _forumTabInit     = false;
let _forumScope       = null;      // dari fn_get_user_forum_scope
let _forumEditPostId  = null;      // null = buat baru, uuid = edit

// State panel pilih penerima
let _forumRecipients  = new Map(); // user_id → { user_id, full_name, role_label }
let _forumGroupLabels = new Map(); // groupKey → label string
let _forumGroupBtns   = new Map(); // groupKey → btnEl
let _forumGroupUids   = new Map(); // groupKey → Set<uid>
let _forumPrograms    = [];        // [{ program_id, name }]
let _forumClasses     = [];        // [{ class_id, name, grade_level, program_id }]

// Drill-down picker state
let _drillType       = null;        // 'SISWA' | 'ORTU'
let _drillExpanded   = new Set();   // program_id yang ter-expand
let _drillJurusanAll = new Set();   // program_id pilih semua
let _drillKelasAll   = new Set();   // class_id pilih semua
let _drillIndividu      = new Map();   // user_id → candidate
let _drillKelasExpanded = new Set();   // class_id yang ter-expand
let _drillKelasData     = new Map();   // class_id → candidates[] (cache)
let _drillJurusanCount  = new Map();   // program_id → fetched total count
let _drillKelasCount    = new Map();   // class_id   → fetched total count

// Piket drill-down state
let _drillPiketExpanded  = new Set();  // dayOfWeek yang ter-expand
let _drillPiketHariAll   = new Set();  // dayOfWeek semua dipilih
let _drillPiketIndividu  = new Map();  // user_id → candidate
let _drillPiketHariData  = new Map();  // dayOfWeek → candidates[] (cache)
let _drillPiketHariCount = new Map();  // dayOfWeek → fetched count

let _drillWaliExpanded = new Set();    // grade_level yang ter-expand
let _drillWaliGradeAll = new Set();    // grade_level yang semua dipilih
let _drillWaliSelected = new Map();    // user_id → candidate (individu)
let _waliKelasCache    = null;         // Map<class_name, candidate> (cache per buka)

// ─── Init ─────────────────────────────────────────────────────
async function initForumTab() {
    if (_forumTabInit) { await loadForumPosts(); return; }
    _forumTabInit = true;

    // Ambil scope user (role, jabatan, dll)
    const { data: scope } = await supabase
        .rpc('fn_get_user_forum_scope', { p_user_id: currentUser.user_id })
        .maybeSingle();
    _forumScope = scope;

    // Ambil program dan kelas untuk filter
    const [progRes, classRes] = await Promise.all([
        supabase.from('programs').select('program_id, name').eq('is_active', true)
            .eq('school_id', currentUser.school_id).order('name'),
        supabase.from('classes').select('class_id, name, grade_level, program_id')
            .eq('is_active', true).eq('school_id', currentUser.school_id).order('name'),
    ]);
    _forumPrograms = progRes.data ?? [];
    _forumClasses  = classRes.data ?? [];

    // Isi dropdown filter jurusan dan kelas di modal
    const selJur = document.getElementById('forum-filter-jurusan');
    _forumPrograms.forEach(p => {
        selJur.insertAdjacentHTML('beforeend',
            `<option value="${p.program_id}">${esc(p.name)}</option>`);
    });
    const selKls = document.getElementById('forum-filter-kelas');
    _forumClasses.forEach(c => {
        selKls.insertAdjacentHTML('beforeend',
            `<option value="${c.class_id}">${esc(c.name)}</option>`);
    });

    // Sub-tab buttons
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
    document.getElementById('btn-forum-buat').addEventListener('click', () => openForumModal());

    // Modal buat/edit
    document.getElementById('btn-forum-modal-batal').addEventListener('click', closeForumModal);
    document.getElementById('modal-forum-post').addEventListener('click', e => {
        if (e.target === e.currentTarget) closeForumModal();
    });
    document.getElementById('btn-forum-modal-simpan').addEventListener('click', submitForumPost);

    // Modal detail
    document.getElementById('btn-forum-detail-close').addEventListener('click', closeForumDetail);
    document.getElementById('modal-forum-detail').addEventListener('click', e => {
        if (e.target === e.currentTarget) closeForumDetail();
    });
    document.getElementById('btn-forum-comment-submit').addEventListener('click', submitForumComment);
    document.getElementById('btn-forum-edit').addEventListener('click', () => {
        const postId = document.getElementById('modal-forum-detail').dataset.postId;
        openForumModal(postId);
    });
    document.getElementById('btn-forum-delete').addEventListener('click', async () => {
        const postId = document.getElementById('modal-forum-detail').dataset.postId;
        if (!confirm('Hapus posting ini? Tindakan tidak dapat dibatalkan.')) return;
        try {
            await deleteForumSekolahPost(postId);
            closeForumDetail();
            loadForumPosts();
        } catch (err) { alert(fe(err)); }
    });

    // Load more
    document.getElementById('btn-forum-load-more').addEventListener('click', () => loadForumPosts(true));

    await loadForumPosts();
}

// ─── Load Posts ───────────────────────────────────────────────
async function loadForumPosts(append = false) {
    const loadingEl = document.getElementById('forum-loading');
    const listEl    = document.getElementById('forum-posts-list');
    const moreBtn   = document.getElementById('btn-forum-load-more');
    const LIMIT = 20;

    if (!append) {
        _forumOffset = 0;
        listEl.innerHTML = '';
        loadingEl.textContent = 'Memuat forum\u2026';
        loadingEl.style.display = 'block';
    }
    moreBtn.style.display = 'none';

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
        if (!posts.length && !append) {
            listEl.innerHTML = '<p class="hint">Belum ada posting.</p>';
            return;
        }
        listEl.insertAdjacentHTML('beforeend', posts.map(renderForumPostCard).join(''));
        _forumOffset += posts.length;
        _forumHasMore = posts.length === LIMIT;
        moreBtn.style.display = _forumHasMore ? 'inline-block' : 'none';
        wireForumCards();
    } catch (err) {
        loadingEl.textContent = fe(err);
        loadingEl.style.display = 'block';
    }
}

// ─── Render Card ─────────────────────────────────────────────
function renderForumPostCard(post) {
    const time    = new Date(post.created_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
    const author  = esc(post.author?.full_name ?? '\u2014');
    const cmtCnt  = post.comments?.length ?? 0;
    const ackCnt  = post.acknowledgements?.length ?? 0;
    const hasFile = !!post.attachment_url;
    const edited  = post.is_edited ? ' <span class="hint">(diedit)</span>' : '';

    return `
    <div class="section-card forum-post-card" data-post-id="${post.post_id}" style="cursor:pointer;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
            <strong>${esc(post.title)}${edited}</strong>
            <span class="hint" style="white-space:nowrap;font-size:12px">${time}</span>
        </div>
        <p class="hint" style="margin:4px 0 8px">${author}</p>
        <p style="margin:0 0 8px;white-space:pre-wrap;font-size:14px">${esc(post.body).substring(0, 200)}${post.body.length > 200 ? '\u2026' : ''}</p>
        <div style="display:flex;gap:12px;font-size:12px;color:var(--color-muted)">
            ${hasFile ? '<span>\uD83D\uDCCE Lampiran</span>' : ''}
            <span>\uD83D\uDCAC ${cmtCnt} komentar</span>
            <span>\u2713 ${ackCnt} dibaca</span>
        </div>
    </div>`;
}

function wireForumCards() {
    document.querySelectorAll('.forum-post-card').forEach(card => {
        card.addEventListener('click', () => openForumDetail(card.dataset.postId));
    });
}

// ─── Modal Buat/Edit ─────────────────────────────────────────
function openForumModal(postId = null) {
    _forumEditPostId = postId;
    _forumRecipients.clear();
    _forumGroupLabels.clear();
    _forumGroupBtns.clear();
    _forumGroupUids.clear();
    renderRecipientChips();

    const modal = document.getElementById('modal-forum-post');
    document.getElementById('modal-forum-title').textContent = postId ? 'Edit Posting' : 'Buat Posting';
    document.getElementById('forum-input-title').value = '';
    document.getElementById('forum-input-body').value  = '';
    document.getElementById('forum-input-file').value  = '';
    document.getElementById('forum-file-name').textContent = '';
    document.getElementById('forum-post-error').style.display = 'none';

    document.getElementById('forum-filter-jurusan-wrap').style.display = 'none';
    document.getElementById('forum-filter-kelas-wrap').style.display   = 'none';
    document.getElementById('forum-filter-hari-wrap').style.display    = 'none';
    buildRecipientGroupButtons();
    modal.style.display = 'flex';
}

function closeForumModal() {
    document.getElementById('modal-forum-post').style.display = 'none';
    _forumEditPostId = null;
    _forumRecipients.clear();
    _forumGroupLabels.clear();
    _forumGroupBtns.clear();
    _forumGroupUids.clear();
}

// ─── Tombol Grup Penerima ─────────────────────────────────────
const GROUP_LABELS = {
    SEMUA_WAKA:          'Semua Waka dipilih',
    SEMUA_KAPRODI:       'Semua Kaprodi dipilih',
    SEMUA_GURU:          'Semua Guru dipilih',
    GURU_MAPEL:          'Semua Guru dipilih',
    SEMUA_WALI_KELAS:    'Semua Wali Kelas dipilih',
    WALI_KELAS_JURUSAN:  'Semua Wali Kelas Jurusan dipilih',
    SEMUA_GURU_WALI:     'Semua Guru Wali dipilih',
    SEMUA_BK:            'Semua Guru BK dipilih',
    GURU_PIKET:          'Semua Guru Piket dipilih',
    SEMUA_SISWA:         'Semua Siswa dipilih',
    SISWA_KELAS:         'Siswa Semua Kelas dipilih',
    SISWA_JURUSAN:       'Siswa Semua Jurusan dipilih',
    SEMUA_ORTU:          'Semua Ortu dipilih',
    ORTU_KELAS:          'Ortu Semua Kelas dipilih',
    ORTU_JURUSAN:        'Ortu Semua Jurusan dipilih',
    SEMUA_TU:            'Semua TU/Admin dipilih',
    KEPSEK:              'Kepsek dipilih',
};

// ─── Panel Penerima — State Picker ────────────────────────────
let _pickerGroupDef   = null;
let _pickerCandidates = [];
let _pickerSelected   = new Map();

// ─── Bangun Tombol Grup Penerima ─────────────────────────────
function buildRecipientGroupButtons() {
    const scope = _forumScope;
    const container = document.getElementById('forum-recipient-group-btns');
    container.innerHTML = '';
    container.style.cssText = 'display:flex;flex-wrap:wrap;align-items:flex-start;';

    const isKepsek  = scope?.is_kepsek || scope?.role_type === 'KEPSEK';
    const isWaka    = scope?.is_waka_kurikulum || scope?.is_waka_kesiswaan
                   || scope?.is_waka_humas
                   || ['WAKA_KURIKULUM','WAKA_KESISWAAN','WAKA_HUMAS'].includes(scope?.role_type);
    const isKaprodi = !!scope?.kaprodi_program_id || scope?.role_type === 'KAPRODI';
    const isTU      = scope?.role_type === 'TU';
    const isAdmin   = scope?.role_type === 'ADMINISTRATIVE';

    let groups = [];

    if (isKepsek || isWaka || isAdmin) {
        // Bug #7: tambah Guru Wali
        groups = [
            { label: 'Guru',          group: 'SEMUA_GURU',       hasIndividual: true, pickerGroup: 'GURU_MAPEL' },
            { label: 'Waka',          group: 'SEMUA_WAKA',       hasIndividual: true, needsJabatan: true },
            { label: 'Kaprodi',       group: 'SEMUA_KAPRODI',    hasIndividual: true },
            { label: 'Wali Kelas',    group: 'SEMUA_WALI_KELAS', hasIndividual: true, isDrillDownWaliKelas: true, labelSemua: 'Semua Wali Kelas'    },
            { label: 'Guru Wali',     group: 'SEMUA_GURU_WALI',  hasIndividual: true  },
            { label: 'Guru BK',       group: 'SEMUA_BK',         hasIndividual: true  },
            { label: 'Guru Piket',    group: 'GURU_PIKET',       hasIndividual: true, isDrillDownPiket: true },
            { label: 'Semua Siswa',   group: 'SEMUA_SISWA',      hasIndividual: false, labelSemua: 'Semua Siswa' },
            { label: 'Semua Ortu',    group: 'SEMUA_ORTU',       hasIndividual: false, labelSemua: 'Semua Ortu'  },
            { label: 'Siswa tertentu', group: 'SISWA_DRILL', isDrillDown: true, labelSemua: 'Siswa tertentu' },
            { label: 'Ortu tertentu',  group: 'ORTU_DRILL',  isDrillDown: true, labelSemua: 'Ortu tertentu'  },
            { label: 'TU / Admin',    group: 'SEMUA_TU',         hasIndividual: true  },
            ...(isKepsek ? [] : [{ label: 'Kepsek', group: 'KEPSEK', hasIndividual: false, labelSemua: 'Kepsek' }]),
        ];
    } else if (isKaprodi) {
        // Bug #3: Guru Jurusan pakai GURU_MAPEL (bukan SEMUA_GURU) agar filter programId efektif
        // Bug #4: tambah grup Kaprodi (sesama kaprodi)
        // Bug #7: tambah Guru Wali dan Siswa Kelas, Ortu Kelas
        groups = [
            { label: 'Guru Jurusan',     group: 'GURU_MAPEL',          hasIndividual: true, programId: scope.kaprodi_program_id },
            { label: 'Wali Kls Jurusan', group: 'WALI_KELAS_JURUSAN',  hasIndividual: true, labelSemua: 'Semua Wali Kelas Jurusan' },
            { label: 'Guru Wali',        group: 'SEMUA_GURU_WALI',     hasIndividual: true  },
            { label: 'Guru BK',          group: 'SEMUA_BK',            hasIndividual: true  },
            { label: 'Kaprodi',          group: 'SEMUA_KAPRODI',       hasIndividual: true },
            { label: 'Kepsek',           group: 'KEPSEK',              hasIndividual: false, labelSemua: 'Kepsek' },
            { label: 'Waka',             group: 'SEMUA_WAKA',          hasIndividual: true, needsJabatan: true },
            { label: 'Siswa tertentu', group: 'SISWA_DRILL', isDrillDown: true, labelSemua: 'Siswa tertentu' },
            { label: 'Ortu tertentu',  group: 'ORTU_DRILL',  isDrillDown: true, labelSemua: 'Ortu tertentu'  },
            { label: 'TU / Admin',       group: 'SEMUA_TU',            hasIndividual: true  },
        ];
    } else {
        // Bug #5: tambah Semua Siswa
        // Bug #7: tambah Guru Wali
        groups = [
            { label: 'Kepsek',        group: 'KEPSEK',           hasIndividual: false, labelSemua: 'Kepsek' },
            { label: 'Waka',          group: 'SEMUA_WAKA',       hasIndividual: true, needsJabatan: true },
            { label: 'Kaprodi',       group: 'SEMUA_KAPRODI',    hasIndividual: true },
            { label: 'Guru',          group: 'SEMUA_GURU',       hasIndividual: true, pickerGroup: 'GURU_MAPEL' },
            { label: 'Wali Kelas',    group: 'SEMUA_WALI_KELAS', hasIndividual: true, isDrillDownWaliKelas: true, labelSemua: 'Semua Wali Kelas'    },
            { label: 'Guru Wali',     group: 'SEMUA_GURU_WALI',  hasIndividual: true  },
            { label: 'Guru BK',       group: 'SEMUA_BK',         hasIndividual: true  },
            { label: 'Guru Piket',    group: 'GURU_PIKET',       hasIndividual: true, isDrillDownPiket: true },
            { label: 'Semua Siswa',   group: 'SEMUA_SISWA',      hasIndividual: false, labelSemua: 'Semua Siswa' },
            { label: 'Semua Ortu',    group: 'SEMUA_ORTU',       hasIndividual: false, labelSemua: 'Semua Ortu'  },
            { label: 'Siswa tertentu', group: 'SISWA_DRILL', isDrillDown: true, labelSemua: 'Siswa tertentu' },
            { label: 'Ortu tertentu',  group: 'ORTU_DRILL',  isDrillDown: true, labelSemua: 'Ortu tertentu'  },
            { label: 'TU / Admin',    group: 'SEMUA_TU',         hasIndividual: true  },
        ];
    }

    const rendered = new Set();
    groups.forEach(g => {
        if (rendered.has(g.group)) return;

        if (g.isDrillDown || g.isDrillDownPiket || g.isDrillDownWaliKelas) {
            const isPickOnly = g.isDrillDown;
            if (isPickOnly) {
                const wrap = document.createElement('div');
                wrap.style.cssText = 'display:flex;width:100%;gap:4px;margin-bottom:6px';
                const btn = document.createElement('button');
                btn.className = 'btn btn-secondary';
                btn.style.cssText = 'flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:clamp(11px,2.5vw,14px)';
                btn.textContent = g.labelSemua ?? g.label;
                btn.addEventListener('click', () => addRecipientGroup(g, btn));
                wrap.appendChild(btn);
                container.appendChild(wrap);
                return;
            }
            // isDrillDownPiket / isDrillDownWaliKelas → tetap render via path hasIndividual di bawah
        }

        // SEMUA_SISWA + SEMUA_ORTU → satu baris berdampingan
        if (g.group === 'SEMUA_SISWA') {
            const ortu = groups.find(x => x.group === 'SEMUA_ORTU');
            if (ortu) {
                rendered.add('SEMUA_ORTU');
                const wrap = document.createElement('div');
                wrap.style.cssText = 'display:flex;width:100%;gap:4px;margin-bottom:6px';
                [g, ortu].forEach(entry => {
                    const btn = document.createElement('button');
                    btn.className = 'btn btn-secondary';
                    btn.style.cssText = 'flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:clamp(11px,2.5vw,14px)';
                    btn.textContent = entry.labelSemua ?? `Semua ${entry.label}`;
                    btn.addEventListener('click', () => addRecipientGroup({ ...entry, mode: 'semua' }, btn));
                    wrap.appendChild(btn);
                });
                container.appendChild(wrap);
                return;
            }
        }

        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;width:100%;gap:4px;margin-bottom:6px';

        const btnAll = document.createElement('button');
        btnAll.className = 'btn btn-secondary';
        btnAll.style.cssText = g.hasIndividual
            ? 'flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:clamp(11px,2.5vw,14px);border-radius:6px 0 0 6px'
            : 'width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:clamp(11px,2.5vw,14px)';
        btnAll.textContent = g.labelSemua ?? `Semua ${g.label}`;
        btnAll.addEventListener('click', () => addRecipientGroup({ ...g, mode: 'semua' }, btnAll));
        wrap.appendChild(btnAll);

        if (g.hasIndividual) {
            const btnPick = document.createElement('button');
            btnPick.className = 'btn btn-secondary';
            btnPick.style.cssText = 'flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:clamp(11px,2.5vw,14px);border-radius:0 6px 6px 0;border-left:1px solid var(--color-border)';
            btnPick.textContent = `${g.label} tertentu`;
            btnPick.addEventListener('click', () => addRecipientGroup({ ...g, mode: 'tertentu' }, btnPick));
            wrap.appendChild(btnPick);
        }

        container.appendChild(wrap);
    });
}

// ─── Tambah Grup Penerima ─────────────────────────────────────
async function addRecipientGroup(groupDef, btnEl = null) {
    const errEl = document.getElementById('forum-post-error');
    errEl.style.display = 'none';
    document.getElementById('forum-filter-jurusan-wrap').style.display = 'none';
    document.getElementById('forum-filter-kelas-wrap').style.display   = 'none';
    document.getElementById('forum-filter-hari-wrap').style.display    = 'none';

    if (groupDef.isDrillDown) {
        openDrillDownPicker(groupDef.group, btnEl);
        return;
    }
    if (groupDef.isDrillDownPiket && groupDef.mode === 'tertentu') {
        openDrillDownPiketPicker();
        return;
    }
    if (groupDef.isDrillDownWaliKelas && groupDef.mode === 'tertentu') {
        openDrillDownWaliKelasPicker();
        return;
    }

    // Toggle: klik kedua pada grup yang sudah aktif → batalkan pilihan
    if (groupDef.mode === 'semua' && _forumGroupLabels.has(groupDef.group)) {
        _forumGroupUids.get(groupDef.group)?.forEach(uid => _forumRecipients.delete(uid));
        _forumGroupLabels.delete(groupDef.group);
        _forumGroupUids.delete(groupDef.group);
        if (btnEl) btnEl.className = 'btn btn-secondary';
        _forumGroupBtns.delete(groupDef.group);
        renderRecipientChips();
        return;
    }

    let programId = groupDef.programId ?? null;
    let classId   = null;
    let dayOfWeek = null;

    if (groupDef.needsJurusan && groupDef.mode === 'semua') {
        const wrap = document.getElementById('forum-filter-jurusan-wrap');
        const sel  = document.getElementById('forum-filter-jurusan');
        if (wrap.style.display === 'none' || wrap.style.display === '') {
            wrap.style.display = 'block'; return;
        }
        if (!sel.value) { errEl.textContent = 'Pilih jurusan dulu.'; errEl.style.display = 'block'; return; }
        programId = sel.value;
    }
    if (groupDef.needsKelas && groupDef.mode === 'semua') {
        const wrap = document.getElementById('forum-filter-kelas-wrap');
        const sel  = document.getElementById('forum-filter-kelas');
        if (wrap.style.display === 'none' || wrap.style.display === '') {
            wrap.style.display = 'block'; return;
        }
        if (!sel.value) { errEl.textContent = 'Pilih kelas dulu.'; errEl.style.display = 'block'; return; }
        classId = sel.value;
    }
    if (groupDef.needsHari && groupDef.mode === 'semua') {
        const wrap = document.getElementById('forum-filter-hari-wrap');
        const sel  = document.getElementById('forum-filter-hari');
        if (wrap.style.display === 'none' || wrap.style.display === '') {
            wrap.style.display = 'block'; return;
        }
        if (!sel.value) { errEl.textContent = 'Pilih hari dulu.'; errEl.style.display = 'block'; return; }
        dayOfWeek = parseInt(sel.value, 10);
    }

    if (groupDef.mode === 'semua') {
        try {
            const candidates = await getForumRecipientCandidates(groupDef.group, {
                programId, classId, dayOfWeek,
                academicYear: config.current_academic_year,
            });
            // Jika grup sudah ada, hapus uid lama dulu sebelum re-add
            if (_forumGroupUids.has(groupDef.group)) {
                _forumGroupUids.get(groupDef.group).forEach(uid => _forumRecipients.delete(uid));
                const oldBtn = _forumGroupBtns.get(groupDef.group);
                if (oldBtn) oldBtn.className = 'btn btn-secondary';
            }
            candidates.forEach(c => _forumRecipients.set(c.user_id, c));
            _forumGroupLabels.set(groupDef.group,
                GROUP_LABELS[groupDef.group] ?? `${groupDef.labelSemua ?? 'Semua ' + groupDef.label} dipilih`);
            _forumGroupBtns.set(groupDef.group, btnEl);
            _forumGroupUids.set(groupDef.group, new Set(candidates.map(c => c.user_id)));
            if (btnEl) btnEl.className = 'btn btn-primary';
            renderRecipientChips();
        } catch (err) {
            errEl.textContent = fe(err);
            errEl.style.display = 'block';
        }
    } else {
        await openRecipientPicker({
            ...groupDef,
            group: groupDef.pickerGroup ?? groupDef.group,
        });
    }
}

// ─── Modal Picker ─────────────────────────────────────────────
async function openRecipientPicker(groupDef) {
    _pickerGroupDef   = groupDef;
    _pickerSelected   = new Map();
    _pickerCandidates = [];

    const modal    = document.getElementById('modal-forum-picker');
    const titleEl  = document.getElementById('picker-title');
    const listEl   = document.getElementById('picker-list');
    const errEl    = document.getElementById('picker-error');
    const searchEl = document.getElementById('picker-search');

    titleEl.textContent = `Pilih ${groupDef.label} tertentu`;
    listEl.innerHTML    = '';
    listEl.style.display = 'block';
    document.getElementById('picker-tree').style.display = 'none';
    delete modal.dataset.drillMode;
    searchEl.value      = '';
    errEl.style.display = 'none';

    document.getElementById('picker-filter-jabatan-wrap').style.display =
        groupDef.needsJabatan ? 'block' : 'none';
    document.getElementById('picker-filter-jurusan-wrap').style.display =
        groupDef.needsJurusan ? 'block' : 'none';
    document.getElementById('picker-filter-kelas-wrap').style.display =
        groupDef.needsKelas ? 'block' : 'none';
    document.getElementById('picker-filter-hari-wrap').style.display =
        groupDef.needsHari ? 'block' : 'none';

    const selJurPicker = document.getElementById('picker-filter-jurusan');
    selJurPicker.innerHTML = '<option value="">Semua Jurusan</option>';
    _forumPrograms.forEach(p => {
        selJurPicker.insertAdjacentHTML('beforeend',
            `<option value="${p.program_id}">${esc(p.name)}</option>`);
    });

    const selKlsPicker = document.getElementById('picker-filter-kelas');
    selKlsPicker.innerHTML = '<option value="">Semua Kelas</option>';
    _forumClasses.forEach(c => {
        selKlsPicker.insertAdjacentHTML('beforeend',
            `<option value="${c.class_id}">${esc(c.name)}</option>`);
    });

    modal.style.display = 'flex';
    await loadPickerCandidates();

    _initPickerWiring(modal);
}

async function loadPickerCandidates() {
    const loadEl   = document.getElementById('picker-loading');
    const errEl    = document.getElementById('picker-error');
    const groupDef = _pickerGroupDef;
    if (!groupDef) return;

    let programId = groupDef.programId ?? null;
    let classId   = null;
    let dayOfWeek = null;

    if (groupDef.needsJurusan) {
        programId = document.getElementById('picker-filter-jurusan').value || null;
    }
    if (groupDef.needsKelas) {
        classId = document.getElementById('picker-filter-kelas').value || null;
    }
    if (groupDef.needsHari) {
        const v = document.getElementById('picker-filter-hari').value;
        dayOfWeek = v ? parseInt(v, 10) : null;
    }

    loadEl.style.display = 'block';
    errEl.style.display  = 'none';

    try {
        _pickerCandidates = await getForumRecipientCandidates(groupDef.group, {
            programId, classId, dayOfWeek,
            academicYear: config.current_academic_year,
        });
        renderPickerList();
    } catch (err) {
        errEl.textContent   = fe(err);
        errEl.style.display = 'block';
    } finally {
        loadEl.style.display = 'none';
    }
}

function renderPickerList() {
    const listEl    = document.getElementById('picker-list');
    const searchVal = document.getElementById('picker-search').value.toLowerCase();
    const jabatan   = document.getElementById('picker-filter-jabatan')?.value ?? '';

    let filtered = _pickerCandidates;

    if (searchVal) {
        filtered = filtered.filter(c =>
            c.full_name.toLowerCase().includes(searchVal));
    }

    if (jabatan && _pickerGroupDef?.needsJabatan) {
        filtered = filtered.filter(c => c.role_label === jabatan);
    }

    if (!filtered.length) {
        listEl.innerHTML = '<p class="hint" style="padding:8px">Tidak ada hasil.</p>';
        return;
    }

    listEl.innerHTML = filtered.map(c => {
        const checked = _pickerSelected.has(c.user_id);
        const roleLabel = c.extra_info
            ? `${c.role_label} · ${esc(c.extra_info)}`
            : esc(c.role_label ?? '');
        return `
        <label style="display:flex;align-items:center;gap:8px;padding:8px;
                      cursor:pointer;border-bottom:1px solid var(--color-border)">
            <input type="checkbox" data-uid="${c.user_id}"
                   ${checked ? 'checked' : ''}
                   style="width:16px;height:16px;flex-shrink:0">
            <div>
                <div style="font-size:14px">${esc(c.full_name)}</div>
                <div class="hint" style="font-size:12px">${roleLabel}</div>
            </div>
        </label>`;
    }).join('');

    listEl.querySelectorAll('input[type=checkbox]').forEach(cb => {
        cb.addEventListener('change', () => {
            const uid = cb.dataset.uid;
            const candidate = _pickerCandidates.find(c => c.user_id === uid);
            if (!candidate) return;
            if (cb.checked) {
                _pickerSelected.set(uid, candidate);
            } else {
                _pickerSelected.delete(uid);
            }
        });
    });
}

function closeRecipientPicker() {
    document.getElementById('modal-forum-picker').style.display = 'none';
    _pickerGroupDef   = null;
    _pickerCandidates = [];
}

function _initPickerWiring(modal) {
    if (modal.dataset.wired) return;
    modal.dataset.wired = '1';
    document.getElementById('btn-picker-batal').addEventListener('click', () => {
        if (modal.dataset.drillMode === '1') closeDrillDownPicker();
        else if (modal.dataset.drillMode === 'piket') closeDrillDownPiketPicker();
        else if (modal.dataset.drillMode === 'wali') closeDrillDownWaliKelasPicker();
        else closeRecipientPicker();
    });
    modal.addEventListener('click', e => {
        if (e.target === e.currentTarget) {
            if (modal.dataset.drillMode === '1') closeDrillDownPicker();
            else if (modal.dataset.drillMode === 'piket') closeDrillDownPiketPicker();
            else if (modal.dataset.drillMode === 'wali') closeDrillDownWaliKelasPicker();
            else closeRecipientPicker();
        }
    });
    document.getElementById('picker-search').addEventListener('input', () => {
        if (modal.dataset.drillMode === '1') renderDrillTree();
        else if (modal.dataset.drillMode === 'piket') renderPiketTree();
        else if (modal.dataset.drillMode === 'wali') renderWaliKelasTree();
        else renderPickerList();
    });
    document.getElementById('picker-filter-jabatan').addEventListener('change', loadPickerCandidates);
    document.getElementById('picker-filter-jurusan').addEventListener('change', loadPickerCandidates);
    document.getElementById('picker-filter-kelas').addEventListener('change', loadPickerCandidates);
    document.getElementById('picker-filter-hari').addEventListener('change', loadPickerCandidates);
    document.getElementById('btn-picker-tambahkan').addEventListener('click', () => {
        if (modal.dataset.drillMode === '1') {
            submitDrillDown();
        } else if (modal.dataset.drillMode === 'piket') {
            submitDrillDownPiket();
        } else if (modal.dataset.drillMode === 'wali') {
            submitWaliKelasDrillDown();
        } else {
            _pickerSelected.forEach((c, uid) => _forumRecipients.set(uid, c));
            renderRecipientChips();
            closeRecipientPicker();
        }
    });
}

// ─── Drill-down Picker (SISWA_DRILL / ORTU_DRILL) ─────────────
function openDrillDownPicker(drillType) {
    _drillType = drillType;
    _drillExpanded.clear();
    _drillJurusanAll.clear();
    _drillKelasAll.clear();
    _drillIndividu.clear();
    _drillKelasExpanded.clear();
    _drillKelasData.clear();
    _drillJurusanCount.clear();
    _drillKelasCount.clear();

    const modal = document.getElementById('modal-forum-picker');
    modal.dataset.drillMode = '1';
    modal.style.display = 'flex';

    document.getElementById('picker-title').textContent =
        drillType === 'SISWA_DRILL' ? 'Pilih Siswa Tertentu' : 'Pilih Orang Tua Tertentu';
    document.getElementById('picker-search').value = '';
    document.getElementById('picker-list').style.display = 'none';
    document.getElementById('picker-loading').style.display = 'none';
    document.getElementById('picker-error').style.display = 'none';
    ['picker-filter-jabatan-wrap','picker-filter-jurusan-wrap',
     'picker-filter-kelas-wrap','picker-filter-hari-wrap'].forEach(id => {
        document.getElementById(id).style.display = 'none';
    });

    _initPickerWiring(modal);
    renderDrillTree();
}

function renderDrillTree() {
    const tree       = document.getElementById('picker-tree');
    const searchText = (document.getElementById('picker-search')?.value ?? '').toLowerCase().trim();
    tree.style.display = 'block';
    tree.innerHTML = '';

    if (_forumPrograms.length === 0) {
        tree.textContent = 'Tidak ada data jurusan.';
        return;
    }

    _forumPrograms.forEach(prog => {
        const expanded = _drillExpanded.has(prog.program_id);
        const jurAll     = _drillJurusanAll.has(prog.program_id);
        const jurClasses = _forumClasses.filter(c => c.program_id === prog.program_id);
        const indCnt     = [..._drillIndividu.values()].filter(c => c._programId === prog.program_id).length;
        let selCount;
        if (jurAll) {
            selCount = _drillJurusanCount.has(prog.program_id)
                ? _drillJurusanCount.get(prog.program_id)
                : jurClasses.reduce((s, c) => s + (_drillKelasData.get(c.class_id)?.length ?? 0), 0);
        } else {
            const klsTotalCnt = jurClasses.reduce((s, c) => {
                if (!_drillKelasAll.has(c.class_id)) return s;
                return s + (_drillKelasCount.has(c.class_id)
                    ? _drillKelasCount.get(c.class_id)
                    : (_drillKelasData.get(c.class_id)?.length ?? 0));
            }, 0);
            selCount = klsTotalCnt + indCnt;
        }

        const node = document.createElement('div');
        node.style.cssText = 'border-bottom:1px solid var(--color-border)';

        const hdr = document.createElement('div');
        hdr.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:pointer;user-select:none';
        const arrow = document.createElement('span');
        arrow.style.cssText = 'font-size:10px;color:var(--color-muted);min-width:12px';
        arrow.textContent = expanded ? '▼' : '▶';
        const lbl = document.createElement('span');
        lbl.style.cssText = 'flex:1;font-weight:500';
        lbl.textContent = prog.name;
        const badge = document.createElement('span');
        badge.style.cssText = 'font-size:11px;color:var(--color-primary);font-weight:500';
        badge.textContent = selCount > 0 ? `${selCount} dipilih` : '';
        hdr.append(arrow, lbl, badge);
        hdr.addEventListener('click', () => {
            if (_drillExpanded.has(prog.program_id)) _drillExpanded.delete(prog.program_id);
            else _drillExpanded.add(prog.program_id);
            renderDrillTree();
        });
        node.appendChild(hdr);

        if (expanded) {
            const sub = document.createElement('div');
            sub.style.cssText = 'padding-left:16px;padding-bottom:8px';

            // Checkbox "Semua [jurusan]"
            const jurRow = document.createElement('label');
            jurRow.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 4px;cursor:pointer';
            const jurCb = document.createElement('input');
            jurCb.type    = 'checkbox';
            jurCb.checked = jurAll;
            jurCb.addEventListener('change', async () => {
                if (jurCb.checked) {
                    _drillJurusanAll.add(prog.program_id);
                    _forumClasses.filter(c => c.program_id === prog.program_id)
                        .forEach(c => _drillKelasAll.delete(c.class_id));
                    for (const [uid, c] of _drillIndividu.entries()) {
                        if (c._programId === prog.program_id) _drillIndividu.delete(uid);
                    }
                    renderDrillTree();
                    if (!_drillJurusanCount.has(prog.program_id)) {
                        try {
                            const tJur = _drillType === 'SISWA_DRILL' ? 'SISWA_PER_JURUSAN' : 'ORTU_PER_JURUSAN';
                            const list = await getForumRecipientCandidates(tJur, {
                                programId: prog.program_id, academicYear: config.current_academic_year,
                            });
                            _drillJurusanCount.set(prog.program_id, list.length);
                        } catch (_) {
                            _drillJurusanCount.set(prog.program_id, 0);
                        }
                        renderDrillTree();
                    }
                } else {
                    _drillJurusanAll.delete(prog.program_id);
                    renderDrillTree();
                }
            });
            const jurLbl = document.createElement('span');
            jurLbl.style.cssText = 'font-size:13px';
            jurLbl.textContent = `Semua ${prog.name}`;
            jurRow.append(jurCb, jurLbl);
            sub.appendChild(jurRow);

            // Kelas — masing-masing collapsed by default
            _forumClasses.filter(c => c.program_id === prog.program_id).forEach(cls => {
                const klsExpanded = _drillKelasExpanded.has(cls.class_id);
                const klsAll      = _drillKelasAll.has(cls.class_id);
                const klsData     = _drillKelasData.get(cls.class_id);
                const iCnt        = [..._drillIndividu.values()].filter(c => c._classId === cls.class_id).length;
                const klsSelCnt   = (jurAll || klsAll)
                    ? (_drillKelasCount.has(cls.class_id)
                        ? _drillKelasCount.get(cls.class_id)
                        : (klsData?.length ?? 0))
                    : iCnt;

                const klsNode = document.createElement('div');
                klsNode.style.cssText = 'margin-left:4px';

                const klsHdr = document.createElement('div');
                klsHdr.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 6px;cursor:pointer;user-select:none;border-radius:4px';
                const klsArrow = document.createElement('span');
                klsArrow.style.cssText = 'font-size:9px;color:var(--color-muted);min-width:10px';
                klsArrow.textContent = klsExpanded ? '▼' : '▶';
                const klsLbl = document.createElement('span');
                klsLbl.style.cssText = 'flex:1;font-size:13px';
                klsLbl.textContent = cls.name;
                const klsBadge = document.createElement('span');
                klsBadge.style.cssText = 'font-size:11px;color:var(--color-primary)';
                klsBadge.textContent = klsSelCnt > 0 ? `${klsSelCnt} dipilih` : '';
                klsHdr.append(klsArrow, klsLbl, klsBadge);
                klsHdr.addEventListener('click', () => _toggleDrillKelas(cls.class_id, cls.name, prog.program_id));
                klsNode.appendChild(klsHdr);

                if (klsExpanded) {
                    const klsSub = document.createElement('div');
                    klsSub.style.cssText = 'padding-left:20px;padding-bottom:4px';

                    if (!klsData) {
                        klsSub.innerHTML = '<span style="font-size:12px;color:var(--color-muted)">Memuat…</span>';
                    } else {
                        // Checkbox "Semua [kelas]"
                        const klsAllRow = document.createElement('label');
                        klsAllRow.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer';
                        const klsAllCb = document.createElement('input');
                        klsAllCb.type     = 'checkbox';
                        klsAllCb.checked  = klsAll || jurAll;
                        klsAllCb.disabled = jurAll;
                        klsAllCb.addEventListener('change', async () => {
                            if (klsAllCb.checked) {
                                _drillKelasAll.add(cls.class_id);
                                for (const [uid, c] of _drillIndividu.entries()) {
                                    if (c._classId === cls.class_id) _drillIndividu.delete(uid);
                                }
                                renderDrillTree();
                                if (!_drillKelasCount.has(cls.class_id) && !_drillKelasData.has(cls.class_id)) {
                                    try {
                                        const tKls = _drillType === 'SISWA_DRILL' ? 'SISWA_PER_KELAS' : 'ORTU_PER_KELAS';
                                        const list = await getForumRecipientCandidates(tKls, {
                                            classId: cls.class_id, academicYear: config.current_academic_year,
                                        });
                                        _drillKelasCount.set(cls.class_id, list.length);
                                    } catch (_) {
                                        _drillKelasCount.set(cls.class_id, 0);
                                    }
                                    renderDrillTree();
                                }
                            } else {
                                _drillKelasAll.delete(cls.class_id);
                                renderDrillTree();
                            }
                        });
                        const klsAllLbl = document.createElement('span');
                        klsAllLbl.style.cssText = 'font-size:12px;font-weight:500';
                        klsAllLbl.textContent = `Semua ${cls.name}`;
                        klsAllRow.append(klsAllCb, klsAllLbl);
                        klsSub.appendChild(klsAllRow);

                        // Individu — filter by search
                        const filtered = searchText
                            ? klsData.filter(c => c.full_name.toLowerCase().includes(searchText))
                            : klsData;
                        filtered.forEach(c => {
                            const row = document.createElement('label');
                            row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:3px 0;cursor:pointer';
                            const cb = document.createElement('input');
                            cb.type     = 'checkbox';
                            cb.checked  = jurAll || klsAll || _drillIndividu.has(c.user_id);
                            cb.disabled = jurAll || klsAll;
                            cb.addEventListener('change', () => {
                                if (cb.checked) _drillIndividu.set(c.user_id, c);
                                else _drillIndividu.delete(c.user_id);
                                renderDrillTree();
                            });
                            row.append(cb, document.createTextNode(c.full_name));
                            klsSub.appendChild(row);
                        });
                        if (filtered.length === 0 && searchText) {
                            klsSub.insertAdjacentHTML('beforeend',
                                '<p style="font-size:12px;color:var(--color-muted);padding:4px 0">Tidak ada hasil pencarian</p>');
                        }
                    }
                    klsNode.appendChild(klsSub);
                }
                sub.appendChild(klsNode);
            });

            node.appendChild(sub);
        }
        tree.appendChild(node);
    });
}

async function _toggleDrillKelas(classId, className, programId) {
    if (_drillKelasExpanded.has(classId)) {
        _drillKelasExpanded.delete(classId);
        renderDrillTree();
        return;
    }
    _drillKelasExpanded.add(classId);
    renderDrillTree(); // tampil "Memuat…" dulu
    if (!_drillKelasData.has(classId)) {
        const targetGroup = _drillType === 'SISWA_DRILL' ? 'SISWA_PER_KELAS' : 'ORTU_PER_KELAS';
        try {
            const candidates = await getForumRecipientCandidates(targetGroup, {
                classId,
                academicYear: config.current_academic_year,
            });
            candidates.forEach(c => { c._classId = classId; c._programId = programId; });
            _drillKelasData.set(classId, candidates);
        } catch (_) {
            _drillKelasData.set(classId, []);
        }
        renderDrillTree();
    }
}

async function submitDrillDown() {
    const acYear = config.current_academic_year;
    const tJur   = _drillType === 'SISWA_DRILL' ? 'SISWA_PER_JURUSAN' : 'ORTU_PER_JURUSAN';
    const tKls   = _drillType === 'SISWA_DRILL' ? 'SISWA_PER_KELAS'   : 'ORTU_PER_KELAS';
    const loadEl = document.getElementById('picker-loading');
    const errEl  = document.getElementById('picker-error');
    loadEl.style.display = 'block';
    errEl.style.display  = 'none';

    try {
        for (const programId of _drillJurusanAll) {
            const prog = _forumPrograms.find(p => p.program_id === programId);
            const list = await getForumRecipientCandidates(tJur, { programId, academicYear: acYear });
            const key  = `${_drillType}_JUR_${programId}`;
            list.forEach(c => _forumRecipients.set(c.user_id, c));
            _forumGroupLabels.set(key, `${prog?.name ?? 'Jurusan'} (semua)`);
            _forumGroupUids.set(key, new Set(list.map(c => c.user_id)));
        }
        for (const classId of _drillKelasAll) {
            const cls  = _forumClasses.find(c => c.class_id === classId);
            const list = await getForumRecipientCandidates(tKls, { classId, academicYear: acYear });
            const key  = `${_drillType}_KLS_${classId}`;
            list.forEach(c => _forumRecipients.set(c.user_id, c));
            _forumGroupLabels.set(key, `${cls?.name ?? 'Kelas'} (semua)`);
            _forumGroupUids.set(key, new Set(list.map(c => c.user_id)));
        }
        if (_drillIndividu.size > 0) {
            const key = `${_drillType}_INDIVIDU_${Date.now()}`;
            _drillIndividu.forEach((c, uid) => _forumRecipients.set(uid, c));
            _forumGroupLabels.set(key, `${_drillType === 'SISWA_DRILL' ? 'Siswa' : 'Ortu'} pilihan`);
            _forumGroupUids.set(key, new Set(_drillIndividu.keys()));
        }
        renderRecipientChips();
        closeDrillDownPicker();
    } catch (err) {
        loadEl.style.display = 'none';
        errEl.textContent    = fe(err);
        errEl.style.display  = 'block';
    }
}

function closeDrillDownPicker() {
    const modal = document.getElementById('modal-forum-picker');
    modal.style.display = 'none';
    delete modal.dataset.drillMode;
    document.getElementById('picker-tree').style.display = 'none';
    document.getElementById('picker-list').innerHTML     = '';
    _drillType = null;
    _drillExpanded.clear();
}

// ─── Drill-down Picker Piket ──────────────────────────────────
const _PIKET_HARI = ['Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];

function openDrillDownPiketPicker() {
    _drillPiketExpanded.clear();
    _drillPiketHariAll.clear();
    _drillPiketIndividu.clear();
    _drillPiketHariData.clear();
    _drillPiketHariCount.clear();

    const modal = document.getElementById('modal-forum-picker');
    modal.dataset.drillMode = 'piket';
    modal.style.display = 'flex';

    document.getElementById('picker-title').textContent = 'Pilih Guru Piket Tertentu';
    document.getElementById('picker-search').value = '';
    document.getElementById('picker-list').style.display = 'none';
    document.getElementById('picker-loading').style.display = 'none';
    document.getElementById('picker-error').style.display = 'none';
    ['picker-filter-jabatan-wrap','picker-filter-jurusan-wrap',
     'picker-filter-kelas-wrap','picker-filter-hari-wrap'].forEach(id => {
        document.getElementById(id).style.display = 'none';
    });
    _initPickerWiring(modal);
    renderPiketTree();
}

function renderPiketTree() {
    const tree = document.getElementById('picker-tree');
    tree.style.display = 'block';
    tree.innerHTML = '';

    _PIKET_HARI.forEach((hariNama, idx) => {
        const day      = idx + 1;
        const expanded = _drillPiketExpanded.has(day);
        const hariAll  = _drillPiketHariAll.has(day);
        const hariData = _drillPiketHariData.get(day);
        const iCnt     = [..._drillPiketIndividu.values()].filter(c => c._dayOfWeek === day).length;
        const selCount = hariAll
            ? (_drillPiketHariCount.has(day) ? _drillPiketHariCount.get(day) : (hariData?.length ?? 0))
            : iCnt;

        const node = document.createElement('div');
        node.style.cssText = 'border-bottom:1px solid var(--color-border)';

        const hdr = document.createElement('div');
        hdr.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:pointer;user-select:none';
        const arrow = document.createElement('span');
        arrow.style.cssText = 'font-size:10px;color:var(--color-muted);min-width:12px';
        arrow.textContent = expanded ? '▼' : '▶';
        const lbl = document.createElement('span');
        lbl.style.cssText = 'flex:1;font-weight:500';
        lbl.textContent = hariNama;
        const badge = document.createElement('span');
        badge.style.cssText = 'font-size:11px;color:var(--color-primary);font-weight:500';
        badge.textContent = selCount > 0 ? `${selCount} dipilih` : '';
        hdr.append(arrow, lbl, badge);
        hdr.addEventListener('click', () => _togglePiketHari(day));
        node.appendChild(hdr);

        if (expanded) {
            const sub = document.createElement('div');
            sub.style.cssText = 'padding-left:20px;padding-bottom:8px';

            if (!hariData) {
                sub.innerHTML = '<span style="font-size:12px;color:var(--color-muted)">Memuat…</span>';
            } else {
                // Checkbox "Semua Guru Piket [Hari]"
                const allRow = document.createElement('label');
                allRow.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer';
                const allCb = document.createElement('input');
                allCb.type    = 'checkbox';
                allCb.checked = hariAll;
                allCb.addEventListener('change', async () => {
                    if (allCb.checked) {
                        _drillPiketHariAll.add(day);
                        for (const [uid, c] of _drillPiketIndividu.entries()) {
                            if (c._dayOfWeek === day) _drillPiketIndividu.delete(uid);
                        }
                        renderPiketTree();
                        if (!_drillPiketHariCount.has(day)) {
                            try {
                                const list = await getForumRecipientCandidates('GURU_PIKET', {
                                    dayOfWeek: day, academicYear: config.current_academic_year,
                                });
                                list.forEach(c => { c._dayOfWeek = day; });
                                _drillPiketHariCount.set(day, list.length);
                                if (!_drillPiketHariData.has(day)) _drillPiketHariData.set(day, list);
                            } catch (_) {
                                _drillPiketHariCount.set(day, 0);
                            }
                            renderPiketTree();
                        }
                    } else {
                        _drillPiketHariAll.delete(day);
                        renderPiketTree();
                    }
                });
                const allLbl = document.createElement('span');
                allLbl.style.cssText = 'font-size:13px;font-weight:500';
                allLbl.textContent = `Semua Guru Piket ${hariNama}`;
                allRow.append(allCb, allLbl);
                sub.appendChild(allRow);

                // Individu
                hariData.forEach(c => {
                    const row = document.createElement('label');
                    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:3px 0;cursor:pointer';
                    const cb = document.createElement('input');
                    cb.type     = 'checkbox';
                    cb.checked  = hariAll || _drillPiketIndividu.has(c.user_id);
                    cb.disabled = hariAll;
                    cb.addEventListener('change', () => {
                        if (cb.checked) _drillPiketIndividu.set(c.user_id, c);
                        else _drillPiketIndividu.delete(c.user_id);
                        renderPiketTree();
                    });
                    row.append(cb, document.createTextNode(c.full_name));
                    sub.appendChild(row);
                });
            }
            node.appendChild(sub);
        }
        tree.appendChild(node);
    });
}

async function _togglePiketHari(day) {
    if (_drillPiketExpanded.has(day)) {
        _drillPiketExpanded.delete(day);
        renderPiketTree();
        return;
    }
    _drillPiketExpanded.add(day);
    renderPiketTree();
    if (!_drillPiketHariData.has(day)) {
        try {
            const list = await getForumRecipientCandidates('GURU_PIKET', {
                dayOfWeek: day, academicYear: config.current_academic_year,
            });
            list.forEach(c => { c._dayOfWeek = day; });
            _drillPiketHariData.set(day, list);
        } catch (_) {
            _drillPiketHariData.set(day, []);
        }
        renderPiketTree();
    }
}

async function submitDrillDownPiket() {
    const loadEl = document.getElementById('picker-loading');
    const errEl  = document.getElementById('picker-error');
    loadEl.style.display = 'block';
    errEl.style.display  = 'none';

    try {
        for (const day of _drillPiketHariAll) {
            let list = _drillPiketHariData.get(day);
            if (!list) {
                list = await getForumRecipientCandidates('GURU_PIKET', {
                    dayOfWeek: day, academicYear: config.current_academic_year,
                });
                list.forEach(c => { c._dayOfWeek = day; });
            }
            const key = `GURU_PIKET_${day}`;
            list.forEach(c => _forumRecipients.set(c.user_id, c));
            _forumGroupLabels.set(key, `Guru Piket ${_PIKET_HARI[day - 1]} dipilih`);
            _forumGroupUids.set(key, new Set(list.map(c => c.user_id)));
        }
        if (_drillPiketIndividu.size > 0) {
            const key = `GURU_PIKET_INDIVIDU_${Date.now()}`;
            _drillPiketIndividu.forEach((c, uid) => _forumRecipients.set(uid, c));
            _forumGroupLabels.set(key, 'Guru Piket pilihan');
            _forumGroupUids.set(key, new Set(_drillPiketIndividu.keys()));
        }
        renderRecipientChips();
        closeDrillDownPiketPicker();
    } catch (err) {
        loadEl.style.display = 'none';
        errEl.textContent    = fe(err);
        errEl.style.display  = 'block';
    }
}

function closeDrillDownPiketPicker() {
    const modal = document.getElementById('modal-forum-picker');
    modal.style.display = 'none';
    delete modal.dataset.drillMode;
    document.getElementById('picker-tree').style.display = 'none';
    document.getElementById('picker-list').innerHTML     = '';
    _drillPiketExpanded.clear();
}

// ─── Drill-down Picker Wali Kelas ─────────────────────────────
function openDrillDownWaliKelasPicker() {
    _drillWaliExpanded.clear();
    _drillWaliGradeAll.clear();
    _drillWaliSelected.clear();
    _waliKelasCache = null;

    const modal = document.getElementById('modal-forum-picker');
    modal.dataset.drillMode = 'wali';
    modal.style.display = 'flex';

    document.getElementById('picker-title').textContent = 'Pilih Wali Kelas Tertentu';
    document.getElementById('picker-search').value = '';
    document.getElementById('picker-list').style.display = 'none';
    document.getElementById('picker-loading').style.display = 'block';
    document.getElementById('picker-error').style.display = 'none';
    ['picker-filter-jabatan-wrap','picker-filter-jurusan-wrap',
     'picker-filter-kelas-wrap','picker-filter-hari-wrap'].forEach(id => {
        document.getElementById(id).style.display = 'none';
    });

    _initPickerWiring(modal);

    getForumRecipientCandidates('SEMUA_WALI_KELAS', {
        academicYear: config.current_academic_year,
    }).then(list => {
        _waliKelasCache = new Map();
        list.forEach(c => { if (c.extra_info) _waliKelasCache.set(c.extra_info, c); });
        document.getElementById('picker-loading').style.display = 'none';
        renderWaliKelasTree();
    }).catch(err => {
        document.getElementById('picker-loading').style.display = 'none';
        document.getElementById('picker-error').textContent = fe(err);
        document.getElementById('picker-error').style.display = 'block';
    });
}

function renderWaliKelasTree() {
    const tree = document.getElementById('picker-tree');
    tree.style.display = 'block';
    tree.innerHTML = '';

    if (!_waliKelasCache) {
        tree.textContent = 'Memuat…';
        return;
    }

    const grades = [
        { level: 10, label: 'X' },
        { level: 11, label: 'XI' },
        { level: 12, label: 'XII' },
    ];

    grades.forEach(({ level, label }) => {
        const classes    = _forumClasses.filter(c => c.grade_level === level);
        if (!classes.length) return;
        const gradeWali  = classes.map(cls => _waliKelasCache.get(cls.name)).filter(Boolean);
        const expanded   = _drillWaliExpanded.has(level);
        const gradeAll   = _drillWaliGradeAll.has(level);
        const selCnt     = gradeAll
            ? gradeWali.length
            : gradeWali.filter(c => _drillWaliSelected.has(c.user_id)).length;

        const node = document.createElement('div');
        node.style.cssText = 'border-bottom:1px solid var(--color-border)';

        const hdr = document.createElement('div');
        hdr.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 10px;cursor:pointer;user-select:none';
        const arrow = document.createElement('span');
        arrow.style.cssText = 'font-size:10px;color:var(--color-muted);min-width:12px';
        arrow.textContent = expanded ? '▼' : '▶';
        const lbl = document.createElement('span');
        lbl.style.cssText = 'flex:1;font-weight:500';
        lbl.textContent = `Kelas ${label}`;
        const badge = document.createElement('span');
        badge.style.cssText = 'font-size:11px;color:var(--color-primary);font-weight:500';
        badge.textContent = selCnt > 0 ? `${selCnt} dipilih` : '';
        hdr.append(arrow, lbl, badge);
        hdr.addEventListener('click', () => {
            if (_drillWaliExpanded.has(level)) _drillWaliExpanded.delete(level);
            else _drillWaliExpanded.add(level);
            renderWaliKelasTree();
        });
        node.appendChild(hdr);

        if (expanded) {
            const sub = document.createElement('div');
            sub.style.cssText = 'padding-left:16px;padding-bottom:8px';

            // Checkbox "Semua Wali Kelas [label]"
            const allRow = document.createElement('label');
            allRow.style.cssText = 'display:flex;align-items:center;gap:8px;padding:5px 4px;cursor:pointer';
            const allCb = document.createElement('input');
            allCb.type    = 'checkbox';
            allCb.checked = gradeAll;
            allCb.addEventListener('change', () => {
                if (allCb.checked) {
                    _drillWaliGradeAll.add(level);
                    gradeWali.forEach(c => _drillWaliSelected.delete(c.user_id));
                } else {
                    _drillWaliGradeAll.delete(level);
                }
                renderWaliKelasTree();
            });
            const allLbl = document.createElement('span');
            allLbl.style.cssText = 'font-size:13px;font-weight:500';
            allLbl.textContent = `Semua Wali Kelas ${label}`;
            allRow.append(allCb, allLbl);
            sub.appendChild(allRow);

            if (!gradeWali.length) {
                sub.insertAdjacentHTML('beforeend',
                    '<p style="font-size:12px;color:var(--color-muted);padding:4px">Belum ada Wali Kelas.</p>');
            } else {
                gradeWali.forEach(wali => {
                    const row = document.createElement('label');
                    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 4px;cursor:pointer';
                    const cb = document.createElement('input');
                    cb.type     = 'checkbox';
                    cb.checked  = gradeAll || _drillWaliSelected.has(wali.user_id);
                    cb.disabled = gradeAll;
                    cb.addEventListener('change', () => {
                        if (cb.checked) _drillWaliSelected.set(wali.user_id, wali);
                        else _drillWaliSelected.delete(wali.user_id);
                        renderWaliKelasTree();
                    });
                    const nameEl = document.createElement('div');
                    nameEl.innerHTML =
                        `<div style="font-size:13px">${esc(wali.full_name)}</div>` +
                        `<div style="font-size:11px;color:var(--color-muted)">${esc(wali.extra_info ?? '')}</div>`;
                    row.append(cb, nameEl);
                    sub.appendChild(row);
                });
            }
            node.appendChild(sub);
        }
        tree.appendChild(node);
    });
}

async function submitWaliKelasDrillDown() {
    const toAdd = new Map(_drillWaliSelected);
    _drillWaliGradeAll.forEach(level => {
        _forumClasses.filter(c => c.grade_level === level).forEach(cls => {
            const wali = _waliKelasCache?.get(cls.name);
            if (wali) toAdd.set(wali.user_id, wali);
        });
    });
    if (toAdd.size === 0) {
        closeDrillDownWaliKelasPicker();
        return;
    }
    const key = `WALI_KELAS_INDIVIDU_${Date.now()}`;
    toAdd.forEach((c, uid) => _forumRecipients.set(uid, c));
    _forumGroupLabels.set(key, 'Wali Kelas pilihan');
    _forumGroupUids.set(key, new Set(toAdd.keys()));
    renderRecipientChips();
    closeDrillDownWaliKelasPicker();
}

function closeDrillDownWaliKelasPicker() {
    const modal = document.getElementById('modal-forum-picker');
    modal.style.display = 'none';
    delete modal.dataset.drillMode;
    document.getElementById('picker-tree').style.display = 'none';
    document.getElementById('picker-list').innerHTML = '';
    _drillWaliExpanded.clear();
    _drillWaliGradeAll.clear();
}

// ─── Chips Penerima ───────────────────────────────────────────
function renderRecipientChips() {
    const container = document.getElementById('forum-recipient-chips');
    const emptyEl   = document.getElementById('forum-chips-empty');
    const countEl   = document.getElementById('forum-recipient-count');

    container.querySelectorAll('.recipient-chip').forEach(el => el.remove());

    if (_forumRecipients.size === 0 && _forumGroupLabels.size === 0) {
        emptyEl.style.display = 'inline';
        countEl.textContent = '';
        return;
    }
    emptyEl.style.display = 'none';
    countEl.textContent = _forumRecipients.size > 0
        ? `${_forumRecipients.size} penerima dipilih` : '';

    const chipCss = 'display:inline-flex;align-items:center;gap:4px;padding:2px 8px;' +
        'background:var(--color-bg-alt);border-radius:12px;font-size:12px';
    const btnCss  = 'background:none;border:none;cursor:pointer;padding:0;line-height:1';

    // Satu chip ringkas per grup "Semua X"
    const groupedUids = new Set();
    _forumGroupLabels.forEach((label, groupKey) => {
        const uids = _forumGroupUids.get(groupKey) ?? new Set();
        uids.forEach(uid => groupedUids.add(uid));
        const chip = document.createElement('span');
        chip.className = 'recipient-chip';
        chip.style.cssText = chipCss;
        chip.innerHTML = `${esc(label)} <button style="${btnCss}">\u2715</button>`;
        chip.querySelector('button').addEventListener('click', () => {
            uids.forEach(uid => _forumRecipients.delete(uid));
            _forumGroupLabels.delete(groupKey);
            _forumGroupUids.delete(groupKey);
            const btn = _forumGroupBtns.get(groupKey);
            if (btn) btn.className = 'btn btn-secondary';
            _forumGroupBtns.delete(groupKey);
            renderRecipientChips();
        });
        container.appendChild(chip);
    });

    // Chip individual untuk penerima di luar grup
    _forumRecipients.forEach((r, uid) => {
        if (groupedUids.has(uid)) return;
        const chip = document.createElement('span');
        chip.className = 'recipient-chip';
        chip.style.cssText = chipCss;
        chip.innerHTML = `${esc(r.full_name)} <button data-uid="${uid}" style="${btnCss}">\u2715</button>`;
        chip.querySelector('button').addEventListener('click', () => {
            _forumRecipients.delete(uid);
            renderRecipientChips();
        });
        container.appendChild(chip);
    });
}

async function submitForumPost() {
    const errEl   = document.getElementById('forum-post-error');
    const btnEl   = document.getElementById('btn-forum-modal-simpan');
    const title   = document.getElementById('forum-input-title').value.trim();
    const body    = document.getElementById('forum-input-body').value.trim();
    const fileEl  = document.getElementById('forum-input-file');

    errEl.style.display = 'none';
    if (!title) { errEl.textContent = 'Judul wajib diisi.'; errEl.style.display = 'block'; return; }
    if (!body)  { errEl.textContent = 'Isi posting wajib diisi.'; errEl.style.display = 'block'; return; }
    if (_forumRecipients.size === 0 && !_forumEditPostId) {
        errEl.textContent = 'Pilih minimal satu penerima.';
        errEl.style.display = 'block'; return;
    }

    btnEl.disabled = true;
    btnEl.textContent = 'Mengirim\u2026';

    try {
        let attachmentUrl  = null;
        let attachmentName = null;

        if (fileEl.files[0]) {
            const file = fileEl.files[0];
            if (file.size > 10 * 1024 * 1024) {
                errEl.textContent = 'Ukuran file maks. 10 MB.';
                errEl.style.display = 'block'; return;
            }
            const ext  = file.name.split('.').pop();
            const path = `${currentUser.school_id}/${Date.now()}.${ext}`;
            const { error: upErr } = await supabase.storage
                .from('forum-attachments')
                .upload(path, file, { upsert: false });
            if (upErr) throw upErr;
            const { data: urlData } = supabase.storage
                .from('forum-attachments')
                .getPublicUrl(path);
            attachmentUrl  = urlData.publicUrl;
            attachmentName = file.name;
        }

        if (_forumEditPostId) {
            await updateForumSekolahPost(_forumEditPostId, title, body);
        } else {
            const recipientIds = [..._forumRecipients.keys()];
            await createForumSekolahPost(title, body, recipientIds,
                config.current_academic_year, { attachmentUrl, attachmentName });
        }

        closeForumModal();
        _forumMode = 'terkirim';
        document.getElementById('forum-tab-masuk').className    = 'btn btn-secondary';
        document.getElementById('forum-tab-terkirim').className = 'btn btn-primary';
        _forumOffset = 0;
        loadForumPosts();
    } catch (err) {
        errEl.textContent = fe(err);
        errEl.style.display = 'block';
    } finally {
        btnEl.disabled = false;
        btnEl.textContent = 'Kirim';
    }
}

// ─── Modal Detail ─────────────────────────────────────────────
async function openForumDetail(postId) {
    const modal = document.getElementById('modal-forum-detail');
    modal.dataset.postId = postId;
    modal.style.display  = 'flex';

    document.getElementById('detail-forum-title').textContent  = 'Memuat\u2026';
    document.getElementById('detail-forum-body').textContent   = '';
    document.getElementById('detail-forum-meta').textContent   = '';
    document.getElementById('detail-forum-attachment').innerHTML = '';
    document.getElementById('detail-forum-comments-list').innerHTML = '';
    document.getElementById('detail-forum-comments-loading').style.display = 'block';
    document.getElementById('forum-author-actions').style.display = 'none';
    document.getElementById('forum-comment-error').style.display  = 'none';
    document.getElementById('forum-comment-input').value = '';

    try {
        const post = _forumMode === 'masuk'
            ? await getForumSekolahPostById(postId, currentUser.school_id, currentUser.user_id)
            : await getForumSekolahSentPostById(postId, currentUser.school_id, currentUser.user_id);

        document.getElementById('detail-forum-title').textContent = post.title;
        document.getElementById('detail-forum-body').textContent  = post.body;

        const time   = new Date(post.created_at).toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short' });
        const author = post.author?.full_name ?? '\u2014';
        const edited = post.is_edited ? ' \u2022 diedit' : '';
        document.getElementById('detail-forum-meta').textContent = `${author} \u00B7 ${time}${edited}`;

        if (post.attachment_url) {
            document.getElementById('detail-forum-attachment').innerHTML =
                `<a href="${post.attachment_url}" target="_blank" class="btn btn-secondary" style="font-size:13px">
                    \uD83D\uDCCE ${esc(post.attachment_name ?? 'Unduh Lampiran')}
                </a>`;
        }

        await addForumSekolahAcknowledgement(postId, currentUser.user_id, currentUser.school_id);

        if (post.author_user_id === currentUser.user_id) {
            document.getElementById('forum-author-actions').style.display = 'block';
        }

        await loadForumComments(postId);

    } catch (err) {
        document.getElementById('detail-forum-title').textContent = 'Gagal memuat posting.';
        document.getElementById('detail-forum-comments-loading').textContent = fe(err);
    }
}

function closeForumDetail() {
    document.getElementById('modal-forum-detail').style.display = 'none';
}

async function loadForumComments(postId) {
    const loadEl = document.getElementById('detail-forum-comments-loading');
    const listEl = document.getElementById('detail-forum-comments-list');
    try {
        const comments = await getForumSekolahComments(postId);
        loadEl.style.display = 'none';
        if (!comments.length) {
            listEl.innerHTML = '<p class="hint">Belum ada komentar.</p>';
            return;
        }
        listEl.innerHTML = comments.map(c => {
            const time   = new Date(c.created_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });
            const author = esc(c.author?.full_name ?? '\u2014');
            const isOwn  = c.author_user_id === currentUser.user_id;
            return `
            <div style="padding:8px 0;border-bottom:1px solid var(--color-border)" data-comment-id="${c.comment_id}">
                <div style="display:flex;justify-content:space-between;align-items:center">
                    <strong style="font-size:13px">${author}</strong>
                    <span class="hint" style="font-size:11px">${time}
                        ${isOwn ? `<button class="btn-link btn-hapus-komentar" data-cid="${c.comment_id}"
                            style="margin-left:8px;color:var(--color-danger);font-size:11px;
                                   background:none;border:none;cursor:pointer">Hapus</button>` : ''}
                    </span>
                </div>
                <p style="margin:4px 0 0;font-size:14px;white-space:pre-wrap">${esc(c.body)}</p>
            </div>`;
        }).join('');

        listEl.querySelectorAll('.btn-hapus-komentar').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!confirm('Hapus komentar ini?')) return;
                try {
                    await deleteForumSekolahComment(btn.dataset.cid);
                    await loadForumComments(postId);
                } catch (err) { alert(fe(err)); }
            });
        });
    } catch (err) {
        loadEl.textContent = fe(err);
        loadEl.style.display = 'block';
    }
}

async function submitForumComment() {
    const input  = document.getElementById('forum-comment-input');
    const errEl  = document.getElementById('forum-comment-error');
    const postId = document.getElementById('modal-forum-detail').dataset.postId;
    const body   = input.value.trim();

    errEl.style.display = 'none';
    if (!body) return;

    try {
        await addForumSekolahComment(postId, body, currentUser.school_id);
        input.value = '';
        await loadForumComments(postId);
    } catch (err) {
        errEl.textContent = fe(err);
        errEl.style.display = 'block';
    }
}

let _paTabInit = false;

async function initPerangkatAjarTab() {
    if (_paTabInit) {
        // Refresh data setiap kali tab dibuka (tapi jangan re-wire events)
        await loadPerangkatAjarDashboard();
        return;
    }
    _paTabInit = true;
    await loadPerangkatAjarDashboard();

    // Wire tombol buat dokumen baru (header)
    document.getElementById('pa-new-doc-btn')?.addEventListener('click', () => openBuatDokumenModal(null));
}

async function loadPerangkatAjarDashboard() {
    const container = document.getElementById('perangkat-ajar-container');
    container.innerHTML = `
        <div class="pa-header" style="margin-bottom:16px">
            <h3 style="margin:0 0 10px">Perangkat Ajar Saya</h3>
            <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
                <button class="btn btn-secondary btn-sm" id="btn-profil-mengajar">1. Profil Mengajar</button>
                <button class="btn btn-secondary btn-sm" id="btn-konteks-kelas">2. Konteks Kelas</button>
            </div>
        </div>
        <div id="pa-mapel-list"><p class="hint">Memuat...</p></div>`;

    document.getElementById('btn-profil-mengajar').addEventListener('click', () => openProfilMengajarModal());
    document.getElementById('btn-konteks-kelas').addEventListener('click', () => openKonteksKelasModal());

    const ay = config?.current_academic_year ?? getCurrentAcademicYear();

    try {
        const [docs, mySubjects, phases] = await Promise.all([
            getMyTeacherDocuments(currentUser.school_id, ay),
            getMyTeachingCoreSubjects(currentUser.user_id, currentUser.school_id, ay),
            getCorePhases(),
        ]);
        const coreSubjects = mySubjects.length > 0 ? mySubjects : await ensureCoreSubjects();

        const subjectMap = new Map(coreSubjects.map(s => [s.subject_id, s]));
        const phaseMap   = new Map(phases.map(p => [p.phase_id, p]));

        // Group docs by core_subject_id+phase_id
        const grouped = new Map();
        for (const doc of docs) {
            const key = `${doc.core_subject_id}__${doc.phase_id}`;
            if (!grouped.has(key)) grouped.set(key, { core_subject_id: doc.core_subject_id, phase_id: doc.phase_id, docs: [] });
            grouped.get(key).docs.push(doc);
        }

        const listEl = document.getElementById('pa-mapel-list');
        if (grouped.size === 0) {
            listEl.innerHTML = `
                <div style="text-align:center;padding:2.5rem 1rem;border:0.5px solid var(--color-border,#334);border-radius:12px">
                    <div style="font-size:36px;margin-bottom:12px">📚</div>
                    <p style="font-size:15px;font-weight:600;margin:0 0 6px;color:var(--color-text)">Belum ada perangkat ajar</p>
                    <p style="font-size:13px;color:var(--color-text-muted,#888);margin:0 0 20px">
                        Mulai dengan mengisi Profil Mengajar dan Konteks Kelas,<br>
                        lalu buat ATP untuk mata pelajaran Anda.
                    </p>
                    <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
                        <button class="btn btn-secondary btn-sm" id="pa-empty-upload-btn">📤 Upload ATP</button>
                        <button class="btn btn-primary btn-sm" id="pa-empty-generate-btn">✨ Generate ATP</button>
                    </div>
                    <p style="font-size:11px;color:var(--color-text-muted,#888);margin-top:10px">
                        Upload: PDF atau DOCX &middot; Generate: AI menyusun dari CP
                    </p>
                </div>`;

            document.getElementById('pa-empty-upload-btn')
                ?.addEventListener('click', () => uploadATPFlow(coreSubjects, phases, ay));
            document.getElementById('pa-empty-generate-btn')
                ?.addEventListener('click', () => openGenerateATPPicker(coreSubjects, phases,
                    (subjId, phaseId, subjName, _semester) =>
                        openConfirmGenerateModal(subjId, phaseId, subjName, ay)
                ));
            return;
        }

        listEl.innerHTML = [...grouped.values()].map(group => {
            const subj  = subjectMap.get(group.core_subject_id);
            const phase = phaseMap.get(group.phase_id);
            const subjName  = subj?.name ?? '—';
            const phaseName = phase?.code ? `Fase ${phase.code}` : '—';

            // Hitung progress
            const doneStatuses = ['DIREVIEW_GURU', 'DISAHKAN_WAKA'];
            const hasPT  = group.docs.some(d => d.document_type === 'PROGRAM_TAHUNAN'  && doneStatuses.includes(d.status));
            const hasPS1 = group.docs.some(d => d.document_type === 'PROGRAM_SEMESTER' && d.semester === 1 && doneStatuses.includes(d.status));
            const hasPS2 = group.docs.some(d => d.document_type === 'PROGRAM_SEMESTER' && d.semester === 2 && doneStatuses.includes(d.status));
            const hasATP = group.docs.some(d => d.document_type === 'ATP'              && doneStatuses.includes(d.status));
            const pct    = (hasPT ? 10 : 0) + (hasPS1 ? 10 : 0) + (hasPS2 ? 10 : 0) + (hasATP ? 20 : 0)
                         + (group.docs.some(d => d.document_type === 'PPM' && doneStatuses.includes(d.status)) ? 50 : 0);

            const dokRows = ['ATP','PROGRAM_TAHUNAN','PROGRAM_SEMESTER','PPM','LKPD','SOAL','RUBRIK'].map(dtype => {
                const typeDocs = group.docs.filter(d => d.document_type === dtype);
                const badgeHtml = typeDocs.length
                    ? `<span style="font-size:11px;color:var(--color-success,#16a34a)">✓ Ada</span>`
                    : `<span style="font-size:11px;color:var(--color-text-muted)">—</span>`;
                return `<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;font-size:13px">
                    <span>${esc(DOC_TYPE_LABEL[dtype] ?? dtype)}</span>
                    ${badgeHtml}
                </div>`;
            }).join('');

            return `
            <div class="section-card" style="margin-bottom:12px">
                <div style="margin-bottom:12px">
                    <h4 style="margin:0 0 4px">${esc(subjName)}</h4>
                    <span style="font-size:12px;padding:2px 8px;border-radius:12px;background:var(--color-bg-alt);color:var(--color-text-muted)">${esc(phaseName)}</span>
                </div>
                <div style="margin-bottom:10px">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
                        <span style="font-size:12px;color:var(--color-text-muted)">Progress</span>
                        <span style="font-size:12px;font-weight:600;color:${pct >= 70 ? 'var(--color-success,#16a34a)' : pct >= 30 ? 'var(--color-warning,#f59e0b)' : 'var(--color-text-muted)'}">${pct}%</span>
                    </div>
                    <div style="height:6px;background:var(--color-bg-alt);border-radius:3px;overflow:hidden">
                        <div style="height:100%;width:${pct}%;background:${pct >= 70 ? 'var(--color-success,#16a34a)' : pct >= 30 ? 'var(--color-warning,#f59e0b)' : 'var(--color-primary)'};border-radius:3px;transition:width .3s"></div>
                    </div>
                </div>
                <div style="border-top:1px solid var(--color-border);padding-top:10px">${dokRows}</div>
                <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap" id="pa-doc-actions-${esc(group.core_subject_id)}-${esc(group.phase_id)}">
                    ${group.docs.slice(0, 3).map(doc => {
                        const lbl = DOC_TYPE_LABEL[doc.document_type] ?? doc.document_type;
                        const col = DOC_STATUS_COLOR[doc.status] ?? 'inherit';
                        const sem = doc.semester ? ` Sem ${doc.semester}` : '';
                        return `<button class="btn btn-secondary btn-sm pa-detail-btn"
                            data-doc-id="${esc(doc.doc_id)}"
                            data-subject-id="${esc(group.core_subject_id)}"
                            data-phase-id="${esc(group.phase_id)}"
                            style="font-size:12px">
                            ${esc(lbl)}${esc(sem)}
                            <span style="font-size:10px;color:${col};margin-left:4px">${esc(DOC_STATUS_LABEL[doc.status] ?? doc.status)}</span>
                        </button>`;
                    }).join('')}
                    ${group.docs.length > 3 ? `<span style="font-size:12px;color:var(--color-text-muted);align-self:center">+${group.docs.length - 3} lainnya</span>` : ''}
                    <button class="btn btn-primary btn-sm pa-generate-atp-btn"
                        data-core-subject-id="${esc(group.core_subject_id)}"
                        data-phase-id="${esc(group.phase_id)}"
                        data-subject-name="${esc(subjectMap.get(group.core_subject_id)?.name ?? '')}"
                        style="font-size:12px;margin-left:auto">
                        ${group.docs.some(d => d.document_type === 'ATP') ? '🔄 Generate Ulang ATP' : '✨ Generate ATP'}
                    </button>
                    ${(() => {
                        const atpDoc = group.docs.find(d => d.document_type === 'ATP');
                        const hasProtaAny = group.docs.some(d => d.document_type === 'PROGRAM_TAHUNAN');
                        if (!atpDoc || hasProtaAny) return '';
                        return `<button class="btn btn-secondary btn-sm pa-generate-prota-btn"
                            data-core-subject-id="${esc(group.core_subject_id)}"
                            data-phase-id="${esc(group.phase_id)}"
                            data-subject-name="${esc(subjectMap.get(group.core_subject_id)?.name ?? '')}"
                            data-atp-doc-id="${esc(atpDoc.doc_id)}"
                            style="font-size:12px">
                            📅 Generate Prota
                        </button>`;
                    })()}
                </div>
            </div>`;
        }).join('');

        // Wire event delegation untuk tombol Detail
        document.getElementById('pa-mapel-list').addEventListener('click', e => {
            const detailBtn = e.target.closest('.pa-detail-btn');
            if (detailBtn) {
                openDetailDokumenModal(detailBtn.dataset.docId, detailBtn.dataset.subjectId, detailBtn.dataset.phaseId);
            }
            const genBtn = e.target.closest('.pa-generate-atp-btn');
            if (genBtn) {
                openConfirmGenerateModal(
                    genBtn.dataset.coreSubjectId,
                    genBtn.dataset.phaseId,
                    genBtn.dataset.subjectName,
                    ay,
                );
            }
            const protaBtn = e.target.closest('.pa-generate-prota-btn');
            if (protaBtn) {
                openConfirmProtaModal(
                    protaBtn.dataset.coreSubjectId,
                    protaBtn.dataset.phaseId,
                    protaBtn.dataset.subjectName,
                    protaBtn.dataset.atpDocId,
                    ay,
                );
            }
        });

    } catch (err) {
        document.getElementById('pa-mapel-list').innerHTML =
            `<div class="status-err">Gagal memuat. ${esc(fe(err))}</div>`;
    }
}

async function openBuatDokumenModal(preselect) {
    const modal = document.getElementById('buat-dokumen-modal');
    const body  = document.getElementById('buat-dok-body');
    document.getElementById('buat-dok-title').textContent = 'Buat Dokumen';

    const ay = config?.current_academic_year ?? getCurrentAcademicYear();

    const [coreSubjects, phases] = await Promise.all([
        ensureCoreSubjects(),
        getCorePhases(),
    ]);

    let allDocs = [];
    try { allDocs = await getMyTeacherDocuments(currentUser.school_id, ay); } catch { /* ignore */ }

    const PREREQS = {
        PROGRAM_TAHUNAN:  ['ATP'],
        PROGRAM_SEMESTER: ['ATP', 'PROGRAM_TAHUNAN'],
        PPM:    ['ATP', 'PROGRAM_TAHUNAN', 'PROGRAM_SEMESTER'],
        LKPD:   ['ATP', 'PROGRAM_TAHUNAN', 'PROGRAM_SEMESTER', 'PPM'],
        SOAL:   ['ATP', 'PROGRAM_TAHUNAN', 'PROGRAM_SEMESTER', 'PPM'],
        RUBRIK: ['ATP', 'PROGRAM_TAHUNAN', 'PROGRAM_SEMESTER', 'PPM', 'SOAL'],
    };
    const PREREQ_LABEL = { ATP: 'ATP', PROGRAM_TAHUNAN: 'Program Tahunan', PROGRAM_SEMESTER: 'Program Semester', PPM: 'PPM', SOAL: 'Soal' };
    function checkPrerequisiteWarning() {
        const warnEl    = document.getElementById('buat-dok-warning');
        const subjectId = document.getElementById('buat-dok-subject').value;
        const dtype     = document.getElementById('buat-dok-type').value;
        if (!subjectId || !dtype || !PREREQS[dtype]) { warnEl.style.display = 'none'; return; }
        const phaseId = document.getElementById('buat-dok-phase').value;
        const docs    = allDocs.filter(d => d.core_subject_id === subjectId && d.phase_id === phaseId);
        const missing = PREREQS[dtype].filter(p => !docs.some(d => d.document_type === p));
        if (missing.length) {
            warnEl.innerHTML = `⚠ Prasyarat belum ada: <strong>${missing.map(m => PREREQ_LABEL[m] ?? m).join(', ')}</strong>. Disarankan buat dokumen prasyarat dulu.`;
            warnEl.style.display = '';
        } else {
            warnEl.style.display = 'none';
        }
    }

    const subjectOptions = coreSubjects.map(s =>
        `<option value="${esc(s.subject_id)}" ${preselect?.coreSubjectId === s.subject_id ? 'selected' : ''}>${esc(s.name)}</option>`
    ).join('');

    const phaseOptions = phases.map(p =>
        `<option value="${esc(p.phase_id)}" ${preselect?.phaseId === p.phase_id ? 'selected' : ''}>${esc(p.name)}</option>`
    ).join('');

    body.innerHTML = `
        <div class="field">
            <label for="buat-dok-subject">Mata Pelajaran</label>
            <select id="buat-dok-subject" class="input">
                <option value="">— Pilih Mata Pelajaran —</option>
                ${subjectOptions}
            </select>
        </div>
        <div class="field">
            <label for="buat-dok-phase">Fase</label>
            <select id="buat-dok-phase" class="input">
                ${phaseOptions}
            </select>
        </div>
        <div class="field">
            <label for="buat-dok-type">Jenis Dokumen</label>
            <select id="buat-dok-type" class="input">
                <option value="">— Pilih Jenis —</option>
                <option value="PROGRAM_TAHUNAN">① Program Tahunan</option>
                <option value="PROGRAM_SEMESTER">② Program Semester</option>
                <option value="PPM">③ PPM (Perencanaan Pembelajaran Mendalam)</option>
                <option value="LKPD">④ LKPD</option>
                <option value="SOAL">⑤ Soal</option>
                <option value="RUBRIK">⑥ Rubrik</option>
            </select>
        </div>
        <div class="field" id="buat-dok-semester-field" style="display:none">
            <label for="buat-dok-semester">Semester</label>
            <select id="buat-dok-semester" class="input">
                <option value="1">Semester 1</option>
                <option value="2">Semester 2</option>
            </select>
        </div>
        <div class="field">
            <label for="buat-dok-judul">Judul Dokumen</label>
            <input type="text" id="buat-dok-judul" class="input" placeholder="Contoh: Program Tahunan Matematika Fase E 2026/2027" maxlength="200">
        </div>
        <div class="field">
            <label for="buat-dok-catatan">Catatan <span style="font-weight:400;color:var(--color-text-muted)">(opsional)</span></label>
            <textarea id="buat-dok-catatan" class="input" rows="3" placeholder="Catatan tambahan..."></textarea>
        </div>
        <div id="buat-dok-warning" style="display:none;padding:8px 12px;background:var(--color-warning-bg,#fffbeb);border:1px solid var(--color-warning,#f59e0b);border-radius:6px;font-size:13px;margin-bottom:12px"></div>
        <div id="buat-dok-msg" style="display:none" class="hint"></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
            <button id="buat-dok-cancel" class="btn btn-secondary">Batal</button>
            <button id="buat-dok-submit" class="btn btn-primary">Simpan</button>
        </div>`;

    // Tampilkan/sembunyikan semester field + cek prasyarat
    document.getElementById('buat-dok-type').addEventListener('change', e => {
        const needSem = ['PROGRAM_SEMESTER','PPM','LKPD','SOAL','RUBRIK'].includes(e.target.value);
        document.getElementById('buat-dok-semester-field').style.display = needSem ? '' : 'none';
        checkPrerequisiteWarning();
    });
    document.getElementById('buat-dok-subject').addEventListener('change', checkPrerequisiteWarning);
    document.getElementById('buat-dok-phase').addEventListener('change', checkPrerequisiteWarning);

    document.getElementById('buat-dok-cancel').onclick = () => { modal.style.display = 'none'; };
    document.getElementById('buat-dok-close').onclick  = () => { modal.style.display = 'none'; };

    document.getElementById('buat-dok-submit').onclick = async () => {
        const btn    = document.getElementById('buat-dok-submit');
        const msgEl  = document.getElementById('buat-dok-msg');
        const subjId = document.getElementById('buat-dok-subject').value;
        const phId   = document.getElementById('buat-dok-phase').value;
        const dtype  = document.getElementById('buat-dok-type').value;
        const judul  = document.getElementById('buat-dok-judul').value.trim();
        const catatan= document.getElementById('buat-dok-catatan').value.trim();
        const semEl  = document.getElementById('buat-dok-semester');
        const sem    = ['PROGRAM_SEMESTER','PPM','LKPD','SOAL','RUBRIK'].includes(dtype) ? parseInt(semEl.value, 10) : null;

        if (!subjId || !phId || !dtype) {
            msgEl.style.color   = 'var(--color-danger)';
            msgEl.textContent   = 'Pilih mata pelajaran, fase, dan jenis dokumen.';
            msgEl.style.display = '';
            return;
        }
        btn.disabled    = true;
        btn.textContent = 'Menyimpan…';
        msgEl.style.display = 'none';

        try {
            await createTeacherDocument({
                schoolId:       currentUser.school_id,
                academicYear:   ay,
                documentType:   dtype,
                coreSubjectId:  subjId,
                phaseId:        phId,
                programId:      null,
                scopeType:      'SEMUA_KELAS',
                semester:       sem,
                tpUrutan:       null,
                contentJson:    { judul, catatan },
            });
            msgEl.style.color   = 'var(--color-success,#16a34a)';
            msgEl.textContent   = '✓ Dokumen berhasil disimpan.';
            msgEl.style.display = '';
            setTimeout(async () => {
                modal.style.display = 'none';
                await loadPerangkatAjarDashboard();
            }, 900);
        } catch (err) {
            msgEl.style.color   = 'var(--color-danger)';
            msgEl.textContent   = `✗ ${fe(err, 's')}`;
            msgEl.style.display = '';
            btn.disabled    = false;
            btn.textContent = 'Simpan';
        }
    };

    modal.style.display = 'flex';
}

async function openDetailDokumenModal(docId, coreSubjectId, phaseId) {
    const modal = document.getElementById('buat-dokumen-modal');
    const body  = document.getElementById('buat-dok-body');
    document.getElementById('buat-dok-title').textContent = 'Detail Dokumen';

    body.innerHTML = '<p class="hint">Memuat...</p>';
    modal.style.display = 'flex';
    document.getElementById('buat-dok-close').onclick = () => { modal.style.display = 'none'; };

    const ay = config?.current_academic_year ?? getCurrentAcademicYear();
    try {
        const allDocs = await getMyTeacherDocuments(currentUser.school_id, ay);
        const doc = allDocs.find(d => d.doc_id === docId);
        if (!doc) { body.innerHTML = '<p style="color:var(--color-danger)">Dokumen tidak ditemukan.</p>'; return; }

        const judul   = doc.content_json?.judul   ?? '—';
        const catatan = doc.content_json?.catatan ?? '';
        const dtype   = DOC_TYPE_LABEL[doc.document_type] ?? doc.document_type;
        const semLabel= doc.semester ? ` · Semester ${doc.semester}` : '';
        const statusCol = DOC_STATUS_COLOR[doc.status] ?? 'inherit';

        // Status transitions untuk tombol
        const isOwn = true; // RLS sudah jamin hanya dokumen milik sendiri
        const canMarkReview  = isOwn && doc.status === 'AI_DRAFT';
        const canSubmitWaka  = isOwn && doc.status === 'DIREVIEW_GURU';
        const canDraftBack   = isOwn && doc.status === 'DIREVIEW_GURU';

        body.innerHTML = `
            <div style="margin-bottom:16px">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">
                    <span style="font-weight:600;font-size:15px">${esc(dtype)}${esc(semLabel)}</span>
                    <span style="font-size:12px;padding:2px 10px;border-radius:20px;color:${statusCol};background:var(--color-bg-alt)">${esc(DOC_STATUS_LABEL[doc.status] ?? doc.status)}</span>
                </div>
                <p style="margin:0 0 6px;font-size:13px"><strong>Judul:</strong> ${esc(judul)}</p>
                ${catatan ? `<p style="margin:0;font-size:13px;color:var(--color-text-muted)"><strong>Catatan:</strong> ${esc(catatan)}</p>` : ''}
                <p style="margin:8px 0 0;font-size:12px;color:var(--color-text-muted)">Dibuat: ${fmt(doc.created_at)}</p>
            </div>

            ${(() => {
                const tps   = doc.document_type === 'ATP' ? (doc.content_json?.tujuan_pembelajaran ?? []) : [];
                const total = doc.content_json?.total_jp ?? 0;
                if (!tps.length) return '';
                return `<div style="border-top:1px solid var(--color-border);padding-top:12px;margin-bottom:12px">
                    <p style="font-size:12px;font-weight:600;margin:0 0 8px">Tujuan Pembelajaran (${tps.length} TP · ${total} JP)</p>
                    <div style="overflow-x:auto">
                        <table style="width:100%;border-collapse:collapse;font-size:13px">
                            <thead>
                                <tr style="background:var(--color-bg-alt)">
                                    <th style="padding:8px;text-align:left;border-bottom:2px solid var(--color-border);width:40px">No</th>
                                    <th style="padding:8px;text-align:left;border-bottom:2px solid var(--color-border)">Deskripsi TP</th>
                                    <th style="padding:8px;text-align:left;border-bottom:2px solid var(--color-border);width:140px">Elemen CP</th>
                                    <th style="padding:8px;text-align:center;border-bottom:2px solid var(--color-border);width:50px">JP</th>
                                    <th style="padding:8px;text-align:left;border-bottom:2px solid var(--color-border);width:160px">Materi Pokok</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${tps.map(tp => `
                                    <tr style="border-bottom:1px solid var(--color-border)">
                                        <td style="padding:8px;vertical-align:top;color:var(--color-text-muted)">${esc(String(tp.nomor ?? ''))}</td>
                                        <td style="padding:8px;vertical-align:top">${esc(tp.deskripsi ?? '')}</td>
                                        <td style="padding:8px;vertical-align:top;color:var(--color-text-muted);font-size:12px">${esc(tp.elemen_cp ?? '')}</td>
                                        <td style="padding:8px;vertical-align:top;text-align:center;font-weight:600">${esc(String(tp.jp ?? ''))}</td>
                                        <td style="padding:8px;vertical-align:top;font-size:12px">${esc(tp.materi_pokok ?? '')}</td>
                                    </tr>`).join('')}
                                <tr style="background:var(--color-bg-alt);font-weight:600">
                                    <td colspan="3" style="padding:8px;text-align:right">Total JP</td>
                                    <td style="padding:8px;text-align:center">${esc(String(total))}</td>
                                    <td></td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>`;
            })()}

            <div style="border-top:1px solid var(--color-border);padding-top:12px">
                <p style="font-size:12px;color:var(--color-text-muted);margin:0 0 10px">Ubah status dokumen:</p>
                <div style="display:flex;gap:8px;flex-wrap:wrap">
                    ${canDraftBack  ? `<button class="btn btn-secondary btn-sm" id="doc-to-draft">Simpan sebagai Draft</button>` : ''}
                    ${canMarkReview ? `<button class="btn btn-secondary btn-sm" id="doc-to-review">Tandai Sudah Direview</button>` : ''}
                    ${canSubmitWaka ? `<button class="btn btn-primary btn-sm" id="doc-to-waka">Ajukan ke Waka Kurikulum</button>` : ''}
                    ${doc.status === 'DISAHKAN_WAKA' ? `<span style="font-size:13px;color:var(--color-success,#16a34a)">✓ Sudah disahkan Waka Kurikulum</span>` : ''}
                    ${doc.status === 'MENUNGGU_WAKA'  ? `<span style="font-size:13px;color:var(--color-warning,#f59e0b)">⏳ Menunggu persetujuan Waka Kurikulum...</span>` : ''}
                </div>
                <div id="doc-status-msg" style="display:none;margin-top:8px;font-size:13px"></div>
            </div>
            ${doc.status !== 'DISAHKAN_WAKA' ? `
            <div style="border-top:1px solid var(--color-border);padding-top:12px;margin-top:12px">
                <button id="btn-hapus-dokumen" class="btn btn-danger-outline btn-sm" data-doc-id="${doc.doc_id}">
                    🗑 Hapus Dokumen
                </button>
            </div>` : ''}`;

        const showMsg = (text, isErr = false) => {
            const el = document.getElementById('doc-status-msg');
            el.textContent   = text;
            el.style.color   = isErr ? 'var(--color-danger)' : 'var(--color-success,#16a34a)';
            el.style.display = '';
        };

        const doStatusChange = async (newStatus, btn) => {
            btn.disabled    = true;
            btn.textContent = '…';
            try {
                await updateDocumentStatus(docId, newStatus);
                showMsg(`✓ Status diubah ke: ${DOC_STATUS_LABEL[newStatus]}`);
                setTimeout(async () => {
                    modal.style.display = 'none';
                    await loadPerangkatAjarDashboard();
                }, 900);
            } catch (err) {
                showMsg(`✗ ${fe(err, 's')}`, true);
                btn.disabled    = false;
                btn.textContent = btn.dataset.label;
            }
        };

        document.getElementById('doc-to-draft')?.addEventListener('click', e => {
            e.target.dataset.label = e.target.textContent;
            doStatusChange('AI_DRAFT', e.target);
        });
        document.getElementById('doc-to-review')?.addEventListener('click', e => {
            e.target.dataset.label = e.target.textContent;
            doStatusChange('DIREVIEW_GURU', e.target);
        });
        document.getElementById('doc-to-waka')?.addEventListener('click', e => {
            e.target.dataset.label = e.target.textContent;
            doStatusChange('MENUNGGU_WAKA', e.target);
        });

        document.getElementById('btn-hapus-dokumen')?.addEventListener('click', async e => {
            if (!confirm('Hapus dokumen ini? Tindakan tidak bisa dibatalkan.')) return;
            const btn = e.target;
            btn.disabled    = true;
            btn.textContent = '…';
            try {
                await deleteTeacherDocument(docId);
                modal.style.display = 'none';
                await loadPerangkatAjarDashboard();
                alert('Dokumen berhasil dihapus.');
            } catch (err) {
                showMsg(`✗ ${fe(err, 's')}`, true);
                btn.disabled    = false;
                btn.textContent = '🗑 Hapus Dokumen';
            }
        });

    } catch (err) {
        body.innerHTML = `<p style="color:var(--color-danger)">Gagal memuat: ${esc(err.message)}</p>`;
    }
}

// Dipanggil dari initWakaKurTab — approval & riwayat untuk Waka Kurikulum
async function loadWakaDocApprovals() {
    const section = document.getElementById('kepsek-approval-section');
    if (!section) return;

    const listEl = document.getElementById('kepsek-approval-list');
    listEl.innerHTML = '<p class="hint">Memuat...</p>';

    try {
        const [docs, history, phases] = await Promise.all([
            getPendingDocApprovals(currentUser.school_id),
            getWakaApprovalHistory(currentUser.school_id),
            getCorePhases(),
        ]);
        const phaseMap = new Map(phases.map(p => [p.phase_id, p]));

        let html = '';

        // ── Bagian 1: Menunggu Persetujuan ──────────────────────
        html += `<h4 style="margin:0 0 10px;font-size:14px;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:.05em">Menunggu Persetujuan</h4>`;
        if (!docs.length) {
            html += '<p class="hint" style="margin-bottom:16px">Tidak ada dokumen yang menunggu persetujuan.</p>';
        } else {
            html += docs.map(doc => {
                const dtype    = DOC_TYPE_LABEL[doc.document_type] ?? doc.document_type;
                const phase    = phaseMap.get(doc.phase_id);
                const semLabel = doc.semester ? ` · Semester ${doc.semester}` : '';
                const judul    = doc.content_json?.judul ?? '—';
                return `
                <div style="border:1px solid var(--color-border);border-radius:var(--radius);padding:12px;margin-bottom:10px">
                    <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:8px">
                        <div>
                            <p style="margin:0 0 4px;font-weight:600">${esc(dtype)}${esc(semLabel)}</p>
                            <p style="margin:0 0 4px;font-size:13px">${esc(judul)}</p>
                            <p style="margin:0;font-size:12px;color:var(--color-text-muted)">${phase ? `Fase ${phase.code}` : ''} · ${doc.academic_year} · ${fmt(doc.created_at)}</p>
                        </div>
                        <div style="display:flex;gap:6px;align-items:center">
                            <button class="btn btn-sm btn-secondary wk-reject-btn" data-doc-id="${esc(doc.doc_id)}" style="color:var(--color-danger)">✕ Kembalikan</button>
                            <button class="btn btn-sm btn-primary wk-approve-btn" data-doc-id="${esc(doc.doc_id)}">✓ Setujui</button>
                        </div>
                    </div>
                    <div id="wk-approve-msg-${esc(doc.doc_id)}" style="display:none;font-size:13px;margin-top:8px"></div>
                    <div id="wk-catatan-row-${esc(doc.doc_id)}" style="display:none;margin-top:8px">
                        <input type="text" class="input" placeholder="Catatan pengembalian (opsional)..." style="width:100%;margin-bottom:6px">
                        <button class="btn btn-sm btn-danger wk-reject-confirm-btn" data-doc-id="${esc(doc.doc_id)}">Konfirmasi Kembalikan</button>
                    </div>
                </div>`;
            }).join('');
        }

        // ── Bagian 2: Riwayat ───────────────────────────────────
        html += `<h4 style="margin:16px 0 10px;font-size:14px;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:.05em">Riwayat</h4>`;
        if (!history.length) {
            html += '<p class="hint">Belum ada riwayat persetujuan.</p>';
        } else {
            html += history.map(row => {
                const td          = row.teacher_documents;
                const dtype       = DOC_TYPE_LABEL[td?.document_type] ?? td?.document_type ?? '—';
                const phase       = phaseMap.get(td?.phase_id);
                const semLabel    = td?.semester ? ` · Semester ${td.semester}` : '';
                const isOk        = row.status === 'APPROVED';
                const badge       = isOk
                    ? `<span style="color:var(--color-success,#16a34a);font-weight:600">✅ Disahkan</span>`
                    : `<span style="color:var(--color-primary);font-weight:600">↩ Dikembalikan</span>`;
                const subjectHtml = row.subject_name
                    ? `<p style="margin:2px 0 0;font-size:12px;color:var(--color-text-muted)">Mapel: ${esc(row.subject_name)}</p>`
                    : '';
                const guruHtml    = row.teacher_name
                    ? `<p style="margin:2px 0 0;font-size:12px;color:var(--color-text-muted)">Guru: ${esc(row.teacher_name)}</p>`
                    : '';
                const catatanHtml = row.catatan
                    ? `<p style="margin:4px 0 0;font-size:12px;color:var(--color-text-muted);font-style:italic">"${esc(row.catatan)}"</p>`
                    : '';
                const metaLine = [phase ? `Fase ${phase.code}` : '', td?.academic_year ?? '', fmt(row.approved_at)]
                    .filter(Boolean).join(' · ');
                return `
                <div style="border:1px solid var(--color-border);border-radius:var(--radius);padding:10px 12px;margin-bottom:8px;opacity:.9">
                    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;flex-wrap:wrap">
                        <div>
                            <p style="margin:0 0 2px;font-weight:600;font-size:13px">${esc(dtype)}${esc(semLabel)}</p>
                            ${subjectHtml}
                            ${guruHtml}
                            <p style="margin:2px 0 0;font-size:12px;color:var(--color-text-muted)">${metaLine}</p>
                            ${catatanHtml}
                        </div>
                        <div>${badge}</div>
                    </div>
                </div>`;
            }).join('');
        }

        listEl.innerHTML = html;

        listEl.addEventListener('click', async e => {
            const approveBtn = e.target.closest('.wk-approve-btn');
            const rejectBtn  = e.target.closest('.wk-reject-btn');
            const confirmBtn = e.target.closest('.wk-reject-confirm-btn');

            if (approveBtn) {
                const docId = approveBtn.dataset.docId;
                approveBtn.disabled    = true;
                approveBtn.textContent = '…';
                const msgEl = document.getElementById(`wk-approve-msg-${docId}`);
                try {
                    await supabase.auth.refreshSession();
                    await wakaApproveDoc(docId, 'APPROVE', null);
                    msgEl.style.color   = 'var(--color-success,#16a34a)';
                    msgEl.textContent   = '✓ Dokumen berhasil disahkan.';
                    msgEl.style.display = '';
                    setTimeout(() => loadWakaDocApprovals(), 1200);
                } catch (err) {
                    msgEl.style.color   = 'var(--color-danger)';
                    msgEl.textContent   = `✗ ${fe(err, 's')}`;
                    msgEl.style.display = '';
                    approveBtn.disabled    = false;
                    approveBtn.textContent = '✓ Setujui';
                }
            }

            if (rejectBtn) {
                const docId = rejectBtn.dataset.docId;
                const row   = document.getElementById(`wk-catatan-row-${docId}`);
                row.style.display = row.style.display === 'none' ? '' : 'none';
            }

            if (confirmBtn) {
                const docId   = confirmBtn.dataset.docId;
                const row     = document.getElementById(`wk-catatan-row-${docId}`);
                const catatan = row.querySelector('input')?.value.trim() ?? null;
                confirmBtn.disabled    = true;
                confirmBtn.textContent = '…';
                const msgEl = document.getElementById(`wk-approve-msg-${docId}`);
                try {
                    await supabase.auth.refreshSession();
                    await wakaApproveDoc(docId, 'REJECT', catatan);
                    msgEl.style.color   = 'var(--color-primary)';
                    msgEl.textContent   = '↩ Dokumen dikembalikan ke guru.';
                    msgEl.style.display = '';
                    setTimeout(() => loadWakaDocApprovals(), 1200);
                } catch (err) {
                    msgEl.style.color   = 'var(--color-danger)';
                    msgEl.textContent   = `✗ ${fe(err, 's')}`;
                    msgEl.style.display = '';
                    confirmBtn.disabled    = false;
                    confirmBtn.textContent = 'Konfirmasi Kembalikan';
                }
            }
        });

    } catch (err) {
        listEl.innerHTML = `<div class="status-err">Gagal memuat. ${esc(fe(err))}</div>`;
    }
}

// Dipanggil dari initKepsekTab — daftar dokumen DISAHKAN_WAKA (read-only)
async function loadKepsekDisahkanDocs() {
    const section = document.getElementById('ks-disahkan-section');
    if (!section) return;

    const listEl = document.getElementById('ks-disahkan-list');
    listEl.innerHTML = '<p class="hint">Memuat...</p>';

    try {
        const [docs, phases] = await Promise.all([
            getDisahkanWakaDocs(currentUser.school_id),
            getCorePhases(),
        ]);
        const phaseMap = new Map(phases.map(p => [p.phase_id, p]));

        if (!docs.length) {
            listEl.innerHTML = '<p class="hint">Belum ada dokumen yang disahkan Waka Kurikulum.</p>';
            return;
        }

        listEl.innerHTML = docs.map(doc => {
            const dtype    = DOC_TYPE_LABEL[doc.document_type] ?? doc.document_type;
            const phase    = phaseMap.get(doc.phase_id);
            const semLabel = doc.semester ? ` · Semester ${doc.semester}` : '';
            const guruHtml = doc.teacher_name
                ? `<p style="margin:2px 0 0;font-size:12px;color:var(--color-text-muted)">Guru: ${esc(doc.teacher_name)}</p>`
                : '';
            return `
            <div style="border:1px solid var(--color-border);border-radius:var(--radius);padding:10px 12px;margin-bottom:8px">
                <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;flex-wrap:wrap">
                    <div>
                        <p style="margin:0 0 2px;font-weight:600;font-size:13px">
                            <span style="color:var(--color-success,#16a34a)">✅</span>
                            ${esc(dtype)}${esc(semLabel)}
                        </p>
                        ${guruHtml}
                        <p style="margin:2px 0 0;font-size:12px;color:var(--color-text-muted)">
                            Disahkan: ${fmt(doc.updated_at)} · ${phase ? `Fase ${phase.code}` : ''} · ${doc.academic_year}
                        </p>
                    </div>
                </div>
            </div>`;
        }).join('');

    } catch (err) {
        listEl.innerHTML = `<div class="status-err">Gagal memuat. ${esc(fe(err))}</div>`;
    }
}

// ─── Modal: Profil Mengajar ───────────────────────────────────
function buildProfilMengajarHTML(p) {
    const v = p ?? {};
    const chk = (arr, val) => (arr ?? []).includes(val) ? 'checked' : '';
    const sel = (field, val) => v[field] === val ? 'checked' : '';
    return `
    <h2 style="margin:0 0 4px;font-size:18px">Profil Mengajar</h2>
    <p style="margin:0 0 20px;font-size:13px;color:var(--color-text-muted)">Diisi sekali, berlaku untuk semua mata pelajaran</p>

    <div class="pm-q"><p class="pm-label">1. Tujuan Utama Pembelajaran</p>
      ${[
        ['PKL',                  'Persiapan PKL',                      null],
        ['DUNIA_KERJA',          'Persiapan Dunia Kerja',               null],
        ['SERTIFIKASI',          'Persiapan Sertifikasi',               'Nama sertifikasi (contoh: Mikrotik MTCNA)'],
        ['LKS',                  'Persiapan LKS',                       'Bidang/skill yang difokuskan'],
        ['KONSEP_DASAR',         'Penguatan Konsep Dasar',              null],
        ['KEWIRAUSAHAAN',        'Projek Kewirausahaan',                null],
        ['UMKM',                 'UMKM Lokal',                          null],
        ['LITERASI',             'Penguatan Literasi',                   'Jenis literasi (membaca, menulis, dst)'],
        ['NUMERASI',             'Penguatan Numerasi',                   null],
        ['KOMUNIKASI',           'Komunikasi dan Interaksi',             'Konteks komunikasi (formal, informal, dunia kerja, dst)'],
        ['PENGEMBANGAN_KARAKTER','Pengembangan Karakter',               null],
        ['PERSIAPAN_AN',         'Persiapan Asesmen Nasional',          null],
        ['LAINNYA',              'Lainnya',                              'Jelaskan tujuan pembelajaran Anda'],
      ].map(([val, lbl, placeholder]) => {
        const isSelected = v.instructional_intent === val;
        const condDetail  = isSelected ? (v.intent_detail ?? '') : '';
        const condHtml    = placeholder ? `
          <div class="pm-cond-intent" id="pm-cond-${val}" style="display:${isSelected?'':'none'};margin:6px 0 4px 24px">
            <input type="text" class="input input-sm pm-cond-input" placeholder="${esc(placeholder)}" value="${esc(condDetail)}" style="width:100%;max-width:320px">
          </div>` : '';
        return `<label class="pm-radio-row"><input type="radio" name="instructional_intent" value="${val}" ${sel('instructional_intent',val)}> ${lbl}</label>${condHtml}`;
      }).join('')}
      <div style="margin-top:12px">
        <label style="font-size:13px;display:block;margin-bottom:4px;color:var(--color-text-muted)">Informasi tambahan <span style="font-weight:400">(opsional)</span></label>
        <textarea name="intent_detail" class="input" rows="3" placeholder="Tuliskan informasi tambahan tentang tujuan pembelajaran Anda..." style="width:100%;resize:vertical;font-size:13px">${esc(v.intent_detail ?? '')}</textarea>
      </div>
    </div>

    <div class="pm-q"><p class="pm-label">2. Cara Penilaian Utama</p>
      ${[['PRAKTIK','Praktik'],['PORTOFOLIO','Portofolio'],['PRESENTASI','Presentasi'],
         ['OBSERVASI','Observasi'],['TES_TERTULIS','Tes Tertulis'],['KOMBINASI','Kombinasi']].map(([val,lbl]) =>
        `<label class="pm-radio-row"><input type="radio" name="assessment_philosophy" value="${val}" ${sel('assessment_philosophy',val)}> ${lbl}</label>`
      ).join('')}
    </div>

    <div class="pm-q"><p class="pm-label">3. Gaya Mengajar</p>
      ${[['GURU_DOMINAN','Guru dominan (saya memandu setiap langkah)'],
         ['SISWA_DOMINAN','Siswa dominan (saya sebagai fasilitator)'],
         ['SEIMBANG','Seimbang']].map(([val,lbl]) =>
        `<label class="pm-radio-row"><input type="radio" name="teaching_style" value="${val}" ${sel('teaching_style',val)}> ${lbl}</label>`
      ).join('')}
    </div>

    <div class="pm-q"><p class="pm-label">4. Model Pembelajaran</p>
      ${[['PBL_PROJECT','Project-Based Learning'],['PBL_PROBLEM','Problem-Based Learning'],
         ['DISCOVERY','Discovery Learning'],['CERAMAH_LATIHAN','Ceramah + Latihan']].map(([val,lbl]) =>
        `<label class="pm-radio-row"><input type="radio" name="learning_model" value="${val}" ${sel('learning_model',val)}> ${lbl}</label>`
      ).join('')}
    </div>

    <div class="pm-q"><p class="pm-label">5. Gaya Penyampaian</p>
      ${[['PRAKTIK','Banyak praktik'],['DISKUSI','Banyak diskusi'],['DEMONSTRASI','Banyak demonstrasi']].map(([val,lbl]) =>
        `<label class="pm-radio-row"><input type="radio" name="delivery_style" value="${val}" ${sel('delivery_style',val)}> ${lbl}</label>`
      ).join('')}
    </div>

    <div class="pm-q"><p class="pm-label">6. Pola Jadwal Mengajar</p>
      ${[['SPLIT_2JP','2 JP × beberapa hari terpisah'],['BLOCK_6JP','6 JP sekaligus (block)'],
         ['TEORI_PRAKTIK','Teori dulu lalu praktik'],['PRAKTIK_PENUH','Praktik penuh']].map(([val,lbl]) =>
        `<label class="pm-radio-row"><input type="radio" name="schedule_pattern" value="${val}" ${sel('schedule_pattern',val)}> ${lbl}</label>`
      ).join('')}
    </div>

    <div class="pm-q"><p class="pm-label">7. Durasi Proyek</p>
      ${[['1_MINGGU','1 minggu'],['2_4_MINGGU','2–4 minggu'],['SATU_SEMESTER','Satu semester']].map(([val,lbl]) =>
        `<label class="pm-radio-row"><input type="radio" name="project_duration" value="${val}" ${sel('project_duration',val)}> ${lbl}</label>`
      ).join('')}
    </div>

    <div class="pm-q"><p class="pm-label">8. Tingkat Kedalaman Materi</p>
      ${[['DASAR','Dasar'],['MENENGAH','Menengah'],['MAHIR','Mahir']].map(([val,lbl]) =>
        `<label class="pm-radio-row"><input type="radio" name="depth_level" value="${val}" ${sel('depth_level',val)}> ${lbl}</label>`
      ).join('')}
    </div>

    <div class="pm-q"><p class="pm-label">9. Konteks Lokal <span style="font-weight:400;color:var(--color-text-muted)">(opsional)</span></p>
      <div style="display:grid;gap:8px;max-width:360px">
        <label style="font-size:13px">Kota/daerah<input type="text" class="input input-sm" name="local_city" value="${esc(v.local_city??'')}" style="margin-top:4px"></label>
        <label style="font-size:13px">Industri lokal<input type="text" class="input input-sm" name="local_industry" value="${esc(v.local_industry??'')}" style="margin-top:4px"></label>
        <label style="font-size:13px">Nama DUDI mitra<input type="text" class="input input-sm" name="local_dudi_partners" value="${esc(v.local_dudi_partners??'')}" style="margin-top:4px"></label>
        <label style="font-size:13px">Produk/jasa lokal<input type="text" class="input input-sm" name="local_products" value="${esc(v.local_products??'')}" style="margin-top:4px"></label>
      </div>
    </div>

    <div class="pm-q"><p class="pm-label">10. Aktivitas yang Dihindari <span style="font-weight:400;color:var(--color-text-muted)">(opsional)</span></p>
      ${[['ROLE_PLAY','Role play'],['DEBAT','Debat'],['PRESENTASI_INDIVIDU','Presentasi individu'],
         ['TUGAS_RUMAH','Tugas rumah'],['OUTDOOR','Praktik outdoor']].map(val_lbl =>
        `<label class="pm-radio-row"><input type="checkbox" name="avoided_activities" value="${val_lbl[0]}" ${chk(v.avoided_activities, val_lbl[0])}> ${val_lbl[1]}</label>`
      ).join('')}
      <label class="pm-radio-row"><input type="checkbox" name="avoided_activities" value="LAINNYA" id="pm-avoided-lain-chk" ${chk(v.avoided_activities,'LAINNYA')}> Lainnya</label>
      <div id="pm-avoided-lain-detail" style="display:${(v.avoided_activities??[]).includes('LAINNYA')?'block':'none'};margin:4px 0 0 24px">
        <input type="text" class="input input-sm" name="avoided_detail" placeholder="Jelaskan" value="${esc(v.avoided_detail??'')}" style="max-width:280px">
      </div>
    </div>

    <div class="pm-q"><p class="pm-label">11. Preferensi Integrasi <span style="font-weight:400;color:var(--color-text-muted)">(opsional)</span></p>
      ${[['NUMERASI','Numerasi'],['LITERASI','Literasi'],['AI_TEKNOLOGI','AI/Teknologi'],
         ['KEWIRAUSAHAAN','Kewirausahaan'],['BUDAYA_LOKAL','Budaya lokal'],
         ['PROFIL_LULUSAN','Profil Lulusan 8 Dimensi']].map(([val,lbl]) =>
        `<label class="pm-radio-row"><input type="checkbox" name="integration_prefs" value="${val}" ${chk(v.integration_prefs,val)}> ${lbl}</label>`
      ).join('')}
    </div>

    <div class="pm-q">
      <p class="pm-label">12. Urutan penyampaian materi</p>
      <p class="pm-hint">Bagaimana Anda biasanya menyusun urutan topik dalam satu semester?</p>
      ${(()=>{
        const seqPref = (v.integration_prefs ?? []).find(x => x.startsWith('SEQUENCE:'))?.replace('SEQUENCE:','') ?? 'RESEPTIF_PRODUKTIF';
        return [
          ['RESEPTIF_PRODUKTIF', 'Reseptif dulu, lalu produktif (menyimak/membaca → berbicara/menulis)'],
          ['TEMATIK',            'Tematik (kelompokkan berdasarkan tema, tidak terikat urutan keterampilan)'],
          ['SPIRAL',             'Spiral (setiap topik diulang dengan tingkat kesulitan naik)'],
          ['BUKU_TEKS',          'Ikuti urutan buku teks atau silabus resmi'],
        ].map(([val, lbl]) =>
          `<label class="pm-radio-row"><input type="radio" name="sequence_preference" value="${val}" ${seqPref === val ? 'checked' : ''}> ${esc(lbl)}</label>`
        ).join('');
      })()}
    </div>

    `;
}

function collectProfilMengajar(form) {
    const radio = name => form.querySelector(`input[name="${name}"]:checked`)?.value ?? null;
    const checks = name => [...form.querySelectorAll(`input[name="${name}"]:checked`)].map(el => el.value);
    const txt = name => form.querySelector(`input[name="${name}"]`)?.value.trim() || null;

    const intent = radio('instructional_intent');
    // Ambil dari input kondisional yang terlihat, fallback ke textarea intent_detail
    const visibleCond = form.querySelector(`.pm-cond-intent:not([style*="display:none"]):not([style*="display: none"]) .pm-cond-input`);
    const condVal = visibleCond?.value.trim() || null;
    const txtareaVal = form.querySelector('textarea[name="intent_detail"]')?.value.trim() || null;
    const intent_detail = condVal || txtareaVal || null;

    return {
        instructional_intent: intent,
        intent_detail,
        assessment_philosophy: radio('assessment_philosophy'),
        teaching_style: radio('teaching_style'),
        learning_model: radio('learning_model'),
        delivery_style: radio('delivery_style'),
        schedule_pattern: radio('schedule_pattern'),
        project_duration: radio('project_duration'),
        depth_level: radio('depth_level'),
        local_city: txt('local_city'),
        local_industry: txt('local_industry'),
        local_dudi_partners: txt('local_dudi_partners'),
        local_products: txt('local_products'),
        avoided_activities: checks('avoided_activities'),
        avoided_detail: txt('avoided_detail'),
        integration_prefs: (() => {
            const seqPref = form.querySelector('[name="sequence_preference"]:checked')?.value;
            const base = checks('integration_prefs').filter(v => !v.startsWith('SEQUENCE:'));
            if (seqPref) base.push(`SEQUENCE:${seqPref}`);
            return base;
        })(),
    };
}

async function openProfilMengajarModal() {
    let overlay = document.getElementById('profil-mengajar-modal');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'profil-mengajar-modal';
        overlay.className = 'modal-overlay';
        overlay.style.cssText = 'align-items:center';
        overlay.innerHTML = `
          <div class="sip-modal-panel" style="max-width:600px">
            <div class="sip-modal-scroll"><div id="pm-body"></div></div>
            <div class="sip-modal-footer">
              <button class="btn btn-secondary" id="pm-batal-btn">Batal</button>
              <button class="btn btn-primary" id="pm-simpan-btn">💾 Simpan Profil</button>
            </div>
          </div>`;
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.style.display = 'none'; });
        document.body.appendChild(overlay);
    }
    overlay.style.display = 'flex';
    document.getElementById('pm-body').innerHTML = '<p class="hint">Memuat profil…</p>';

    let profile = null;
    try {
        profile = await getTeacherProfile(currentUser.school_id);
    } catch (e) { /* biarkan kosong */ }

    const body = document.getElementById('pm-body');
    body.innerHTML = buildProfilMengajarHTML(profile);

    // Kondisional: tujuan — sembunyikan semua lalu tampilkan yang sesuai
    body.querySelectorAll('input[name="instructional_intent"]').forEach(r => {
        r.addEventListener('change', () => {
            body.querySelectorAll('.pm-cond-intent').forEach(el => el.style.display = 'none');
            const active = body.querySelector(`#pm-cond-${r.value}`);
            if (active) active.style.display = '';
        });
    });
    // Kondisional: avoided lainnya
    body.querySelector('#pm-avoided-lain-chk').addEventListener('change', e => {
        body.querySelector('#pm-avoided-lain-detail').style.display = e.target.checked ? '' : 'none';
    });

    overlay.querySelector('#pm-batal-btn').addEventListener('click', () => { overlay.style.display = 'none'; });
    overlay.querySelector('#pm-simpan-btn').addEventListener('click', async () => {
        const btn = overlay.querySelector('#pm-simpan-btn');
        btn.disabled = true; btn.textContent = '…';
        try {
            await saveTeacherProfile(currentUser.school_id, collectProfilMengajar(body));
            overlay.style.display = 'none';
        } catch (err) {
            alert(`Gagal menyimpan: ${fe(err)}`);
        } finally {
            btn.disabled = false; btn.textContent = '💾 Simpan Profil';
        }
    });
}

// ─── Modal: Konteks Kelas ─────────────────────────────────────
function buildKonteksKelasHTML(ctx, subjName, ay) {
    const v = ctx ?? {};
    const chk = (arr, val) => (arr ?? []).includes(val) ? 'checked' : '';
    const sel = (field, val) => v[field] === val ? 'checked' : '';
    return `
    <h2 style="margin:0 0 2px;font-size:18px">Konteks Kelas</h2>
    <p style="margin:0 0 2px;font-size:13px;color:var(--color-text-muted)">Mata pelajaran: <strong>${esc(subjName)}</strong></p>
    <p style="margin:0 0 20px;font-size:13px;color:var(--color-text-muted)">Tahun ajaran: <strong>${esc(ay)}</strong></p>

    <div class="pm-q"><p class="pm-label">1. Latar Belakang Siswa</p>
      ${[['PETANI','Anak petani'],['PEDAGANG','Pedagang'],['PENGRAJIN','Pengrajin'],['CAMPURAN','Campuran']].map(([val,lbl]) =>
        `<label class="pm-radio-row"><input type="radio" name="student_background" value="${val}" ${sel('student_background',val)}> ${lbl}</label>`
      ).join('')}
      <div style="margin-top:8px;max-width:280px">
        <label style="font-size:13px">Bahasa sehari-hari <span style="color:var(--color-text-muted)">(opsional)</span>
          <input type="text" class="input input-sm" name="daily_language" value="${esc(v.daily_language??'')}" style="margin-top:4px">
        </label>
      </div>
    </div>

    <div class="pm-q"><p class="pm-label">2. Akses Teknologi Siswa</p>
      ${[['SMARTPHONE','Smartphone saja'],['LAPTOP','Laptop/komputer tersedia'],['TANPA_INTERNET','Tidak ada internet']].map(([val,lbl]) =>
        `<label class="pm-radio-row"><input type="radio" name="tech_access" value="${val}" ${sel('tech_access',val)}> ${lbl}</label>`
      ).join('')}
    </div>

    <div class="pm-q"><p class="pm-label">3. Karakteristik Kelas</p>
      ${[['PASIF','Pasif'],['AKTIF_BERTANYA','Aktif bertanya'],['SULIT_KELOMPOK','Sulit bekerja kelompok'],
         ['DISIPLIN_TINGGI','Disiplin tinggi'],['CEPAT_BOSAN','Cepat bosan'],['SANGAT_HETEROGEN','Sangat heterogen']].map(([val,lbl]) =>
        `<label class="pm-radio-row"><input type="checkbox" name="class_characteristics" value="${val}" ${chk(v.class_characteristics,val)}> ${lbl}</label>`
      ).join('')}
    </div>

    <div class="pm-q"><p class="pm-label">4. Tingkat Kemandirian Siswa</p>
      ${[['SANGAT_MANDIRI','Sangat mandiri (bisa bekerja tanpa arahan terus)'],
         ['PERLU_ARAHAN','Perlu arahan (butuh panduan setiap tahap)'],
         ['SANGAT_BERGANTUNG','Sangat bergantung (perlu scaffolding penuh)']].map(([val,lbl]) =>
        `<label class="pm-radio-row"><input type="radio" name="student_autonomy" value="${val}" ${sel('student_autonomy',val)}> ${lbl}</label>`
      ).join('')}
    </div>

    <div class="pm-q"><p class="pm-label">5. Kendala di Kelas</p>
      ${[['INTERNET_MATI','Internet sering mati'],['LAB_BERGANTIAN','Lab dipakai bergantian'],
         ['HP_DILARANG','HP tidak boleh dibawa'],['PRAKTIK_SEMINGGU_SEKALI','Praktik hanya seminggu sekali'],
         ['WAKTU_MAKS_2JP','Waktu praktik maksimal 2 JP']].map(([val,lbl]) =>
        `<label class="pm-radio-row"><input type="checkbox" name="learning_constraints" value="${val}" ${chk(v.learning_constraints,val)}> ${lbl}</label>`
      ).join('')}
      <label class="pm-radio-row"><input type="checkbox" name="learning_constraints" value="LAINNYA" id="kk-kendala-lain-chk" ${chk(v.learning_constraints,'LAINNYA')}> Lainnya</label>
      <div id="kk-kendala-lain-detail" style="display:${(v.learning_constraints??[]).includes('LAINNYA')?'block':'none'};margin:4px 0 0 24px">
        <input type="text" class="input input-sm" name="constraints_detail" placeholder="Jelaskan" value="${esc(v.constraints_detail??'')}" style="max-width:280px">
      </div>
    </div>

    <div class="pm-q"><p class="pm-label">6. Sumber Belajar yang Tersedia</p>
      ${[['BUKU_PAKET','Buku paket resmi'],['MODUL_SEKOLAH','Modul sekolah'],
         ['INTERNET_STABIL','Internet stabil'],['VIDEO_PEMBELAJARAN','Video pembelajaran'],
         ['AUDIO','Audio (rekaman, podcast, lagu)'],
         ['LABORATORIUM','Laboratorium'],['TEACHING_FACTORY','Teaching Factory']].map(([val,lbl]) =>
        `<label class="pm-radio-row"><input type="checkbox" name="resources_available" value="${val}" ${chk(v.resources_available,val)}> ${lbl}</label>`
      ).join('')}
      <label class="pm-radio-row"><input type="checkbox" name="resources_available" value="DUDI_AKTIF" id="kk-dudi-chk" ${chk(v.resources_available,'DUDI_AKTIF')}> DUDI aktif</label>
      <div id="kk-dudi-detail" style="display:${(v.resources_available??[]).includes('DUDI_AKTIF')?'block':'none'};margin:4px 0 0 24px">
        <input type="text" class="input input-sm" name="dudi_name" placeholder="Nama DUDI" value="${esc(v.dudi_name??'')}" style="max-width:280px">
      </div>
      <label class="pm-radio-row"><input type="checkbox" name="resources_available" value="NARASUMBER" id="kk-narasumber-chk" ${chk(v.resources_available,'NARASUMBER')}> Narasumber industri</label>
      <div id="kk-narasumber-detail" style="display:${(v.resources_available??[]).includes('NARASUMBER')?'block':'none'};margin:4px 0 0 24px">
        <input type="text" class="input input-sm" name="narasumber_detail" placeholder="Detail" value="${esc(v.narasumber_detail??'')}" style="max-width:280px">
      </div>
    </div>

    <div class="pm-q"><p class="pm-label">7. Output Nyata yang Diharapkan</p>
      ${[['LAPORAN','Laporan tertulis'],['PRESENTASI','Presentasi'],['PRODUK_FISIK','Produk fisik'],
         ['WEB_APLIKASI','Website/Aplikasi'],['VIDEO','Video'],
         ['KONFIGURASI','Konfigurasi jaringan/sistem'],['PROTOTYPE','Prototype'],
         ['POSTER','Poster'],['SIMULASI','Simulasi']].map(([val,lbl]) =>
        `<label class="pm-radio-row"><input type="radio" name="expected_output" value="${val}" ${sel('expected_output',val)}> ${lbl}</label>`
      ).join('')}
      <label class="pm-radio-row"><input type="radio" name="expected_output" value="LAINNYA" ${sel('expected_output','LAINNYA')}> Lainnya</label>
      <div id="kk-output-lain-detail" style="display:${v.expected_output==='LAINNYA'?'block':'none'};margin:4px 0 0 24px">
        <input type="text" class="input input-sm" name="output_detail" placeholder="Jelaskan" value="${esc(v.output_detail??'')}" style="max-width:280px">
      </div>
    </div>

    <div class="pm-q"><p class="pm-label">8. Media & Alat yang Tersedia</p>
      ${[['PROYEKTOR','Proyektor/TV'],['SPEAKER','Speaker'],
         ['LAPTOP_SISWA','Laptop/komputer siswa'],['TABLET','Tablet'],
         ['KARTU','Kartu/flashcard'],['INTERNET_STABIL','Akses internet stabil'],
         ['PAPAN_TULIS','Papan tulis']].map(([val,lbl]) =>
        `<label class="pm-radio-row"><input type="checkbox" name="media_available" value="${val}" ${chk(v.media_available,val)}> ${lbl}</label>`
      ).join('')}
      <label class="pm-radio-row"><input type="checkbox" name="media_available" value="LAINNYA" id="kk-media-lain-chk" ${chk(v.media_available,'LAINNYA')}> Lainnya</label>
      <div id="kk-media-lain-detail" style="display:${(v.media_available??[]).includes('LAINNYA')?'block':'none'};margin:4px 0 0 24px">
        <input type="text" class="input input-sm" name="media_detail" placeholder="Jelaskan" value="${esc(v.media_detail??'')}" style="max-width:280px">
      </div>
    </div>

    `;
}

function collectKonteksKelas(form, subjectId, ay) {
    const radio = name => form.querySelector(`input[name="${name}"]:checked`)?.value ?? null;
    const checks = name => [...form.querySelectorAll(`input[name="${name}"]:checked`)].map(el => el.value);
    const txt = name => form.querySelector(`input[name="${name}"]`)?.value.trim() || null;
    const output = radio('expected_output');
    return {
        subject_id: subjectId,
        academic_year: ay,
        class_id: null,
        student_background: radio('student_background'),
        tech_access: radio('tech_access'),
        daily_language: txt('daily_language'),
        class_characteristics: checks('class_characteristics'),
        student_autonomy: radio('student_autonomy'),
        learning_constraints: checks('learning_constraints'),
        constraints_detail: txt('constraints_detail'),
        resources_available: checks('resources_available'),
        dudi_name: txt('dudi_name'),
        narasumber_detail: txt('narasumber_detail'),
        expected_output: output,
        output_detail: output === 'LAINNYA' ? txt('output_detail') : null,
        media_available: checks('media_available'),
        media_detail: txt('media_detail'),
    };
}

async function openKonteksKelasModal() {
    const ay = config?.current_academic_year ?? getCurrentAcademicYear();

    // Ambil mapel dari teaching_assignments — join ke public.subjects untuk nama
    // teaching_contexts.subject_id FK ke public.subjects (bukan core.subjects)
    let mySubjects = [];
    try {
        const { data: assignments, error } = await supabase
            .from('teaching_assignments')
            .select('subject_id, subject:subjects(subject_id, name, code)')
            .eq('school_id', currentUser.school_id)
            .eq('user_id', currentUser.user_id)
            .eq('academic_year', ay)
            .eq('is_active', true);
        if (!error && assignments?.length) {
            const seen = new Set();
            for (const a of assignments) {
                const s = a.subject;
                if (s && !seen.has(s.subject_id)) {
                    seen.add(s.subject_id);
                    mySubjects.push({ subject_id: s.subject_id, name: s.name, code: s.code });
                }
            }
            mySubjects.sort((a, b) => a.name.localeCompare(b.name, 'id'));
        }
    } catch (e) { /* */ }

    if (!mySubjects.length) {
        alert('Belum ada mata pelajaran yang diajar. Hubungi administrator untuk mengatur jadwal mengajar.');
        return;
    }

    let overlay = document.getElementById('konteks-kelas-modal');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'konteks-kelas-modal';
        overlay.className = 'modal-overlay';
        overlay.style.cssText = 'align-items:center';
        overlay.innerHTML = `
          <div class="sip-modal-panel" style="max-width:600px">
            <div class="sip-modal-scroll"><div id="kk-body"></div></div>
            <div class="sip-modal-footer" id="kk-footer" style="display:none">
              <button class="btn btn-secondary" id="kk-batal-btn">Batal</button>
              <button class="btn btn-primary" id="kk-simpan-btn">💾 Simpan Konteks</button>
            </div>
          </div>`;
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.style.display = 'none'; });
        document.body.appendChild(overlay);
    }

    const openForSubject = async (subj) => {
        overlay.style.display = 'flex';
        document.getElementById('kk-footer').style.display = 'none';
        document.getElementById('kk-body').innerHTML = '<p class="hint">Memuat konteks…</p>';
        let ctx = null;
        try { ctx = await getTeachingContext(currentUser.school_id, subj.subject_id, ay); } catch (e) { /* */ }

        const body = document.getElementById('kk-body');
        body.innerHTML = buildKonteksKelasHTML(ctx, subj.name, ay);

        // Kondisional: kendala lainnya
        body.querySelector('#kk-kendala-lain-chk').addEventListener('change', e => {
            body.querySelector('#kk-kendala-lain-detail').style.display = e.target.checked ? '' : 'none';
        });
        // Kondisional: DUDI
        body.querySelector('#kk-dudi-chk').addEventListener('change', e => {
            body.querySelector('#kk-dudi-detail').style.display = e.target.checked ? '' : 'none';
        });
        // Kondisional: narasumber
        body.querySelector('#kk-narasumber-chk').addEventListener('change', e => {
            body.querySelector('#kk-narasumber-detail').style.display = e.target.checked ? '' : 'none';
        });
        // Kondisional: output lainnya
        body.querySelectorAll('input[name="expected_output"]').forEach(r => {
            r.addEventListener('change', () => {
                body.querySelector('#kk-output-lain-detail').style.display =
                    body.querySelector('input[name="expected_output"][value="LAINNYA"]:checked') ? '' : 'none';
            });
        });
        // Kondisional: media lainnya
        body.querySelector('#kk-media-lain-chk').addEventListener('change', e => {
            body.querySelector('#kk-media-lain-detail').style.display = e.target.checked ? '' : 'none';
        });

        // Tampilkan footer dan wire tombol
        const footer = document.getElementById('kk-footer');
        footer.style.display = '';
        const batalBtn  = overlay.querySelector('#kk-batal-btn');
        const simpanBtn = overlay.querySelector('#kk-simpan-btn');
        batalBtn.replaceWith(batalBtn.cloneNode(true));
        simpanBtn.replaceWith(simpanBtn.cloneNode(true));
        overlay.querySelector('#kk-batal-btn').addEventListener('click', () => { overlay.style.display = 'none'; });
        overlay.querySelector('#kk-simpan-btn').addEventListener('click', async () => {
            const btn = overlay.querySelector('#kk-simpan-btn');
            btn.disabled = true; btn.textContent = '…';
            try {
                await saveTeachingContext(currentUser.school_id, collectKonteksKelas(body, subj.subject_id, ay));
                overlay.style.display = 'none';
            } catch (err) {
                alert(`Gagal menyimpan: ${fe(err)}`);
            } finally {
                btn.disabled = false; btn.textContent = '💾 Simpan Konteks';
            }
        });
    };

    if (mySubjects.length === 1) {
        await openForSubject(mySubjects[0]);
    } else {
        // Tampilkan dropdown pilih mapel
        overlay.style.display = 'flex';
        document.getElementById('kk-body').innerHTML = `
            <h2 style="margin:0 0 16px;font-size:18px">Pilih Mata Pelajaran</h2>
            <div style="display:flex;flex-direction:column;gap:8px">
              ${mySubjects.map(s => `
                <button class="btn btn-secondary kk-subj-btn" data-subj-id="${esc(s.subject_id)}" style="text-align:left">${esc(s.name)}</button>
              `).join('')}
            </div>
            <div style="margin-top:16px;text-align:right">
              <button class="btn btn-secondary" id="kk-pick-batal">Batal</button>
            </div>`;
        document.getElementById('kk-pick-batal').addEventListener('click', () => { overlay.style.display = 'none'; });
        document.getElementById('kk-body').querySelectorAll('.kk-subj-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const subj = mySubjects.find(s => s.subject_id === btn.dataset.subjId);
                if (subj) await openForSubject(subj);
            });
        });
    }
}

// ─── Modal: Konfirmasi Generate ───────────────────────────────
const PROFIL_LABEL = {
    instructional_intent: { label: 'Tujuan', map: { PKL:'Persiapan PKL', DUNIA_KERJA:'Persiapan Dunia Kerja', SERTIFIKASI:'Persiapan Sertifikasi', LKS:'Persiapan LKS', KONSEP_DASAR:'Penguatan Konsep Dasar', KEWIRAUSAHAAN:'Projek Kewirausahaan', UMKM:'UMKM Lokal', LITERASI:'Penguatan Literasi', NUMERASI:'Penguatan Numerasi', KOMUNIKASI:'Komunikasi dan Interaksi', PENGEMBANGAN_KARAKTER:'Pengembangan Karakter', PERSIAPAN_AN:'Persiapan Asesmen Nasional', LAINNYA:'Lainnya' } },
    assessment_philosophy: { label: 'Cara penilaian', map: { PRAKTIK:'Praktik', PORTOFOLIO:'Portofolio', PRESENTASI:'Presentasi', OBSERVASI:'Observasi', TES_TERTULIS:'Tes Tertulis', KOMBINASI:'Kombinasi' } },
    teaching_style: { label: 'Gaya mengajar', map: { GURU_DOMINAN:'Guru dominan', SISWA_DOMINAN:'Siswa dominan', SEIMBANG:'Seimbang' } },
    learning_model: { label: 'Model', map: { PBL_PROJECT:'Project-Based Learning', PBL_PROBLEM:'Problem-Based Learning', DISCOVERY:'Discovery Learning', CERAMAH_LATIHAN:'Ceramah + Latihan' } },
};
const KONTEKS_LABEL = {
    student_autonomy: { label: 'Kemandirian siswa', map: { SANGAT_MANDIRI:'Sangat mandiri', PERLU_ARAHAN:'Perlu arahan', SANGAT_BERGANTUNG:'Sangat bergantung' } },
    expected_output: { label: 'Output nyata', map: { LAPORAN:'Laporan tertulis', PRESENTASI:'Presentasi', PRODUK_FISIK:'Produk fisik', WEB_APLIKASI:'Website/Aplikasi', VIDEO:'Video', KONFIGURASI:'Konfigurasi', PROTOTYPE:'Prototype', POSTER:'Poster', SIMULASI:'Simulasi', LAINNYA:'Lainnya' } },
};
const MEDIA_LABEL = { PROYEKTOR:'Proyektor/TV', SPEAKER:'Speaker', LAPTOP_SISWA:'Laptop siswa', TABLET:'Tablet', KARTU:'Kartu', INTERNET_STABIL:'Internet stabil', PAPAN_TULIS:'Papan tulis', LAINNYA:'Lainnya' };

async function openConfirmGenerateModal(coreSubjectId, phaseId, subjName, ay) {
    let overlay = document.getElementById('confirm-generate-modal');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'confirm-generate-modal';
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `<div style="background:var(--color-surface);border-radius:var(--radius-lg);padding:24px;width:100%;max-width:520px;margin:auto;position:relative"><div id="cg-body"></div></div>`;
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.style.display = 'none'; });
        document.body.appendChild(overlay);
    }
    overlay.style.display = 'flex';
    document.getElementById('cg-body').innerHTML = '<p class="hint">Memuat…</p>';

    let profil = null, ctx = null;
    try { [profil, ctx] = await Promise.all([
        getTeacherProfile(currentUser.school_id),
        getTeachingContext(currentUser.school_id, coreSubjectId, ay),
    ]); } catch (e) { /* */ }

    const row = (label, val) => val
        ? `<div style="display:flex;gap:8px;font-size:13px;padding:3px 0"><span style="color:var(--color-success,#16a34a);flex-shrink:0">✓</span><span style="color:var(--color-text-muted);min-width:130px">${label}</span><span>${esc(val)}</span></div>`
        : '';

    let profilSection = '';
    if (profil) {
        const localCtx = [profil.local_city, profil.local_industry].filter(Boolean).join(' — ') || null;
        profilSection = `
        <div style="background:var(--color-bg-alt);border-radius:var(--radius);padding:12px;margin-bottom:12px">
          <p style="margin:0 0 8px;font-size:12px;font-weight:600;color:var(--color-text-muted);text-transform:uppercase">Profil Mengajar</p>
          ${Object.entries(PROFIL_LABEL).map(([k, {label, map}]) => row(label, map[profil[k]] ?? null)).join('')}
          ${localCtx ? row('Konteks lokal', localCtx) : ''}
          <button class="btn btn-secondary btn-sm" style="margin-top:10px;font-size:12px" id="cg-ubah-profil">⚙ Ubah Profil</button>
        </div>`;
    } else {
        profilSection = `
        <div style="background:var(--color-bg-alt);border-radius:var(--radius);padding:12px;margin-bottom:12px">
          <p style="margin:0 0 6px;font-size:13px">⚠️ Profil Mengajar belum diisi. AI akan menggunakan nilai default.</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-primary btn-sm" id="cg-isi-profil">Isi Sekarang</button>
            <button class="btn btn-secondary btn-sm" id="cg-lanjut-tanpa-profil">Lanjutkan Tanpa Profil</button>
          </div>
        </div>`;
    }

    let ctxSection = '';
    if (ctx) {
        const mediaList = (ctx.media_available ?? []).map(m => MEDIA_LABEL[m] ?? m).join(', ') || null;
        ctxSection = `
        <div style="background:var(--color-bg-alt);border-radius:var(--radius);padding:12px;margin-bottom:12px">
          <p style="margin:0 0 8px;font-size:12px;font-weight:600;color:var(--color-text-muted);text-transform:uppercase">Konteks Kelas</p>
          ${Object.entries(KONTEKS_LABEL).map(([k, {label, map}]) => row(label, map[ctx[k]] ?? null)).join('')}
          ${mediaList ? row('Media tersedia', mediaList) : ''}
          <button class="btn btn-secondary btn-sm" style="margin-top:10px;font-size:12px" id="cg-ubah-konteks">⚙ Ubah Konteks</button>
        </div>`;
    }

    document.getElementById('cg-body').innerHTML = `
        <h2 style="margin:0 0 16px;font-size:18px">Konfirmasi Generate ATP</h2>
        <p style="margin:0 0 12px;font-size:13px;color:var(--color-text-muted)">Mapel: <strong>${esc(subjName)}</strong> · ${esc(ay)}</p>
        ${profilSection}
        ${ctxSection}
        <div style="margin-bottom:12px;padding:12px;background:var(--color-bg-alt);border-radius:var(--radius)">
          <p style="margin:0 0 8px;font-size:12px;font-weight:600;color:var(--color-text-muted);text-transform:uppercase">Parameter JP — Satu Tahun Penuh</p>
          <div style="margin-bottom:8px">
            <p style="margin:0 0 6px;font-size:12px;color:var(--color-text-muted);font-weight:600">Semester 1</p>
            <div style="display:flex;gap:12px;flex-wrap:wrap">
              <label style="font-size:13px;display:flex;flex-direction:column;gap:4px">JP/minggu
                <input type="number" id="cg-jp-s1" value="4" min="1" max="10"
                  style="width:70px;padding:4px 8px;border:1px solid var(--color-border);border-radius:4px;font-size:14px;background:var(--color-surface)">
              </label>
              <label style="font-size:13px;display:flex;flex-direction:column;gap:4px">Minggu efektif
                <input type="number" id="cg-weeks-s1" value="18" min="1" max="26"
                  style="width:70px;padding:4px 8px;border:1px solid var(--color-border);border-radius:4px;font-size:14px;background:var(--color-surface)">
              </label>
            </div>
          </div>
          <div style="margin-bottom:8px">
            <p style="margin:0 0 6px;font-size:12px;color:var(--color-text-muted);font-weight:600">Semester 2</p>
            <div style="display:flex;gap:12px;flex-wrap:wrap">
              <label style="font-size:13px;display:flex;flex-direction:column;gap:4px">JP/minggu
                <input type="number" id="cg-jp-s2" value="4" min="1" max="10"
                  style="width:70px;padding:4px 8px;border:1px solid var(--color-border);border-radius:4px;font-size:14px;background:var(--color-surface)">
              </label>
              <label style="font-size:13px;display:flex;flex-direction:column;gap:4px">Minggu efektif
                <input type="number" id="cg-weeks-s2" value="16" min="1" max="26"
                  style="width:70px;padding:4px 8px;border:1px solid var(--color-border);border-radius:4px;font-size:14px;background:var(--color-surface)">
              </label>
            </div>
          </div>
          <p style="margin:8px 0 0;font-size:12px;color:var(--color-text-muted)">Total JP: <span id="cg-total-jp-preview">136</span> JP</p>
        </div>
        <div id="cg-generate-msg" style="display:none;font-size:13px;margin-bottom:8px"></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;padding-top:16px;border-top:1px solid var(--color-border)">
          <button class="btn btn-secondary" id="cg-batal-btn">Batal</button>
          <button class="btn btn-primary" id="cg-generate-btn">✨ Generate</button>
        </div>`;

    const body = document.getElementById('cg-body');
    body.querySelector('#cg-batal-btn').addEventListener('click', () => { overlay.style.display = 'none'; });
    body.querySelector('#cg-ubah-profil')?.addEventListener('click', () => { overlay.style.display = 'none'; openProfilMengajarModal(); });
    body.querySelector('#cg-ubah-konteks')?.addEventListener('click', () => { overlay.style.display = 'none'; openKonteksKelasModal(); });
    body.querySelector('#cg-isi-profil')?.addEventListener('click', () => { overlay.style.display = 'none'; openProfilMengajarModal(); });
    body.querySelector('#cg-lanjut-tanpa-profil')?.addEventListener('click', () => {
        body.querySelector('#cg-generate-btn')?.removeAttribute('disabled');
    });

    // Update total JP preview saat input berubah
    const updateTotalJP = () => {
        const jp1 = parseInt(document.getElementById('cg-jp-s1')?.value ?? '4', 10) || 0;
        const wk1 = parseInt(document.getElementById('cg-weeks-s1')?.value ?? '18', 10) || 0;
        const jp2 = parseInt(document.getElementById('cg-jp-s2')?.value ?? '4', 10) || 0;
        const wk2 = parseInt(document.getElementById('cg-weeks-s2')?.value ?? '16', 10) || 0;
        const el = document.getElementById('cg-total-jp-preview');
        if (el) el.textContent = String(jp1 * wk1 + jp2 * wk2);
    };
    body.querySelector('#cg-jp-s1')?.addEventListener('input', updateTotalJP);
    body.querySelector('#cg-weeks-s1')?.addEventListener('input', updateTotalJP);
    body.querySelector('#cg-jp-s2')?.addEventListener('input', updateTotalJP);
    body.querySelector('#cg-weeks-s2')?.addEventListener('input', updateTotalJP);

    body.querySelector('#cg-generate-btn')?.addEventListener('click', async () => {
        const btn   = body.querySelector('#cg-generate-btn');
        const msgEl = document.getElementById('cg-generate-msg');
        const jpPerWeekSem1  = parseInt(document.getElementById('cg-jp-s1')?.value ?? '4', 10);
        const weeksSem1      = parseInt(document.getElementById('cg-weeks-s1')?.value ?? '18', 10);
        const jpPerWeekSem2  = parseInt(document.getElementById('cg-jp-s2')?.value ?? '4', 10);
        const weeksSem2      = parseInt(document.getElementById('cg-weeks-s2')?.value ?? '16', 10);

        btn.disabled    = true;
        btn.textContent = '⏳ Generating…';
        msgEl.style.display = 'none';

        try {
            overlay.style.display = 'none';
            await generateATP({
                coreSubjectId,
                phaseId,
                subjectName: subjName,
                academicYear: ay,
                jpPerWeekSem1, weeksSem1,
                jpPerWeekSem2, weeksSem2,
            });
        } catch (e) {
            overlay.style.display = 'flex';
            msgEl.textContent   = `✗ ${e.message ?? 'Gagal menghubungi AI'}`;
            msgEl.style.color   = 'var(--color-danger)';
            msgEl.style.display = '';
            btn.disabled    = false;
            btn.textContent = '✨ Generate';
        }
    });
}

async function generateATP({ coreSubjectId, phaseId, subjectName, academicYear, jpPerWeekSem1, weeksSem1, jpPerWeekSem2, weeksSem2 }) {
    // Tampilkan loading overlay
    let loadingEl = document.getElementById('atp-loading-overlay');
    if (!loadingEl) {
        loadingEl = document.createElement('div');
        loadingEl.id = 'atp-loading-overlay';
        loadingEl.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:9999';
        loadingEl.innerHTML = `<div style="background:var(--color-surface);border-radius:12px;padding:32px 40px;text-align:center;max-width:320px">
            <div style="font-size:32px;margin-bottom:12px">✨</div>
            <p style="margin:0 0 6px;font-weight:600">Claude sedang menyusun ATP…</p>
            <p style="margin:0;font-size:13px;color:var(--color-text-muted)">Mohon tunggu, proses ini memerlukan 10–30 detik</p>
        </div>`;
        document.body.appendChild(loadingEl);
    }
    loadingEl.style.display = 'flex';

    try {
        const { data, error } = await supabase.functions.invoke('generate-atp-v2', {
            body: {
                school_id:        currentUser.school_id,
                core_subject_id:  coreSubjectId,
                phase_id:         phaseId,
                academic_year:    academicYear,
                jp_per_week_sem1: jpPerWeekSem1,
                weeks_sem1:       weeksSem1,
                jp_per_week_sem2: jpPerWeekSem2,
                weeks_sem2:       weeksSem2,
            },
        });

        loadingEl.style.display = 'none';

        if (error) throw new Error(error.message ?? 'Edge Function error');

        const result = data?.data ?? data;
        if (!result?.tujuan_pembelajaran?.length) throw new Error('Respons AI kosong atau format tidak valid');

        openATPReviewModal(result, data?.metadata ?? {}, {
            coreSubjectId, phaseId, subjectName, academicYear,
        });
    } catch (e) {
        loadingEl.style.display = 'none';
        throw e;
    }
}

function openATPReviewModal(result, metadata, params) {
    let overlay = document.getElementById('atp-review-modal');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'atp-review-modal';
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `<div style="background:var(--color-surface);border-radius:var(--radius-lg);padding:24px;width:100%;max-width:760px;margin:auto;position:relative;max-height:90vh;display:flex;flex-direction:column">
            <h2 style="margin:0 0 4px;font-size:18px">Hasil Generate ATP</h2>
            <p id="atp-review-meta" style="margin:0 0 16px;font-size:12px;color:var(--color-text-muted)"></p>
            <div id="atp-review-body" style="overflow-y:auto;flex:1"></div>
            <div id="atp-review-actions" style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;padding-top:16px;border-top:1px solid var(--color-border);flex-shrink:0"></div>
        </div>`;
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.style.display = 'none'; });
        document.body.appendChild(overlay);
    }

    const tps     = result.tujuan_pembelajaran ?? [];
    const catatan = result.catatan ?? '';

    const updateMeta = () => {
        document.getElementById('atp-review-meta').textContent =
            `${params.subjectName} · ${params.academicYear} · Total ${result.total_jp} JP`;
    };

    const viewRowHTML = (tp, i) => `
        <td style="padding:8px;vertical-align:top;color:var(--color-text-muted)">${esc(String(tp.nomor ?? ''))}</td>
        <td style="padding:8px;vertical-align:top">${esc(tp.deskripsi ?? '')}</td>
        <td style="padding:8px;vertical-align:top;color:var(--color-text-muted);font-size:12px">${esc(tp.elemen_cp ?? '')}</td>
        <td style="padding:8px;vertical-align:top;text-align:center;font-weight:600">${esc(String(tp.jp ?? ''))}</td>
        <td style="padding:8px;vertical-align:top;font-size:12px">${esc(tp.materi_pokok ?? '')}</td>
        <td style="padding:4px;vertical-align:top;width:36px">
            <button class="tp-edit-btn btn btn-secondary btn-sm" data-i="${i}" style="padding:2px 8px;font-size:11px">✏</button>
        </td>`;

    const editRowHTML = (tp, i) => `
        <td style="padding:4px;vertical-align:top;color:var(--color-text-muted)">${esc(String(tp.nomor ?? ''))}</td>
        <td style="padding:4px;vertical-align:top"><textarea class="input tp-deskripsi" rows="3" style="width:100%;font-size:12px;resize:vertical">${esc(tp.deskripsi ?? '')}</textarea></td>
        <td style="padding:4px;vertical-align:top"><input class="input tp-elemen" style="width:100%;font-size:12px" value="${esc(tp.elemen_cp ?? '')}"></td>
        <td style="padding:4px;vertical-align:top"><input class="input tp-jp" type="number" min="1" style="width:52px;font-size:12px" value="${esc(String(tp.jp ?? ''))}"></td>
        <td style="padding:4px;vertical-align:top"><input class="input tp-materi" style="width:100%;font-size:12px" value="${esc(tp.materi_pokok ?? '')}"></td>
        <td style="padding:4px;vertical-align:top">
            <button class="tp-save-btn btn btn-primary btn-sm" data-i="${i}" style="padding:2px 8px;font-size:11px;display:block;margin-bottom:4px">✓</button>
            <button class="tp-cancel-btn btn btn-secondary btn-sm" data-i="${i}" style="padding:2px 8px;font-size:11px;display:block">✕</button>
        </td>`;

    document.getElementById('atp-review-body').innerHTML = `
        <div style="overflow-x:auto;margin-bottom:12px">
            <table style="width:100%;border-collapse:collapse;font-size:13px">
                <thead>
                    <tr style="background:var(--color-bg-alt)">
                        <th style="padding:8px;text-align:left;border-bottom:2px solid var(--color-border);width:40px">No</th>
                        <th style="padding:8px;text-align:left;border-bottom:2px solid var(--color-border)">Deskripsi TP</th>
                        <th style="padding:8px;text-align:left;border-bottom:2px solid var(--color-border);width:140px">Elemen CP</th>
                        <th style="padding:8px;text-align:center;border-bottom:2px solid var(--color-border);width:50px">JP</th>
                        <th style="padding:8px;text-align:left;border-bottom:2px solid var(--color-border);width:160px">Materi Pokok</th>
                        <th style="padding:8px;text-align:center;border-bottom:2px solid var(--color-border);width:36px">Edit</th>
                    </tr>
                </thead>
                <tbody id="atp-tp-tbody">
                    ${tps.map((tp, i) => `<tr data-tp-index="${i}" style="border-bottom:1px solid var(--color-border)">${viewRowHTML(tp, i)}</tr>`).join('')}
                    <tr style="background:var(--color-bg-alt);font-weight:600">
                        <td colspan="3" style="padding:8px;text-align:right">Total JP</td>
                        <td id="atp-total-jp" style="padding:8px;text-align:center">${esc(String(result.total_jp ?? 0))}</td>
                        <td colspan="2"></td>
                    </tr>
                </tbody>
            </table>
        </div>
        ${catatan ? `<p style="font-size:12px;color:var(--color-text-muted);margin:0">📝 ${esc(catatan)}</p>` : ''}`;

    updateMeta();

    document.getElementById('atp-tp-tbody').addEventListener('click', e => {
        const editBtn   = e.target.closest('.tp-edit-btn');
        const saveBtn   = e.target.closest('.tp-save-btn');
        const cancelBtn = e.target.closest('.tp-cancel-btn');

        if (editBtn) {
            const i   = Number(editBtn.dataset.i);
            const row = document.querySelector(`#atp-tp-tbody tr[data-tp-index="${i}"]`);
            row.innerHTML = editRowHTML(tps[i], i);
        }

        if (saveBtn) {
            const i   = Number(saveBtn.dataset.i);
            const row = document.querySelector(`#atp-tp-tbody tr[data-tp-index="${i}"]`);
            tps[i].deskripsi    = row.querySelector('.tp-deskripsi').value.trim();
            tps[i].elemen_cp    = row.querySelector('.tp-elemen').value.trim();
            tps[i].jp           = Number(row.querySelector('.tp-jp').value) || tps[i].jp;
            tps[i].materi_pokok = row.querySelector('.tp-materi').value.trim();
            result.total_jp     = tps.reduce((s, t) => s + (Number(t.jp) || 0), 0);
            document.getElementById('atp-total-jp').textContent = String(result.total_jp);
            updateMeta();
            row.innerHTML = viewRowHTML(tps[i], i);
        }

        if (cancelBtn) {
            const i   = Number(cancelBtn.dataset.i);
            const row = document.querySelector(`#atp-tp-tbody tr[data-tp-index="${i}"]`);
            row.innerHTML = viewRowHTML(tps[i], i);
        }
    });

    document.getElementById('atp-review-actions').innerHTML = `
        <button class="btn btn-secondary" id="atp-regen-btn">🔄 Generate Ulang</button>
        <button class="btn btn-primary" id="atp-save-btn">💾 Simpan sebagai Draft</button>`;

    document.getElementById('atp-regen-btn').addEventListener('click', () => {
        overlay.style.display = 'none';
        openConfirmGenerateModal(params.coreSubjectId, params.phaseId, params.subjectName, params.academicYear);
    });

    document.getElementById('atp-save-btn').addEventListener('click', async () => {
        const saveBtn = document.getElementById('atp-save-btn');
        saveBtn.disabled    = true;
        saveBtn.textContent = '💾 Menyimpan…';
        try {
            await createTeacherDocument({
                schoolId:      currentUser.school_id,
                academicYear:  params.academicYear,
                documentType:  'ATP',
                coreSubjectId: params.coreSubjectId,
                phaseId:       params.phaseId,
                programId:     null,
                scopeType:     'SEMUA_KELAS',
                semester:      null,
                tpUrutan:      null,
                contentJson:   {
                    judul:               `ATP ${params.subjectName} ${params.academicYear}`,
                    tujuan_pembelajaran: result.tujuan_pembelajaran,
                    total_jp:            result.total_jp,
                    catatan:             result.catatan ?? '',
                    model_version:       metadata.model ?? 'claude-haiku-4-5',
                    generated_at:        metadata.generated_at ?? new Date().toISOString(),
                },
            });
            saveBtn.textContent = '✓ Tersimpan!';
            setTimeout(async () => {
                overlay.style.display = 'none';
                await loadPerangkatAjarDashboard();
            }, 900);
        } catch (e) {
            saveBtn.disabled    = false;
            saveBtn.textContent = '💾 Simpan sebagai Draft';
            alert(`Gagal menyimpan: ${e.message}`);
        }
    });

    overlay.style.display = 'flex';
}

// ── Program Tahunan (Prota) ───────────────────────────────────

function openConfirmProtaModal(coreSubjectId, phaseId, subjName, atpDocId, ay) {
    document.getElementById('confirm-prota-modal')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'confirm-prota-modal';
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'align-items:center';
    overlay.innerHTML = `
        <div class="modal-box" style="max-width:460px;width:100%">
            <h2 style="margin:0 0 4px;font-size:18px">Generate Program Tahunan</h2>
            <p style="margin:0 0 20px;font-size:13px;color:var(--color-text-muted)">${esc(subjName)} · ${esc(ay)}</p>

            <div style="display:grid;gap:14px">
                <label style="font-size:13px">
                    Minggu Efektif Semester 1
                    <input type="number" id="prota-weeks-sem1" class="input" value="18" min="10" max="24"
                        style="margin-top:4px;width:100%">
                </label>
                <label style="font-size:13px">
                    Minggu Efektif Semester 2
                    <input type="number" id="prota-weeks-sem2" class="input" value="16" min="10" max="24"
                        style="margin-top:4px;width:100%">
                </label>
            </div>

            <p id="prota-confirm-msg" style="display:none;font-size:13px;margin-top:12px"></p>

            <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px">
                <button class="btn btn-secondary" id="prota-cancel-btn">Batal</button>
                <button class="btn btn-primary" id="prota-generate-btn">✨ Generate</button>
            </div>
        </div>`;

    document.body.appendChild(overlay);
    overlay.style.display = 'flex';

    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.getElementById('prota-cancel-btn').addEventListener('click', () => overlay.remove());

    document.getElementById('prota-generate-btn').addEventListener('click', async () => {
        const msgEl    = document.getElementById('prota-confirm-msg');
        const btn      = document.getElementById('prota-generate-btn');
        const weeksSem1 = parseInt(document.getElementById('prota-weeks-sem1').value, 10);
        const weeksSem2 = parseInt(document.getElementById('prota-weeks-sem2').value, 10);

        if (!weeksSem1 || !weeksSem2 || weeksSem1 < 10 || weeksSem2 < 10) {
            msgEl.style.color   = 'var(--color-danger)';
            msgEl.textContent   = 'Minggu efektif harus antara 10–24.';
            msgEl.style.display = '';
            return;
        }

        btn.disabled    = true;
        btn.textContent = 'Menghubungi AI…';
        msgEl.style.display = 'none';
        overlay.remove();

        await generateProta({
            coreSubjectId, phaseId, subjectName: subjName,
            academicYear: ay, atpDocId, weeksSem1, weeksSem2,
        });
    });
}

async function generateProta({ coreSubjectId, phaseId, subjectName, academicYear, atpDocId, weeksSem1, weeksSem2 }) {
    const loadingOverlay = document.createElement('div');
    loadingOverlay.className = 'modal-overlay';
    loadingOverlay.style.cssText = 'align-items:center;justify-content:center';
    loadingOverlay.innerHTML = `
        <div style="background:var(--color-bg);border-radius:var(--radius);padding:32px 40px;text-align:center;max-width:320px">
            <div class="spinner" style="margin:0 auto 16px"></div>
            <p style="margin:0;font-size:14px;font-weight:600">Claude sedang menyusun Program Tahunan…</p>
            <p style="margin:8px 0 0;font-size:12px;color:var(--color-text-muted)">Mungkin butuh 15–30 detik</p>
        </div>`;
    document.body.appendChild(loadingOverlay);
    loadingOverlay.style.display = 'flex';

    try {
        const { data, error } = await supabase.functions.invoke('generate-prota', {
            body: {
                school_id:       currentUser.school_id,
                academic_year:   academicYear,
                core_subject_id: coreSubjectId,
                phase_id:        phaseId,
                atp_doc_id:      atpDocId,
                weeks_sem1:      weeksSem1,
                weeks_sem2:      weeksSem2,
            },
        });
        loadingOverlay.remove();
        if (error) throw error;
        if (!data?.success) throw new Error(data?.error ?? 'Gagal generate Prota');
        openProtaReviewModal(data.data, data.metadata, { coreSubjectId, phaseId, subjectName, academicYear, atpDocId, weeksSem1, weeksSem2 });
    } catch (err) {
        loadingOverlay.remove();
        alert(`Gagal generate Prota: ${err.message ?? err}`);
    }
}

function openProtaReviewModal(result, metadata, params) {
    document.getElementById('prota-review-modal')?.remove();

    const renderDistribusi = (distribusi) => distribusi.map(row => {
        const isPas = row.keterangan === 'PAS' || row.keterangan === 'PAT' || row.keterangan === 'CADANGAN';
        return `<tr style="border-bottom:1px solid var(--color-border);${isPas ? 'background:var(--color-bg-alt);font-style:italic;color:var(--color-text-muted)' : ''}">
            <td style="padding:7px 8px;text-align:center;white-space:nowrap">${row.minggu}</td>
            <td style="padding:7px 8px">${esc(row.materi ?? '')}</td>
            <td style="padding:7px 8px;text-align:center">${row.jp > 0 ? row.jp : '—'}</td>
            <td style="padding:7px 8px;text-align:center;font-size:11px;color:var(--color-text-muted)">${esc(row.keterangan ?? '')}</td>
        </tr>`;
    }).join('');

    const tableHeader = `<thead><tr style="background:var(--color-bg-alt)">
        <th style="padding:8px;text-align:center;border-bottom:2px solid var(--color-border);width:60px">Minggu</th>
        <th style="padding:8px;text-align:left;border-bottom:2px solid var(--color-border)">Materi / TP</th>
        <th style="padding:8px;text-align:center;border-bottom:2px solid var(--color-border);width:50px">JP</th>
        <th style="padding:8px;text-align:center;border-bottom:2px solid var(--color-border);width:90px">Keterangan</th>
    </tr></thead>`;

    const overlay = document.createElement('div');
    overlay.id = 'prota-review-modal';
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'align-items:flex-start;padding:24px 16px;overflow-y:auto';
    overlay.innerHTML = `
        <div class="modal-box" style="max-width:700px;width:100%">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:16px;gap:8px">
                <div>
                    <h2 style="margin:0 0 4px;font-size:18px">Hasil Generate Program Tahunan</h2>
                    <p style="margin:0;font-size:13px;color:var(--color-text-muted)">${esc(params.subjectName)} · ${esc(params.academicYear)}</p>
                </div>
                <button class="btn btn-secondary btn-sm" id="prota-close-btn" style="flex-shrink:0">✕</button>
            </div>

            ${result.judul ? `<p style="margin:0 0 16px;font-size:14px;font-weight:600">${esc(result.judul)}</p>` : ''}

            <h3 style="font-size:14px;margin:0 0 8px">Semester 1 — ${result.semester_1?.minggu_efektif ?? params.weeksSem1} minggu efektif</h3>
            <div style="overflow-x:auto;margin-bottom:20px">
                <table style="width:100%;border-collapse:collapse;font-size:13px">
                    ${tableHeader}
                    <tbody>${renderDistribusi(result.semester_1?.distribusi ?? [])}</tbody>
                </table>
            </div>

            <h3 style="font-size:14px;margin:0 0 8px">Semester 2 — ${result.semester_2?.minggu_efektif ?? params.weeksSem2} minggu efektif</h3>
            <div style="overflow-x:auto;margin-bottom:20px">
                <table style="width:100%;border-collapse:collapse;font-size:13px">
                    ${tableHeader}
                    <tbody>${renderDistribusi(result.semester_2?.distribusi ?? [])}</tbody>
                </table>
            </div>

            ${result.catatan ? `<p style="margin:0 0 16px;font-size:12px;color:var(--color-text-muted);background:var(--color-bg-alt);padding:10px 12px;border-radius:6px">${esc(result.catatan)}</p>` : ''}

            <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap" id="prota-review-actions">
                <button class="btn btn-secondary" id="prota-regen-btn">🔄 Generate Ulang</button>
                <button class="btn btn-primary" id="prota-save-btn">💾 Simpan sebagai Draft</button>
            </div>
            <p id="prota-save-msg" style="display:none;font-size:13px;margin-top:8px;text-align:right"></p>
        </div>`;

    document.body.appendChild(overlay);
    overlay.style.display = 'flex';

    document.getElementById('prota-close-btn').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    document.getElementById('prota-regen-btn').addEventListener('click', () => {
        overlay.remove();
        openConfirmProtaModal(params.coreSubjectId, params.phaseId, params.subjectName, params.atpDocId, params.academicYear);
    });

    document.getElementById('prota-save-btn').addEventListener('click', async () => {
        const saveBtn = document.getElementById('prota-save-btn');
        const msgEl   = document.getElementById('prota-save-msg');
        saveBtn.disabled    = true;
        saveBtn.textContent = '💾 Menyimpan…';
        try {
            await createTeacherDocument({
                schoolId:      currentUser.school_id,
                academicYear:  params.academicYear,
                documentType:  'PROGRAM_TAHUNAN',
                coreSubjectId: params.coreSubjectId,
                phaseId:       params.phaseId,
                programId:     null,
                scopeType:     'SEMUA_KELAS',
                semester:      null,
                tpUrutan:      null,
                contentJson:   {
                    judul:        result.judul,
                    semester_1:   result.semester_1,
                    semester_2:   result.semester_2,
                    catatan:      result.catatan ?? '',
                    model_version: metadata?.model ?? 'claude-haiku-4-5',
                    generated_at:  metadata?.generated_at ?? new Date().toISOString(),
                    atp_doc_id:    metadata?.atp_doc_id ?? params.atpDocId,
                },
            });
            saveBtn.textContent     = '✓ Tersimpan!';
            msgEl.style.color       = 'var(--color-success,#16a34a)';
            msgEl.textContent       = '✓ Program Tahunan berhasil disimpan sebagai Draft.';
            msgEl.style.display     = '';
            setTimeout(async () => {
                overlay.remove();
                await loadPerangkatAjarDashboard();
            }, 900);
        } catch (err) {
            saveBtn.disabled    = false;
            saveBtn.textContent = '💾 Simpan sebagai Draft';
            msgEl.style.color   = 'var(--color-danger)';
            msgEl.textContent   = `✗ ${fe(err)}`;
            msgEl.style.display = '';
        }
    });
}

// ── ATP Picker & Upload ──────────────────────────────────────

function openGenerateATPPicker(coreSubjects, phases, onSubmit) {
    document.getElementById('generate-atp-picker-modal')?.remove();

    const subjectOptions = coreSubjects.map(s =>
        `<option value="${esc(s.subject_id)}">${esc(s.name)}</option>`
    ).join('');
    const phaseOptions = phases.map(p =>
        `<option value="${esc(p.phase_id)}">${esc(p.name)}</option>`
    ).join('');

    const picker = document.createElement('div');
    picker.id = 'generate-atp-picker-modal';
    picker.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:1000';
    picker.innerHTML = `
        <div style="background:var(--color-bg);border-radius:12px;padding:24px;width:min(400px,90vw);max-height:90vh;overflow-y:auto">
            <h3 style="margin:0 0 16px">Pilih Mata Pelajaran</h3>
            ${coreSubjects.length === 0 ? '<p style="color:var(--color-danger)">Tidak ada mata pelajaran tersedia.</p>' : ''}
            <div class="field" style="margin-bottom:12px">
                <label for="atp-picker-subject">Mata Pelajaran</label>
                <select id="atp-picker-subject" class="input">${subjectOptions}</select>
            </div>
            <div class="field" style="margin-bottom:16px">
                <label for="atp-picker-phase">Fase</label>
                <select id="atp-picker-phase" class="input">${phaseOptions}</select>
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end">
                <button id="atp-picker-cancel" class="btn btn-secondary">Batal</button>
                <button id="atp-picker-submit" class="btn btn-primary" ${coreSubjects.length === 0 ? 'disabled' : ''}>Lanjut →</button>
            </div>
        </div>`;

    document.body.appendChild(picker);

    const close = () => picker.remove();
    document.getElementById('atp-picker-cancel').onclick = close;
    picker.addEventListener('click', e => { if (e.target === picker) close(); });

    document.getElementById('atp-picker-submit').onclick = () => {
        const subjId  = document.getElementById('atp-picker-subject').value;
        const phaseId = document.getElementById('atp-picker-phase').value;
        const subjName = coreSubjects.find(s => s.subject_id === subjId)?.name ?? '';
        close();
        onSubmit(subjId, phaseId, subjName);
    };
}

async function uploadATPFlow(coreSubjects, phases, ay) {
    const fileInput = document.createElement('input');
    fileInput.type   = 'file';
    fileInput.accept = '.pdf,.docx';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);

    fileInput.onchange = () => {
        const file = fileInput.files?.[0];
        fileInput.remove();
        if (!file) return;

        if (file.size > 10 * 1024 * 1024) {
            alert('Ukuran file melebihi batas 10MB. Harap pilih file yang lebih kecil.');
            return;
        }
        const isPdf  = file.name.toLowerCase().endsWith('.pdf');
        const isDocx = file.name.toLowerCase().endsWith('.docx');
        if (!isPdf && !isDocx) {
            alert('Format file tidak didukung. Gunakan PDF atau DOCX.');
            return;
        }

        const fileType = isPdf ? 'pdf' : 'docx';
        const fileName = file.name;

        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onerror = () => { alert('Gagal membaca file. Coba lagi.'); };
        reader.onload  = () => {
            const base64 = reader.result.split(',')[1];

            openGenerateATPPicker(coreSubjects, phases, async (subjId, phaseId, subjName, semester) => {
                const loadingEl = document.createElement('div');
                loadingEl.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:2000';
                loadingEl.innerHTML = `
                    <div style="background:var(--color-bg);border-radius:12px;padding:32px 24px;text-align:center;max-width:360px">
                        <div style="font-size:36px;margin-bottom:12px">📄</div>
                        <p style="margin:0 0 4px;font-weight:600">Claude sedang membaca dokumen ATP Anda…</p>
                        <p style="margin:0;font-size:13px;color:var(--color-text-muted)">estimasi 15–30 detik</p>
                    </div>`;
                document.body.appendChild(loadingEl);

                try {
                    const { data, error } = await supabase.functions.invoke('parse-atp', {
                        body: {
                            school_id:       currentUser.school_id,
                            file_base64:     base64,
                            file_type:       fileType,
                            file_name:       fileName,
                            core_subject_id: subjId,
                            phase_id:        phaseId,
                        },
                    });
                    loadingEl.remove();
                    if (error) throw new Error(error.message ?? 'Edge Function error');
                    if (!data?.success) throw new Error(data?.error ?? 'Gagal membaca dokumen');
                    openATPReviewModal(data.data, data.metadata ?? {}, {
                        coreSubjectId: subjId,
                        phaseId,
                        subjectName:   subjName,
                        academicYear:  ay,
                        semester,
                    });
                } catch (e) {
                    loadingEl.remove();
                    alert('Gagal membaca dokumen: ' + (e?.message ?? 'Error tidak diketahui'));
                }
            });
        };
    };

    fileInput.click();
}

// ═══════════════════════════════════════════════════════
// TAB PENILAIAN — logika sub-tab di dalam tab Jurnal
// ═══════════════════════════════════════════════════════

let _penilaianInit = false;
let _penilaianCtx  = { kelasId: null, subjectId: null, year: null, semester: null };
let _penilaianTpList = [];


async function initPenilaianTab() {
    if (_penilaianInit) { await loadPenilaianContext(); return; }
    _penilaianInit = true;

    // ── Switching sub-tab jurnal (Catatan ↔ Penilaian) ──
    document.querySelectorAll('.jurnal-sub-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const sub = btn.dataset.jurnalSub;
            document.querySelectorAll('.jurnal-sub-btn').forEach(b => {
                const active = b.dataset.jurnalSub === sub;
                b.style.fontWeight   = active ? '600' : '400';
                b.style.borderBottom = active
                    ? '2px solid var(--color-primary)'
                    : '2px solid transparent';
                b.style.color = active
                    ? 'var(--color-primary)'
                    : 'var(--color-text-muted)';
            });
            document.getElementById('jurnal-sub-catatan').style.display =
                sub === 'catatan' ? '' : 'none';
            document.getElementById('jurnal-sub-penilaian').style.display =
                sub === 'penilaian' ? '' : 'none';
            if (sub === 'penilaian') await loadPenilaianContext();
        });
    });

    // ── Switching sub-sub-tab penilaian (Setup | Input | Hasil) ──
    document.querySelectorAll('.penilaian-sub-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const sub = btn.dataset.penilaianSub;
            document.querySelectorAll('.penilaian-sub-btn').forEach(b => {
                const active = b.dataset.penilaianSub === sub;
                b.style.background = active
                    ? 'var(--color-primary)'
                    : 'var(--color-surface-alt)';
                b.style.color = active ? '#fff' : 'var(--color-text)';
            });
            ['setup', 'input', 'hasil'].forEach(s => {
                document.getElementById(`penilaian-sub-${s}`).style.display =
                    s === sub ? '' : 'none';
            });
            if (sub === 'input') await initPenilaianInputTab();
            if (sub === 'hasil') await initPenilaianHasilTab();
        });
    });

    // ── Context selectors ──
    const selKelas = document.getElementById('penilaian-kelas-select');
    const selMapel = document.getElementById('penilaian-mapel-select');
    const selYear  = document.getElementById('penilaian-year-select');
    const selSem   = document.getElementById('penilaian-semester-select');

    // Populate tahun ajaran (tahun lalu, tahun ini, tahun depan)
    const yr = new Date().getFullYear();
    [yr - 1, yr, yr + 1].forEach(y => {
        const opt = document.createElement('option');
        opt.value = `${y}/${y + 1}`;
        opt.textContent = `${y}/${y + 1}`;
        if (y === yr) opt.selected = true;
        selYear.appendChild(opt);
    });
    _penilaianCtx.year     = selYear.value;
    _penilaianCtx.semester = parseInt(selSem.value);

    // Populate kelas dari teaching assignments guru
    await loadPenilaianKelas(selKelas);

    selKelas.addEventListener('change', async () => {
        _penilaianCtx.kelasId = selKelas.value || null;
        await loadPenilaianMapel(selMapel, selKelas.value);
        _penilaianCtx.subjectId = null;
        await onPenilaianContextChange();
    });
    selMapel.addEventListener('change', async () => {
        _penilaianCtx.subjectId = selMapel.value || null;
        await onPenilaianContextChange();
    });
    selYear.addEventListener('change', async () => {
        _penilaianCtx.year = selYear.value || null;
        await onPenilaianContextChange();
    });
    selSem.addEventListener('change', async () => {
        _penilaianCtx.semester = parseInt(selSem.value) || null;
        await onPenilaianContextChange();
    });

    // ── Setup TP: tombol tambah ──
    document.getElementById('penilaian-add-tp').addEventListener('click', () => {
        openTpForm(null);
    });

    // ── Setup TP: download template Excel ──
    document.getElementById('penilaian-download-template').addEventListener('click', () => {
        downloadCpTpTemplate();
    });

    // ── Setup TP: upload CP & TP via Excel ──
    document.getElementById('penilaian-upload-btn').addEventListener('click', () => {
        document.getElementById('penilaian-upload-input').click();
    });
    document.getElementById('penilaian-upload-input').addEventListener('change', async e => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        await parseCpTpExcel(file);
    });
    document.getElementById('upload-cancel-btn').addEventListener('click', () => {
        document.getElementById('penilaian-upload-modal').style.display = 'none';
    });
    document.getElementById('upload-modal-backdrop').addEventListener('click', () => {
        document.getElementById('penilaian-upload-modal').style.display = 'none';
    });

    // ── Setup TP: tombol batal di form ──
    document.getElementById('penilaian-cancel-tp').addEventListener('click', () => {
        document.getElementById('penilaian-tp-form-card').style.display = 'none';
        document.getElementById('penilaian-cp-panel').style.display        = 'none';
        document.getElementById('penilaian-cp-elemen-picker').style.display = 'none';
    });

    // ── Setup TP: berlaku_untuk toggle ──
    document.getElementById('penilaian-tp-berlaku').addEventListener('change', e => {
        document.getElementById('penilaian-tp-kelas-list').style.display =
            e.target.value === 'KELAS_TERTENTU' ? '' : 'none';
    });

    // ── Setup TP: tambah baris KKTP ──
    document.getElementById('penilaian-add-kktp').addEventListener('click', () => {
        addKktpRow();
    });

    // ── Setup TP: simpan ──
    document.getElementById('penilaian-save-tp').addEventListener('click', async () => {
        await saveTp();
    });

    // ── Grading settings: formatif toggle ──
    document.getElementById('penilaian-formatif-included')
        .addEventListener('change', e => {
            document.getElementById('penilaian-formatif-options').style.display =
                e.target.checked ? '' : 'none';
        });

    // ── Grading settings: metode toggle ──
    document.getElementById('penilaian-metode-formatif')
        .addEventListener('change', e => {
            document.getElementById('penilaian-bobot-row').style.display =
                e.target.value === 'BOBOT' ? 'flex' : 'none';
        });

    // ── Grading settings: simpan ──
    document.getElementById('penilaian-save-settings')
        .addEventListener('click', async () => {
            await saveGradingSettings();
        });

    // ── Input Nilai: tombol simpan ──
    document.getElementById('penilaian-save-nilai')
        .addEventListener('click', async () => {
            await saveInputNilai();
        });
}

async function loadPenilaianContext() {
    const { kelasId, subjectId, year, semester } = _penilaianCtx;
    if (kelasId && subjectId && year && semester) {
        await loadTpList();
        await loadGradingSettings();
    }
}

async function loadPenilaianKelas(selEl) {
    selEl.innerHTML = '<option value="">— Pilih Kelas —</option>';
    try {
        const { data, error } = await supabase
            .from('teaching_assignments')
            .select('class_id, classes(name)')
            .eq('school_id', currentUser.school_id)
            .eq('user_id', currentUser.user_id)
            .eq('is_active', true)
            .order('class_id');
        if (error) throw error;
        const seen = new Set();
        (data || []).forEach(row => {
            if (seen.has(row.class_id)) return;
            seen.add(row.class_id);
            const opt = document.createElement('option');
            opt.value = row.class_id;
            opt.textContent = row.classes?.name || row.class_id;
            selEl.appendChild(opt);
        });
    } catch (e) {
        console.error('loadPenilaianKelas:', e);
        showPenilaianMsg('settings', 'Gagal memuat daftar kelas. Coba muat ulang halaman.', 'error');
    }
}

async function loadPenilaianMapel(selEl, kelasId) {
    selEl.innerHTML = '<option value="">— Pilih Mapel —</option>';
    if (!kelasId) return;
    try {
        const { data, error } = await supabase
            .from('teaching_assignments')
            .select('subject_id, subjects(name)')
            .eq('school_id', currentUser.school_id)
            .eq('class_id', kelasId)
            .eq('user_id', currentUser.user_id)
            .eq('is_active', true);
        if (error) throw error;
        const seen = new Set();
        (data || []).forEach(row => {
            if (seen.has(row.subject_id)) return;
            seen.add(row.subject_id);
            const opt = document.createElement('option');
            opt.value = row.subject_id;
            opt.textContent = row.subjects?.name || row.subject_id;
            selEl.appendChild(opt);
        });
    } catch (e) {
        console.error('loadPenilaianMapel:', e);
        showPenilaianMsg('settings', 'Gagal memuat daftar mapel. Coba muat ulang halaman.', 'error');
    }
}

async function onPenilaianContextChange() {
    const { kelasId, subjectId, year, semester } = _penilaianCtx;
    if (!kelasId || !subjectId || !year || !semester) {
        document.getElementById('penilaian-tp-list').innerHTML =
            '<p class="hint">Pilih kelas dan mapel untuk melihat TP.</p>';
        return;
    }
    await loadTpList();
    await loadGradingSettings();
    if (document.getElementById('penilaian-sub-input')?.style.display !== 'none') {
        await initPenilaianInputTab();
    }
}

async function loadTpList() {
    const { subjectId, year, semester } = _penilaianCtx;
    const listEl = document.getElementById('penilaian-tp-list');
    listEl.innerHTML = '<p class="hint">Memuat…</p>';
    try {
        const { data, error } = await supabase
            .from('learning_objectives')
            .select('*')
            .eq('school_id', currentUser.school_id)
            .eq('subject_id', subjectId)
            .eq('academic_year', year)
            .eq('semester', semester)
            .eq('is_active', true)
            .order('urutan');
        if (error) throw error;
        _penilaianTpList = data || [];
        renderTpList(listEl);
    } catch (e) {
        listEl.innerHTML = `<p class="hint" style="color:var(--color-danger)">Gagal memuat TP: ${esc(e.message)}</p>`;
    }
}

function renderTpList(listEl) {
    if (!_penilaianTpList.length) {
        listEl.innerHTML = '<p class="hint">Belum ada TP. Klik "+ Tambah TP" untuk mulai.</p>';
        return;
    }
    listEl.innerHTML = _penilaianTpList.map(tp => `
        <div class="tp-row" style="display:flex; justify-content:space-between;
             align-items:flex-start; padding:10px 0;
             border-bottom:1px solid var(--color-border)">
            <div>
                <strong>${esc(tp.kode_tp)}</strong>
                <span style="margin-left:8px; color:var(--color-text-muted);
                             font-size:13px">${esc(tp.deskripsi_tp)}</span>
            </div>
            <div style="display:flex; gap:6px; flex-shrink:0">
                <button class="btn btn-ghost btn-sm"
                        onclick="openTpForm('${esc(tp.learning_objective_id)}')">
                    Edit
                </button>
                <button class="btn btn-ghost btn-sm"
                        style="color:var(--color-danger)"
                        onclick="deleteTp('${esc(tp.learning_objective_id)}')">
                    Hapus
                </button>
            </div>
        </div>
    `).join('');
}

async function openTpForm(loId) {
    const card  = document.getElementById('penilaian-tp-form-card');
    const title = document.getElementById('penilaian-tp-form-title');
    document.getElementById('penilaian-tp-id').value        = loId || '';
    document.getElementById('penilaian-tp-kode').value      = '';
    document.getElementById('penilaian-tp-deskripsi').value = '';
    document.getElementById('penilaian-tp-urutan').value    = _penilaianTpList.length + 1;
    document.getElementById('penilaian-tp-berlaku').value   = 'SEMUA_KELAS';
    document.getElementById('penilaian-tp-kelas-list').style.display = 'none';
    document.getElementById('penilaian-kktp-rows').innerHTML = '';

    let preselectedElementId = null;
    if (loId) {
        title.textContent = 'Edit Tujuan Pembelajaran';
        const tp = _penilaianTpList.find(t => t.learning_objective_id === loId);
        if (tp) {
            document.getElementById('penilaian-tp-kode').value      = tp.kode_tp;
            document.getElementById('penilaian-tp-deskripsi').value  = tp.deskripsi_tp;
            document.getElementById('penilaian-tp-urutan').value     = tp.urutan;
            document.getElementById('penilaian-tp-berlaku').value    = tp.berlaku_untuk;
            if (tp.berlaku_untuk === 'KELAS_TERTENTU') {
                document.getElementById('penilaian-tp-kelas-list').style.display = '';
            }
            preselectedElementId = tp.element_id || null;
        }
        await loadKktpRows(loId);
    } else {
        title.textContent = 'Tambah Tujuan Pembelajaran';
        addKktpRow();
    }

    await populateTpKelasCheckboxes(loId);
    card.style.display = '';
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Muat panel CP secara async (tidak memblokir tampilan form)
    loadCpPanel(loId, preselectedElementId);
}

async function loadCpPanel(loId, preselectedElementId) {
    const panel   = document.getElementById('penilaian-cp-panel');
    const loading = document.getElementById('cp-panel-loading');
    const found   = document.getElementById('cp-panel-found');
    const notFound= document.getElementById('cp-panel-not-found');
    const picker  = document.getElementById('penilaian-cp-elemen-picker');
    const warning = document.getElementById('penilaian-duplikat-warning');

    // Reset state
    panel.style.display   = '';
    loading.style.display = '';
    found.style.display   = 'none';
    notFound.style.display= 'none';
    picker.style.display  = 'none';
    warning.style.display = 'none';
    document.getElementById('penilaian-tp-element-id').innerHTML =
        '<option value="">— Tidak dikaitkan ke elemen CP —</option>';

    try {
        const { kelasId, subjectId } = _penilaianCtx;
        if (!kelasId || !subjectId) {
            panel.style.display = 'none';
            return;
        }

        const ctx = await getClassProgramContext(kelasId);
        const cp  = await getCpForSubject(subjectId, ctx.program_code, ctx.grade_level);

        loading.style.display = 'none';

        if (!cp || !cp.found) {
            notFound.style.display = '';
            return;
        }

        // Isi header
        const badge = document.getElementById('cp-panel-badge');
        badge.textContent = cp.confidence;
        badge.style.background = cp.confidence === 'HIGH'
            ? 'var(--color-primary)'
            : cp.confidence === 'MEDIUM' ? '#f59e0b' : '#ef4444';
        document.getElementById('cp-panel-subject-name').textContent = cp.core_subject_name || '';
        document.getElementById('cp-panel-bskap').textContent = cp.bskap_ref ? `(${cp.bskap_ref})` : '';
        document.getElementById('cp-panel-umum').textContent  = cp.cp_umum || '';

        // Render daftar elemen (collapsed per elemen)
        const elemenList = document.getElementById('cp-panel-elemen-list');
        elemenList.innerHTML = '';
        (cp.elemen || []).forEach(el => {
            const item = document.createElement('div');
            item.style.cssText = 'border-top:1px solid var(--color-border); padding:6px 0';
            item.innerHTML = `
                <div style="display:flex; align-items:center; gap:6px; cursor:pointer"
                     onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display?'':'block'">
                    <span style="font-size:12px; color:var(--color-text-muted)">▶</span>
                    <span style="font-size:13px; font-weight:600">${esc(el.nama_elemen)}</span>
                </div>
                <p style="display:none; font-size:12px; color:var(--color-text-muted); margin:4px 0 0 18px; line-height:1.5">${esc(el.deskripsi_cp || '')}</p>
            `;
            elemenList.appendChild(item);
        });

        found.style.display = '';

        // Isi dropdown picker
        const sel = document.getElementById('penilaian-tp-element-id');
        (cp.elemen || []).forEach(el => {
            const opt = document.createElement('option');
            opt.value       = el.element_id;
            opt.textContent = `${el.element_order}. ${el.nama_elemen}`;
            sel.appendChild(opt);
        });
        if (preselectedElementId) sel.value = preselectedElementId;

        picker.style.display = '';

        // Event: cek duplikat saat elemen dipilih
        sel.onchange = async () => {
            warning.style.display = 'none';
            if (!sel.value) return;
            try {
                const dupes = await checkElementDuplicate(
                    sel.value, currentUser.school_id, loId || null
                );
                if (dupes.length > 0) {
                    const lines = dupes.map(d =>
                        `• ${esc(d.guru_nama)} — ${esc(d.kelas_nama)} — ${esc(d.kode_tp)}`
                    ).join('<br>');
                    warning.innerHTML = `⚠️ Elemen ini sudah digunakan di TP lain:<br>${lines}`;
                    warning.style.display = '';
                }
            } catch (e) {
                console.error('checkElementDuplicate:', e);
            }
        };

        // Jika mode Edit dan sudah ada element_id, langsung cek duplikat
        if (preselectedElementId && sel.value) sel.dispatchEvent(new Event('change'));

    } catch (e) {
        console.error('loadCpPanel:', e);
        loading.style.display = 'none';
        notFound.style.display = '';
    }
}

async function populateTpKelasCheckboxes(loId) {
    const container = document.getElementById('penilaian-tp-kelas-checkboxes');
    container.innerHTML = '';
    if (!_penilaianCtx.subjectId) return;
    try {
        const { data } = await supabase
            .from('teaching_assignments')
            .select('class_id, classes(name)')
            .eq('school_id', currentUser.school_id)
            .eq('subject_id', _penilaianCtx.subjectId)
            .eq('user_id', currentUser.user_id)
            .eq('is_active', true);

        let selectedIds = new Set();
        if (loId) {
            const { data: loc } = await supabase
                .from('learning_objective_classes')
                .select('class_id')
                .eq('learning_objective_id', loId);
            (loc || []).forEach(r => selectedIds.add(r.class_id));
        }

        (data || []).forEach(row => {
            const label = document.createElement('label');
            label.style.cssText = 'display:flex; align-items:center; gap:6px; cursor:pointer';
            label.innerHTML = `
                <input type="checkbox" value="${esc(row.class_id)}"
                       ${selectedIds.has(row.class_id) ? 'checked' : ''}>
                ${esc(row.classes?.name || row.class_id)}
            `;
            container.appendChild(label);
        });
    } catch (e) {
        console.error('populateTpKelasCheckboxes:', e);
        showPenilaianMsg('tp', 'Gagal memuat daftar kelas untuk TP. Coba tutup dan buka kembali form.', 'error');
    }
}

async function loadKktpRows(loId) {
    const container = document.getElementById('penilaian-kktp-rows');
    container.innerHTML = '';
    try {
        const { data } = await supabase
            .from('assessment_criteria')
            .select('*')
            .eq('learning_objective_id', loId)
            .eq('school_id', currentUser.school_id)
            .order('batas_bawah');
        (data || []).forEach(c => addKktpRow(c));
    } catch (e) {
        console.error('loadKktpRows:', e);
        showPenilaianMsg('tp', 'Gagal memuat kriteria KKTP. Coba tutup dan buka kembali form.', 'error');
    }
}

function addKktpRow(criterion = null) {
    const container = document.getElementById('penilaian-kktp-rows');
    const row = document.createElement('div');
    row.className = 'kktp-row';
    row.dataset.criterionId = criterion?.criterion_id || '';
    row.style.cssText = 'display:flex; gap:8px; align-items:center; margin-bottom:8px';
    row.innerHTML = `
        <input type="number" class="input kktp-bawah" placeholder="Batas bawah"
               min="0" max="100" step="0.01" value="${criterion?.batas_bawah ?? ''}"
               style="width:100px">
        <span style="color:var(--color-text-muted)">–</span>
        <input type="number" class="input kktp-atas" placeholder="Batas atas"
               min="0" max="100" step="0.01" value="${criterion?.batas_atas ?? ''}"
               style="width:100px">
        <input type="text" class="input kktp-predikat" placeholder="Predikat"
               value="${esc(criterion?.predikat || '')}" style="flex:1">
        <input type="text" class="input kktp-keterangan" placeholder="Keterangan (opsional)"
               value="${esc(criterion?.keterangan || '')}" style="flex:2">
        <button type="button" class="btn btn-ghost btn-sm"
                style="color:var(--color-danger); flex-shrink:0"
                onclick="this.closest('.kktp-row').remove()">×</button>
    `;
    container.appendChild(row);
}

async function saveTp() {
    const loId     = document.getElementById('penilaian-tp-id').value || null;
    const kode     = document.getElementById('penilaian-tp-kode').value.trim();
    const desk     = document.getElementById('penilaian-tp-deskripsi').value.trim();
    const urutan   = parseInt(document.getElementById('penilaian-tp-urutan').value) || 1;
    const berlaku  = document.getElementById('penilaian-tp-berlaku').value;
    const elementIdRaw = document.getElementById('penilaian-tp-element-id')?.value || '';
    const elementId    = elementIdRaw || null;
    const { subjectId, year, semester } = _penilaianCtx;

    if (!kode || !desk) {
        showPenilaianMsg('tp', 'Kode TP dan deskripsi wajib diisi.', 'error');
        return;
    }
    if (!subjectId || !year || !semester) {
        showPenilaianMsg('tp', 'Pilih kelas, mapel, dan semester terlebih dahulu.', 'error');
        return;
    }

    try {
        let savedLoId = loId;
        if (loId) {
            const { error } = await supabase
                .from('learning_objectives')
                .update({ kode_tp: kode, deskripsi_tp: desk, urutan, berlaku_untuk: berlaku, element_id: elementId })
                .eq('learning_objective_id', loId)
                .eq('school_id', currentUser.school_id);
            if (error) throw error;
        } else {
            const { data, error } = await supabase
                .from('learning_objectives')
                .insert({
                    school_id:       currentUser.school_id,
                    teacher_user_id: currentUser.user_id,
                    subject_id:      subjectId,
                    academic_year:   year,
                    semester,
                    kode_tp:         kode,
                    deskripsi_tp:    desk,
                    urutan,
                    berlaku_untuk:   berlaku,
                    element_id:      elementId
                })
                .select('learning_objective_id')
                .single();
            if (error) throw error;
            savedLoId = data.learning_objective_id;
        }

        if (berlaku === 'KELAS_TERTENTU') {
            await supabase
                .from('learning_objective_classes')
                .delete()
                .eq('learning_objective_id', savedLoId);
            const checked = [...document.querySelectorAll(
                '#penilaian-tp-kelas-checkboxes input:checked'
            )];
            if (checked.length) {
                const { error } = await supabase
                    .from('learning_objective_classes')
                    .insert(checked.map(cb => ({
                        learning_objective_id: savedLoId,
                        class_id:   cb.value,
                        school_id:  currentUser.school_id
                    })));
                if (error) throw error;
            }
        } else {
            await supabase
                .from('learning_objective_classes')
                .delete()
                .eq('learning_objective_id', savedLoId);
        }

        // Validasi KKTP sebelum menyentuh DB
        const allRows = [...document.querySelectorAll('.kktp-row')].map(row => ({
            learning_objective_id: savedLoId,
            school_id:   currentUser.school_id,
            batas_bawah: parseFloat(row.querySelector('.kktp-bawah').value),
            batas_atas:  parseFloat(row.querySelector('.kktp-atas').value),
            predikat:    row.querySelector('.kktp-predikat').value.trim(),
            keterangan:  row.querySelector('.kktp-keterangan').value.trim() || null
        }));
        const criteria = allRows.filter(c => !isNaN(c.batas_bawah) && !isNaN(c.batas_atas) && c.predikat);
        const skipped = allRows.length - criteria.length;
        if (skipped > 0) {
            showPenilaianMsg('tp', `${skipped} baris KKTP tidak lengkap (batas bawah, batas atas, dan predikat wajib diisi) — baris tersebut tidak disimpan.`, 'error');
        }
        const terbalik = criteria.find(c => c.batas_bawah >= c.batas_atas);
        if (terbalik) {
            showPenilaianMsg('tp', `Rentang KKTP "${esc(terbalik.predikat)}" tidak valid: batas bawah harus lebih kecil dari batas atas.`, 'error');
            return;
        }
        const sorted = [...criteria].sort((a, b) => a.batas_bawah - b.batas_bawah);
        for (let i = 0; i < sorted.length - 1; i++) {
            if (sorted[i + 1].batas_bawah < sorted[i].batas_atas) {
                showPenilaianMsg('tp', `Rentang KKTP "${esc(sorted[i].predikat)}" dan "${esc(sorted[i + 1].predikat)}" tumpang tindih.`, 'error');
                return;
            }
        }

        // Hapus KKTP lama, insert baru
        await supabase
            .from('assessment_criteria')
            .delete()
            .eq('learning_objective_id', savedLoId)
            .eq('school_id', currentUser.school_id);
        if (criteria.length) {
            const { error } = await supabase
                .from('assessment_criteria')
                .insert(criteria);
            if (error) throw error;
        }

        document.getElementById('penilaian-tp-form-card').style.display = 'none';
        document.getElementById('penilaian-cp-panel').style.display        = 'none';
        document.getElementById('penilaian-cp-elemen-picker').style.display = 'none';
        await loadTpList();

    } catch (e) {
        showPenilaianMsg('tp', `Gagal menyimpan TP: ${esc(e.message)}`, 'error');
    }
}

async function deleteTp(loId) {
    try {
        // Cek apakah ada nilai siswa sebelum hapus
        const { data: nilaiList, error: errCek } = await supabase
            .from('tp_assessments')
            .select('assessment_id, student_id, tipe, judul, nilai_angka, nilai_kualitatif, tanggal, is_void, students(nis, full_name)')
            .eq('learning_objective_id', loId)
            .eq('school_id', currentUser.school_id)
            .order('tanggal');
        if (errCek) throw errCek;

        if (nilaiList && nilaiList.length > 0) {
            if (!confirm(
                `TP ini memiliki ${nilaiList.length} nilai siswa.\n` +
                `File Excel nilai akan diunduh otomatis sebelum TP dihapus.\n\n` +
                `Lanjutkan?`
            )) return;

            // Unduh Excel dulu, baru hapus
            const tp = _penilaianTpList.find(t => t.learning_objective_id === loId);
            const kode = tp?.kode_tp || loId;
            const wb  = XLSX.utils.book_new();
            const rows = [['NIS', 'Nama Siswa', 'Tipe', 'Judul', 'Nilai Angka', 'Nilai Kualitatif', 'Tanggal', 'Void']];
            nilaiList.forEach(n => {
                rows.push([
                    n.students?.nis        || '',
                    n.students?.full_name  || '',
                    n.tipe                 || '',
                    n.judul                || '',
                    n.nilai_angka          ?? '',
                    n.nilai_kualitatif     || '',
                    n.tanggal              || '',
                    n.is_void ? 'Ya' : 'Tidak',
                ]);
            });
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Nilai');
            XLSX.writeFile(wb, `backup_nilai_${kode}.xlsx`);
        } else {
            if (!confirm('Hapus TP ini? KKTP dan data terkait akan ikut terhapus.')) return;
        }

        // Hard delete — CASCADE menghapus assessment_criteria, learning_objective_classes, tp_assessments
        const { error } = await supabase
            .from('learning_objectives')
            .delete()
            .eq('learning_objective_id', loId)
            .eq('school_id', currentUser.school_id);
        if (error) throw error;
        await loadTpList();
    } catch (e) {
        alert(`Gagal hapus TP: ${esc(e.message)}`);
    }
}

// Expose ke global scope — dipanggil via onclick di HTML dinamis (renderTpList),
// tidak bisa diakses langsung dari ES module tanpa assignment eksplisit.
window.openTpForm = openTpForm;
window.deleteTp   = deleteTp;

// ── Download Template Excel CP & TP ──────────────────────────────────────────

function downloadCpTpTemplate() {
    const wb = XLSX.utils.book_new();

    const wsCP = XLSX.utils.aoa_to_sheet([
        ['Elemen CP', 'Deskripsi CP'],
        ['Elemen 1', 'Peserta didik mampu memahami...'],
        ['Elemen 2', 'Peserta didik mampu menerapkan...'],
    ]);
    XLSX.utils.book_append_sheet(wb, wsCP, 'Capaian Pembelajaran');

    const wsTP = XLSX.utils.aoa_to_sheet([
        ['Kode TP', 'Deskripsi TP', 'Urutan', 'KKTP Batas Bawah', 'KKTP Batas Atas', 'KKTP Predikat', 'KKTP Keterangan'],
        ['TP 1.1', 'Peserta didik mampu...', 1, 0,  74,  'Perlu Bimbingan', ''],
        ['TP 1.1', '',                        '',  75, 100, 'Sudah Tercapai',  ''],
        ['TP 1.2', 'Peserta didik mampu...', 2, 0,  74,  'Perlu Bimbingan', ''],
        ['TP 1.2', '',                        '',  75, 100, 'Sudah Tercapai',  ''],
    ]);
    XLSX.utils.book_append_sheet(wb, wsTP, 'Tujuan Pembelajaran');

    XLSX.writeFile(wb, 'Template_CP_TP.xlsx');
}

// ── Parse Excel Upload CP & TP ───────────────────────────────────────────────

async function parseCpTpExcel(file) {
    const errEl   = document.getElementById('upload-preview-error');
    const confirmBtn = document.getElementById('upload-confirm-btn');
    errEl.style.display = 'none';
    confirmBtn.disabled = false;

    const buf  = await file.arrayBuffer();
    const wb   = XLSX.read(buf, { type: 'array' });

    const sheetCP = wb.Sheets['Capaian Pembelajaran'];
    const sheetTP = wb.Sheets['Tujuan Pembelajaran'];

    const errors = [];

    if (!sheetCP) errors.push('Sheet "Capaian Pembelajaran" tidak ditemukan.');
    if (!sheetTP) errors.push('Sheet "Tujuan Pembelajaran" tidak ditemukan.');

    if (errors.length) {
        errEl.textContent = errors.join(' ');
        errEl.style.display = '';
        confirmBtn.disabled = true;
        document.getElementById('penilaian-upload-modal').style.display = '';
        return;
    }

    // Parse CP (skip baris header, index 0)
    const rawCP = XLSX.utils.sheet_to_json(sheetCP, { header: 1, defval: '' });
    const cpRows = rawCP.slice(1)
        .filter(r => String(r[0] ?? '').trim())
        .map(r => ({
            elemen:      String(r[0] ?? '').trim(),
            deskripsi_cp: String(r[1] ?? '').trim(),
        }));

    if (!cpRows.length) errors.push('Sheet "Capaian Pembelajaran" tidak punya data (selain header).');

    // Parse TP (skip baris header, index 0)
    const rawTP = XLSX.utils.sheet_to_json(sheetTP, { header: 1, defval: '' });
    const tpRowsRaw = rawTP.slice(1).filter(r => r.some(c => String(c ?? '').trim() !== ''));

    if (!tpRowsRaw.length) errors.push('Sheet "Tujuan Pembelajaran" tidak punya data (selain header).');

    // Group by kode_tp
    const tpMap = new Map();
    let currentKode = null;
    tpRowsRaw.forEach((r, ri) => {
        const kode   = String(r[0] ?? '').trim();
        const desk   = String(r[1] ?? '').trim();
        const urutan = r[2] !== '' ? parseInt(r[2]) : null;
        const bawah  = r[3] !== '' ? parseFloat(r[3]) : NaN;
        const atas   = r[4] !== '' ? parseFloat(r[4]) : NaN;
        const pred   = String(r[5] ?? '').trim();
        const ket    = String(r[6] ?? '').trim();

        if (kode) currentKode = kode;
        if (!currentKode) return;

        if (!tpMap.has(currentKode)) {
            if (!desk) errors.push(`Baris ${ri + 2}: TP "${currentKode}" tidak punya deskripsi.`);
            tpMap.set(currentKode, {
                kode_tp:     currentKode,
                deskripsi_tp: desk,
                urutan:      isNaN(urutan) ? (tpMap.size + 1) : urutan,
                kktp:        [],
            });
        }

        if (!isNaN(bawah) && !isNaN(atas) && pred) {
            if (bawah < 0 || bawah > 100 || atas < 0 || atas > 100)
                errors.push(`Baris ${ri + 2}: KKTP "${pred}" — batas harus 0–100.`);
            tpMap.get(currentKode).kktp.push({ batas_bawah: bawah, batas_atas: atas, predikat: pred, keterangan: ket || null });
        }
    });

    const tpGroups = [...tpMap.values()];

    // Render preview CP
    const previewCP = document.getElementById('upload-preview-cp');
    if (cpRows.length) {
        previewCP.innerHTML = `
            <table style="width:100%; border-collapse:collapse; font-size:13px">
                <thead><tr style="background:var(--color-surface-alt,#f3f4f6)">
                    <th style="padding:6px 8px; text-align:left; border:1px solid var(--color-border)">Elemen CP</th>
                    <th style="padding:6px 8px; text-align:left; border:1px solid var(--color-border)">Deskripsi CP</th>
                </tr></thead>
                <tbody>${cpRows.map(r => `
                    <tr>
                        <td style="padding:6px 8px; border:1px solid var(--color-border); vertical-align:top; white-space:nowrap">${esc(r.elemen)}</td>
                        <td style="padding:6px 8px; border:1px solid var(--color-border)">${esc(r.deskripsi_cp)}</td>
                    </tr>`).join('')}
                </tbody>
            </table>`;
    } else {
        previewCP.innerHTML = '<p class="hint">Tidak ada data CP.</p>';
    }

    // Render preview TP
    const previewTP = document.getElementById('upload-preview-tp');
    if (tpGroups.length) {
        previewTP.innerHTML = tpGroups.map(tp => `
            <div style="margin-bottom:12px; border:1px solid var(--color-border); border-radius:6px; overflow:hidden">
                <div style="background:var(--color-surface-alt,#f3f4f6); padding:8px 10px; font-size:13px">
                    <strong>${esc(tp.kode_tp)}</strong> — Urutan ${tp.urutan}<br>
                    <span style="color:var(--color-text-muted)">${esc(tp.deskripsi_tp)}</span>
                </div>
                ${tp.kktp.length ? `
                <table style="width:100%; border-collapse:collapse; font-size:12px">
                    <thead><tr style="background:var(--color-surface-alt,#f3f4f6)">
                        <th style="padding:4px 8px; border:1px solid var(--color-border)">Batas Bawah</th>
                        <th style="padding:4px 8px; border:1px solid var(--color-border)">Batas Atas</th>
                        <th style="padding:4px 8px; border:1px solid var(--color-border)">Predikat</th>
                        <th style="padding:4px 8px; border:1px solid var(--color-border)">Keterangan</th>
                    </tr></thead>
                    <tbody>${tp.kktp.map(k => `
                        <tr>
                            <td style="padding:4px 8px; border:1px solid var(--color-border); text-align:center">${k.batas_bawah}</td>
                            <td style="padding:4px 8px; border:1px solid var(--color-border); text-align:center">${k.batas_atas}</td>
                            <td style="padding:4px 8px; border:1px solid var(--color-border)">${esc(k.predikat)}</td>
                            <td style="padding:4px 8px; border:1px solid var(--color-border)">${esc(k.keterangan || '')}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>` : '<p class="hint" style="margin:6px 10px">Tidak ada KKTP.</p>'}
            </div>`).join('');
    } else {
        previewTP.innerHTML = '<p class="hint">Tidak ada data TP.</p>';
    }

    if (errors.length) {
        errEl.innerHTML = errors.map(e => `• ${esc(e)}`).join('<br>');
        errEl.style.display = '';
        confirmBtn.disabled = true;
    }

    // Pasang handler konfirmasi (replace agar tidak accumulate)
    const newBtn = confirmBtn.cloneNode(true);
    confirmBtn.replaceWith(newBtn);
    if (!errors.length) {
        newBtn.disabled = false;
        newBtn.addEventListener('click', () => saveUploadedCpTp(cpRows, tpGroups));
    }

    document.getElementById('penilaian-upload-modal').style.display = '';
}

// ── Simpan hasil upload CP & TP ──────────────────────────────────────────────

async function saveUploadedCpTp(cpRows, tpGroups) {
    const errEl     = document.getElementById('upload-preview-error');
    const confirmBtn = document.getElementById('upload-confirm-btn');
    errEl.style.display = 'none';
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Menyimpan…';

    const { subjectId, year, semester } = _penilaianCtx;
    let fase = 'E';
    if (_penilaianCtx.kelasId) {
        try {
            const ctx = await getClassProgramContext(_penilaianCtx.kelasId);
            fase = ctx.grade_level === 10 ? 'E' : 'F';
        } catch (_) { /* fallback E */ }
    }

    try {
        // Langkah 1 — Simpan CP (upsert per elemen)
        if (cpRows.length) {
            const cpPayload = cpRows.map(r => ({
                school_id:    currentUser.school_id,
                subject_id:   subjectId,
                program_id:   null,
                fase,
                elemen:       r.elemen,
                deskripsi_cp: r.deskripsi_cp,
                generated_by: 'MANUAL',
                created_by:   currentUser.user_id,
            }));
            const { error } = await supabase
                .from('capaian_pembelajaran')
                .upsert(cpPayload, {
                    onConflict:        'school_id,subject_id,program_id,fase,elemen',
                    ignoreDuplicates:  false,
                });
            if (error) throw new Error(`Simpan CP: ${error.message}`);
        }

        // Langkah 2 — Simpan TP + KKTP (upsert agar upload ulang tidak duplikat)
        let savedTp = 0;
        for (const tp of tpGroups) {
            const { data, error: errLo } = await supabase
                .from('learning_objectives')
                .upsert({
                    school_id:       currentUser.school_id,
                    teacher_user_id: currentUser.user_id,
                    subject_id:      subjectId,
                    academic_year:   year,
                    semester,
                    kode_tp:         tp.kode_tp,
                    deskripsi_tp:    tp.deskripsi_tp,
                    urutan:          tp.urutan,
                    berlaku_untuk:   'SEMUA_KELAS',
                    element_id:      null,
                }, {
                    onConflict:       'school_id,teacher_user_id,subject_id,academic_year,semester,kode_tp',
                    ignoreDuplicates: false,
                })
                .select('learning_objective_id')
                .single();
            if (errLo) throw new Error(`Simpan TP "${tp.kode_tp}": ${errLo.message}`);

            // Hapus KKTP lama sebelum insert baru agar tidak duplikat saat upload ulang
            await supabase
                .from('assessment_criteria')
                .delete()
                .eq('learning_objective_id', data.learning_objective_id)
                .eq('school_id', currentUser.school_id);

            if (tp.kktp.length) {
                const { error: errKk } = await supabase
                    .from('assessment_criteria')
                    .insert(tp.kktp.map(k => ({
                        learning_objective_id: data.learning_objective_id,
                        school_id:   currentUser.school_id,
                        batas_bawah: k.batas_bawah,
                        batas_atas:  k.batas_atas,
                        predikat:    k.predikat,
                        keterangan:  k.keterangan,
                    })));
                if (errKk) throw new Error(`Simpan KKTP "${tp.kode_tp}": ${errKk.message}`);
            }
            savedTp++;
        }

        document.getElementById('penilaian-upload-modal').style.display = 'none';
        await loadTpList();

        // Tidak lewat showPenilaianMsg karena showPenilaianMsg menjadwal
        // setTimeout hide 4 detik — peringatan ini harus permanen.
        const _uploadMsg = document.getElementById('penilaian-settings-msg');
        if (_uploadMsg) {
            _uploadMsg.style.display = '';
            _uploadMsg.style.color   = 'var(--color-warning, #b45309)';
            _uploadMsg.innerHTML =
                `✓ ${cpRows.length} CP dan ${savedTp} TP berhasil diupload. ` +
                `<strong>TP belum terhubung ke Elemen CP.</strong> ` +
                `Klik <em>Edit</em> pada setiap TP → pilih Elemen CP yang dicakup.`;
        }

    } catch (e) {
        errEl.textContent = e.message;
        errEl.style.display = '';
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Simpan ke Sistem';
    }
}

async function loadGradingSettings() {
    const { kelasId, subjectId, year, semester } = _penilaianCtx;
    if (!kelasId || !subjectId || !year || !semester) return;
    try {
        const { data } = await supabase
            .from('grading_settings')
            .select('*')
            .eq('school_id', currentUser.school_id)
            .eq('subject_id', subjectId)
            .eq('class_id', kelasId)
            .eq('academic_year', year)
            .eq('semester', semester)
            .maybeSingle();
        if (!data) return;
        document.getElementById('penilaian-formatif-included').checked =
            data.is_formatif_included;
        document.getElementById('penilaian-formatif-options').style.display =
            data.is_formatif_included ? '' : 'none';
        if (data.metode_formatif) {
            document.getElementById('penilaian-metode-formatif').value =
                data.metode_formatif;
        }
        document.getElementById('penilaian-bobot-row').style.display =
            data.metode_formatif === 'BOBOT' ? 'flex' : 'none';
        if (data.bobot_formatif != null)
            document.getElementById('penilaian-bobot-formatif').value = data.bobot_formatif;
        if (data.bobot_sumatif != null)
            document.getElementById('penilaian-bobot-sumatif').value = data.bobot_sumatif;
    } catch { /* belum ada settings — ok */ }
}

async function saveGradingSettings() {
    const { kelasId, subjectId, year, semester } = _penilaianCtx;
    if (!kelasId || !subjectId || !year || !semester) {
        showPenilaianMsg('settings', 'Pilih kelas, mapel, dan semester terlebih dahulu.', 'error');
        return;
    }
    const isFor    = document.getElementById('penilaian-formatif-included').checked;
    const metode   = isFor
        ? document.getElementById('penilaian-metode-formatif').value
        : null;
    const bobotFor = isFor && metode === 'BOBOT'
        ? parseInt(document.getElementById('penilaian-bobot-formatif').value)
        : null;
    const bobotSum = isFor && metode === 'BOBOT'
        ? parseInt(document.getElementById('penilaian-bobot-sumatif').value)
        : null;

    if (isFor && metode === 'BOBOT') {
        if (isNaN(bobotFor) || isNaN(bobotSum) || bobotFor + bobotSum !== 100) {
            showPenilaianMsg('settings',
                'Bobot formatif + bobot sumatif harus = 100%.', 'error');
            return;
        }
    }

    try {
        const { error } = await supabase
            .from('grading_settings')
            .upsert({
                school_id:            currentUser.school_id,
                teacher_user_id:      currentUser.user_id,
                subject_id:           subjectId,
                class_id:             kelasId,
                academic_year:        year,
                semester,
                is_formatif_included: isFor,
                metode_formatif:      metode,
                bobot_formatif:       bobotFor,
                bobot_sumatif:        bobotSum,
                updated_at:           new Date().toISOString()
            }, {
                onConflict: 'school_id,teacher_user_id,subject_id,class_id,academic_year,semester'
            });
        if (error) throw error;
        showPenilaianMsg('settings', 'Pengaturan berhasil disimpan.', 'success');
    } catch (e) {
        showPenilaianMsg('settings', `Gagal menyimpan: ${esc(e.message)}`, 'error');
    }
}

function showPenilaianMsg(area, text, type) {
    const el = document.getElementById(`penilaian-${area}-msg`);
    if (!el) return;
    el.textContent = text;
    el.style.display = '';
    el.style.color = type === 'error'
        ? 'var(--color-danger)'
        : 'var(--color-success, #16a34a)';
    setTimeout(() => { el.style.display = 'none'; }, 4000);
}

// ── Sub-tab Input Nilai ──────────────────────────────────────

let _penilaianInputInit = false;

async function initPenilaianInputTab() {
    // Populate dropdown TP dari _penilaianTpList
    const selTp = document.getElementById('penilaian-input-tp-select');
    selTp.innerHTML = '<option value="">— Pilih TP —</option>';
    _penilaianTpList.forEach(tp => {
        const opt = document.createElement('option');
        opt.value = tp.learning_objective_id;
        opt.textContent = `${tp.kode_tp} — ${tp.deskripsi_tp.substring(0, 50)}`;
        selTp.appendChild(opt);
    });

    // Set tanggal default hari ini
    const tanggalEl = document.getElementById('penilaian-input-tanggal');
    if (!tanggalEl.value) tanggalEl.value = localDateStr();

    if (!_penilaianInputInit) {
        _penilaianInputInit = true;

        selTp.addEventListener('change', async () => {
            if (selTp.value) {
                await loadInputGrid(selTp.value);
            } else {
                document.getElementById('penilaian-input-grid').innerHTML =
                    '<p class="hint">Pilih TP untuk menampilkan daftar siswa.</p>';
                document.getElementById('penilaian-save-nilai').style.display = 'none';
            }
        });

        document.getElementById('penilaian-input-tipe').addEventListener('change', async () => {
            if (selTp.value) await loadInputGrid(selTp.value);
        });
    }

    document.getElementById('penilaian-input-grid').innerHTML =
        '<p class="hint">Pilih TP untuk menampilkan daftar siswa.</p>';
    document.getElementById('penilaian-save-nilai').style.display = 'none';
}

async function loadInputGrid(loId) {
    const gridEl = document.getElementById('penilaian-input-grid');
    gridEl.innerHTML = '<p class="hint">Memuat siswa…</p>';
    const { kelasId, year } = _penilaianCtx;
    if (!kelasId) {
        gridEl.innerHTML = '<p class="hint">Pilih kelas terlebih dahulu.</p>';
        return;
    }
    try {
        // Ambil daftar siswa aktif di kelas via class_enrollments
        const students = await getEnrolledStudents(kelasId, year);

        if (!students?.length) {
            gridEl.innerHTML = '<p class="hint">Tidak ada siswa aktif di kelas ini.</p>';
            document.getElementById('penilaian-save-nilai').style.display = 'none';
            return;
        }

        // Ambil riwayat nilai untuk TP ini, tipe ini, kelas ini
        const tipe = document.getElementById('penilaian-input-tipe').value;
        const { data: existing, error: aErr } = await supabase
            .from('tp_assessments')
            .select('assessment_id, student_id, nilai_angka, judul, tanggal')
            .eq('school_id', currentUser.school_id)
            .eq('learning_objective_id', loId)
            .eq('class_id', kelasId)
            .eq('tipe', tipe)
            .eq('is_void', false)
            .order('tanggal', { ascending: false });
        if (aErr) throw aErr;

        // Group riwayat per student_id
        const riwayat = {};
        (existing || []).forEach(a => {
            if (!riwayat[a.student_id]) riwayat[a.student_id] = [];
            riwayat[a.student_id].push(a);
        });

        gridEl.innerHTML = `
            <div style="overflow-x:auto">
            <table style="width:100%; border-collapse:collapse; font-size:13px">
              <thead>
                <tr style="border-bottom:2px solid var(--color-border)">
                  <th style="text-align:left; padding:8px 4px; width:36px">No</th>
                  <th style="text-align:left; padding:8px 4px">Nama Siswa</th>
                  <th style="text-align:left; padding:8px 4px; width:80px">NIS</th>
                  <th style="text-align:center; padding:8px 4px; width:110px">Nilai Baru</th>
                  <th style="text-align:left; padding:8px 4px">Riwayat</th>
                </tr>
              </thead>
              <tbody id="penilaian-input-tbody">
                ${students.map((s, i) => `
                  <tr style="border-bottom:1px solid var(--color-border)"
                      data-student-id="${esc(s.student_id)}">
                    <td style="padding:8px 4px; color:var(--color-text-muted)">${i + 1}</td>
                    <td style="padding:8px 4px">${esc(s.full_name)}</td>
                    <td style="padding:8px 4px; color:var(--color-text-muted)">${esc(s.nis || '')}</td>
                    <td style="padding:8px 4px; text-align:center">
                      <input type="number" class="input nilai-input"
                             min="0" max="100" step="0.01" placeholder="0–100"
                             style="width:84px; text-align:center">
                    </td>
                    <td style="padding:8px 4px">
                      ${renderRiwayatNilai(riwayat[s.student_id] || [])}
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
            </div>
        `;
        document.getElementById('penilaian-save-nilai').style.display = '';

    } catch (e) {
        gridEl.innerHTML =
            `<p class="hint" style="color:var(--color-danger)">Gagal memuat siswa: ${esc(e.message)}</p>`;
    }
}

function renderRiwayatNilai(entries) {
    if (!entries.length) return '<span style="color:var(--color-text-muted)">—</span>';
    return entries.map(a => `
        <span style="display:inline-flex; align-items:center; gap:4px;
                     background:var(--color-surface-alt); border-radius:4px;
                     padding:2px 6px; margin:2px; font-size:12px">
            <strong>${a.nilai_angka != null ? a.nilai_angka : '—'}</strong>
            ${a.judul ? `<span style="color:var(--color-text-muted)">${esc(a.judul)}</span>` : ''}
            <button type="button"
                    style="background:none; border:none; cursor:pointer;
                           color:var(--color-danger); font-size:11px;
                           padding:0 2px; line-height:1"
                    onclick="voidNilai('${esc(a.assessment_id)}', this)">×</button>
        </span>
    `).join('');
}

async function voidNilai(assessmentId, btnEl) {
    if (!confirm('Batalkan nilai ini?')) return;
    try {
        const { error } = await supabase
            .from('tp_assessments')
            .update({ is_void: true, void_reason: 'Dibatalkan oleh guru' })
            .eq('assessment_id', assessmentId)
            .eq('school_id', currentUser.school_id);
        if (error) throw error;
        btnEl.closest('span').remove();
    } catch (e) {
        alert(`Gagal membatalkan nilai: ${esc(e.message)}`);
    }
}

async function saveInputNilai() {
    const loId  = document.getElementById('penilaian-input-tp-select').value;
    const tipe  = document.getElementById('penilaian-input-tipe').value;
    const judul = document.getElementById('penilaian-input-judul').value.trim();
    const tgl   = document.getElementById('penilaian-input-tanggal').value;

    if (!loId) {
        showPenilaianMsg('input', 'Pilih Tujuan Pembelajaran terlebih dahulu.', 'error');
        return;
    }
    if (!tgl) {
        showPenilaianMsg('input', 'Tanggal wajib diisi.', 'error');
        return;
    }

    const rows = [...document.querySelectorAll('#penilaian-input-tbody tr')];
    const { kelasId } = _penilaianCtx;

    const toInsert = [];
    rows.forEach(tr => {
        const studentId = tr.dataset.studentId;
        const val = tr.querySelector('.nilai-input')?.value.trim();
        if (!val || isNaN(parseFloat(val))) return;
        toInsert.push({
            school_id:             currentUser.school_id,
            learning_objective_id: loId,
            student_id:            studentId,
            teacher_user_id:       currentUser.user_id,
            class_id:              kelasId,
            tipe,
            judul:                 judul || null,
            nilai_angka:           parseFloat(val),
            tanggal:               tgl
        });
    });

    if (!toInsert.length) {
        showPenilaianMsg('input', 'Tidak ada nilai yang diisi.', 'error');
        return;
    }

    try {
        const { error } = await supabase
            .from('tp_assessments')
            .insert(toInsert);
        if (error) throw error;
        showPenilaianMsg('input', `${toInsert.length} nilai berhasil disimpan.`, 'success');
        rows.forEach(tr => {
            const el = tr.querySelector('.nilai-input');
            if (el) el.value = '';
        });
        await loadInputGrid(loId);
    } catch (e) {
        showPenilaianMsg('input', `Gagal menyimpan: ${esc(e.message)}`, 'error');
    }
}

// ── Sub-tab Nilai Akhir ──────────────────────────────────────

let _penilaianHasilInit = false;
let _penilaianHasilData = null;

async function initPenilaianHasilTab() {
    if (!_penilaianHasilInit) {
        _penilaianHasilInit = true;

        document.getElementById('penilaian-hitung-btn')
            .addEventListener('click', async () => {
                await hitungNilaiAkhir();
            });

        document.getElementById('penilaian-publikasi-btn')
            .addEventListener('click', async () => {
                await publikasiNilai();
            });
    }
    await loadHasilNilai();
}

async function loadHasilNilai() {
    const { kelasId, subjectId, year, semester } = _penilaianCtx;
    const gridEl = document.getElementById('penilaian-hasil-grid');
    const warnEl = document.getElementById('penilaian-stale-warning');
    const pubBtn = document.getElementById('penilaian-publikasi-btn');

    warnEl.style.display = 'none';
    pubBtn.style.display = 'none';

    if (!kelasId || !subjectId || !year || !semester) {
        gridEl.innerHTML = '<p class="hint">Pilih kelas, mapel, dan semester terlebih dahulu.</p>';
        return;
    }

    gridEl.innerHTML = '<p class="hint">Memuat…</p>';

    try {
        const { data, error } = await supabase.rpc('fn_get_grade_summary', {
            p_subject_id:    subjectId,
            p_class_id:      kelasId,
            p_academic_year: year,
            p_semester:      semester
        });
        if (error) throw error;

        _penilaianHasilData = data;
        const students = data?.students || [];

        if (!students.length) {
            gridEl.innerHTML =
                '<p class="hint">Belum ada nilai akhir. ' +
                'Klik "Hitung Nilai Akhir" untuk menghitung.</p>';
            return;
        }

        const isPublished = students.every(s => s.grade_summary?.published_at != null);
        pubBtn.style.display  = isPublished ? 'none' : '';
        pubBtn.textContent    = isPublished ? 'Sudah Dipublikasi' : 'Publikasi ke Siswa & Orang Tua';
        pubBtn.disabled       = isPublished;

        renderHasilGrid(students);

    } catch (e) {
        gridEl.innerHTML =
            `<p class="hint" style="color:var(--color-danger)">Gagal memuat nilai akhir: ${esc(e.message)}</p>`;
    }
}

function renderHasilGrid(students) {
    const gridEl = document.getElementById('penilaian-hasil-grid');
    if (!students.length) {
        gridEl.innerHTML = '<p class="hint">Belum ada nilai akhir yang dihitung.</p>';
        return;
    }

    gridEl.innerHTML = `
        <table style="width:100%; border-collapse:collapse; font-size:13px">
          <thead>
            <tr style="border-bottom:2px solid var(--color-border)">
              <th style="text-align:left; padding:8px 4px; width:40px">No</th>
              <th style="text-align:left; padding:8px 4px">Nama Siswa</th>
              <th style="text-align:center; padding:8px 4px; width:80px">Nilai Akhir</th>
              <th style="text-align:center; padding:8px 4px; width:80px">Predikat</th>
              <th style="text-align:left; padding:8px 4px">Deskripsi Naratif</th>
              <th style="text-align:center; padding:8px 4px; width:100px">Status</th>
            </tr>
          </thead>
          <tbody>
            ${students.map((s, i) => {
                const gs  = s.grade_summary || {};
                const pub = gs.published_at
                    ? `<span style="color:var(--color-success);font-size:11px">✓ Dipublikasi</span>`
                    : `<span style="color:var(--color-text-muted);font-size:11px">Belum</span>`;
                return `
                  <tr style="border-bottom:1px solid var(--color-border)"
                      data-grade-summary-id="${esc(gs.grade_summary_id || '')}">
                    <td style="padding:8px 4px; color:var(--color-text-muted)">${i + 1}</td>
                    <td style="padding:8px 4px">${esc(s.full_name || s.student_id)}</td>
                    <td style="padding:8px 4px; text-align:center; font-weight:600">
                      ${gs.nilai_akhir != null ? Number(gs.nilai_akhir).toFixed(1) : '—'}
                    </td>
                    <td style="padding:8px 4px; text-align:center">${esc(gs.predikat || '—')}</td>
                    <td style="padding:8px 4px">
                      <textarea class="input naratif-input" rows="2"
                                placeholder="Deskripsi untuk rapor…"
                                style="width:100%; font-size:12px; resize:vertical"
                                data-grade-summary-id="${esc(gs.grade_summary_id || '')}"
                      >${esc(gs.deskripsi_naratif || '')}</textarea>
                      <button type="button"
                              class="btn btn-ghost btn-sm simpan-naratif-btn"
                              style="margin-top:4px; font-size:11px"
                              data-grade-summary-id="${esc(gs.grade_summary_id || '')}">
                        Simpan deskripsi
                      </button>
                    </td>
                    <td style="padding:8px 4px; text-align:center">${pub}</td>
                  </tr>
                `;
            }).join('')}
          </tbody>
        </table>
    `;

    gridEl.querySelectorAll('.simpan-naratif-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const gsId     = btn.dataset.gradeSummaryId;
            const textarea = gridEl.querySelector(
                `.naratif-input[data-grade-summary-id="${gsId}"]`
            );
            if (!gsId || !textarea) return;
            await simpanNaratif(gsId, textarea.value);
        });
    });
}

async function simpanNaratif(gradeSummaryId, naratif) {
    try {
        const { error } = await supabase
            .from('grade_summaries')
            .update({ deskripsi_naratif: naratif, updated_at: new Date().toISOString() })
            .eq('grade_summary_id', gradeSummaryId)
            .eq('school_id', currentUser.school_id);
        if (error) throw error;
        showPenilaianMsg('hasil', 'Deskripsi berhasil disimpan.', 'success');
    } catch (e) {
        showPenilaianMsg('hasil', `Gagal: ${esc(e.message)}`, 'error');
    }
}

async function hitungNilaiAkhir() {
    const { kelasId, subjectId, year, semester } = _penilaianCtx;
    if (!kelasId || !subjectId || !year || !semester) {
        showPenilaianMsg('hasil', 'Pilih kelas, mapel, dan semester terlebih dahulu.', 'error');
        return;
    }

    const btn = document.getElementById('penilaian-hitung-btn');
    btn.disabled    = true;
    btn.textContent = 'Menghitung…';

    try {
        const { data, error } = await supabase.rpc('fn_calculate_grade_summary', {
            p_subject_id:    subjectId,
            p_class_id:      kelasId,
            p_academic_year: year,
            p_semester:      semester
        });
        if (error) throw error;
        if (!data?.success) throw new Error(data?.error || 'Kalkulasi gagal');

        showPenilaianMsg('hasil',
            `Nilai akhir berhasil dihitung untuk ${data.updated} siswa.`, 'success');
        await loadHasilNilai();
    } catch (e) {
        showPenilaianMsg('hasil', `Gagal menghitung: ${esc(e.message)}`, 'error');
    } finally {
        btn.disabled    = false;
        btn.textContent = 'Hitung Nilai Akhir';
    }
}

async function publikasiNilai() {
    if (!confirm(
        'Publikasi nilai ke siswa dan orang tua?\n\n' +
        'Setelah publikasi, pengaturan kalkulasi akan dikunci dan ' +
        'tidak bisa diubah lagi tanpa membuka kunci secara manual.'
    )) return;

    const { kelasId, subjectId, year, semester } = _penilaianCtx;
    const btn = document.getElementById('penilaian-publikasi-btn');
    btn.disabled    = true;
    btn.textContent = 'Mempublikasi…';

    try {
        const now = new Date().toISOString();

        const { error: gsErr } = await supabase
            .from('grade_summaries')
            .update({ published_at: now, updated_at: now })
            .eq('school_id', currentUser.school_id)
            .eq('subject_id', subjectId)
            .eq('class_id', kelasId)
            .eq('academic_year', year)
            .eq('semester', semester)
            .is('published_at', null);
        if (gsErr) throw gsErr;

        const { error: lockErr } = await supabase
            .from('grading_settings')
            .update({ is_published: true, published_at: now, locked_at: now, updated_at: now })
            .eq('school_id', currentUser.school_id)
            .eq('teacher_user_id', currentUser.user_id)
            .eq('subject_id', subjectId)
            .eq('class_id', kelasId)
            .eq('academic_year', year)
            .eq('semester', semester);
        if (lockErr) throw lockErr;

        showPenilaianMsg('hasil',
            'Nilai berhasil dipublikasi. Siswa dan orang tua kini bisa melihat nilai.', 'success');
        await loadHasilNilai();
    } catch (e) {
        showPenilaianMsg('hasil', `Gagal publikasi: ${esc(e.message)}`, 'error');
        btn.disabled    = false;
        btn.textContent = 'Publikasi ke Siswa & Orang Tua';
    }
}


// ─── Start ───────────────────────────────────────────────────
init().catch(err => {
    console.error('[init]', err);
    const el = document.getElementById('loading');
    if (el) {
        el.textContent = 'Gagal memuat. Silakan refresh halaman.';
        el.style.color = 'red';
    }
});
