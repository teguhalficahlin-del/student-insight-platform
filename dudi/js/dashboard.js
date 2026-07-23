/**
 * @file dudi/js/dashboard.js
 * Dashboard DUDI: input absensi harian PKL + tulis catatan siswa.
 */

import { applyBrandingById, getLoginUrl } from '../../shared/branding.js';
import { checkMustChangePassword } from '../../shared/change-password.js';
import { initLoginGuard } from '../../shared/login-guard.js';
import {
    supabase,
    getCurrentUserRow,
    isDudi,
    logout,
    fetchMyStudents,
    fetchAttendanceForDate,
    fetchRecentAttendance,
    fetchMyObservations,
    saveObservation,
    getUnreadNotifCount,
    getRecentNotifications,
    markNotificationsRead,
} from './api.js';
import {
    saveAttendanceOffline,
    flushPending,
    pendingCount,
    clearOfflineQueue,
} from './offline.js';
import { showPwaBanner } from '../../shared/pwa-banner.js';

// ── DOM refs ──────────────────────────────────────────────────
const offlineBannerEl   = document.getElementById('offline-banner');
const offlineBannerText = document.getElementById('offline-banner-text');

const orgNameEl     = document.getElementById('dash-org-name');
const userNameEl    = document.getElementById('dash-user-name');
const logoutBtn     = document.getElementById('logout-btn');
const loadingEl     = document.getElementById('loading');
const dashBodyEl    = document.getElementById('dash-body');

const statTotal     = document.getElementById('stat-total');
const statHadir     = document.getElementById('stat-hadir-today');
const statAbsent    = document.getElementById('stat-absent-today');

const attendanceDateEl = document.getElementById('attendance-date');
const btnPrevDay    = document.getElementById('btn-prev-day');
const btnNextDay    = document.getElementById('btn-next-day');
const attendanceListEl = document.getElementById('attendance-list');
const attendanceEmptyEl = document.getElementById('attendance-empty');

const obsForm       = document.getElementById('obs-form');
const obsStudentEl  = document.getElementById('obs-student');
const obsSentimentEl = document.getElementById('obs-sentiment');
const obsDimensionEl = document.getElementById('obs-dimension');
const obsContentEl  = document.getElementById('obs-content');
const obsCharCount  = document.getElementById('obs-char-count');
const obsSubmitBtn  = document.getElementById('obs-submit');
const obsSuccessEl  = document.getElementById('obs-success');
const obsErrorEl    = document.getElementById('obs-error');

const obsHistoryListEl  = document.getElementById('obs-history-list');
const obsHistoryEmptyEl = document.getElementById('obs-history-empty');
const historyTbody  = document.getElementById('history-tbody');
const historyEmptyEl = document.getElementById('history-empty');

// ── LocalStorage cache (Category B — stale-while-revalidate) ──
const LC = (() => {
    const PFX = 'dudi:';
    return {
        get(k)    { try { return JSON.parse(localStorage.getItem(PFX+k)); } catch { return null; } },
        set(k, v) { try { localStorage.setItem(PFX+k, JSON.stringify(v)); } catch {} },
        del(k)    { localStorage.removeItem(PFX+k); },
        clear()   { Object.keys(localStorage).filter(k => k.startsWith(PFX)).forEach(k => localStorage.removeItem(k)); },
    };
})();

// ── State ─────────────────────────────────────────────────────
let currentUser = null;
let students    = [];

const DIMENSION_LABELS = {
    AKADEMIK:    'Akademik / Kompetensi',
    KEHADIRAN:   'Kehadiran',
    PERILAKU:    'Perilaku / Disiplin',
    SOSIAL:      'Sosial / Komunikasi',
    AFEKTIF:     'Sikap / Motivasi',
    BAKAT_MINAT: 'Bakat & Minat',
    FISIK:       'Fisik / Keselamatan',
    LAINNYA:     'Lainnya',
};

const STATUS_LABELS = {
    HADIR:       'Hadir',
    IZIN:        'Izin',
    SAKIT:       'Sakit',
    TIDAK_HADIR: 'Alpa',
};

// ── Offline banner ────────────────────────────────────────────
async function updateOfflineBanner() {
    const n = await pendingCount();
    if (n > 0) {
        offlineBannerText.textContent = `${n} absensi menunggu sinkron — akan terkirim otomatis saat koneksi kembali.`;
        offlineBannerEl.style.display = 'block';
    } else {
        offlineBannerEl.style.display = 'none';
    }
}

window.addEventListener('online', async () => {
    const result = await flushPending();
    if (result.synced > 0) await updateOfflineBanner();
});

// ── Notifikasi lonceng ────────────────────────────────────────
let _notifPollTimer = null;

function _setBellBadge(n) {
    const btn = document.getElementById('notif-bell-btn');
    if (!btn) return;
    let badge = btn.querySelector('.notif-badge');
    if (n > 0) {
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'notif-badge';
            badge.style.cssText = 'position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;line-height:18px;border-radius:9px;background:#dc2626;color:#fff;font-size:11px;font-weight:700;text-align:center;padding:0 3px;pointer-events:none';
            btn.style.position = 'relative';
            btn.appendChild(badge);
        }
        badge.textContent = n > 99 ? '99+' : String(n);
    } else {
        badge?.remove();
    }
}

async function refreshNotifBadge() {
    try { _setBellBadge(await getUnreadNotifCount()); } catch { /* tidak kritis */ }
}

function startNotifPolling() {
    clearInterval(_notifPollTimer);
    _notifPollTimer = setInterval(refreshNotifBadge, 60_000);
}

async function openNotifDropdown() {
    const panel = document.getElementById('notif-dropdown');
    if (!panel) return;
    if (panel.style.display !== 'none') { panel.style.display = 'none'; return; }

    panel.style.display = 'block';
    panel.innerHTML = '<p style="padding:12px;font-size:13px;color:#6b7280">Memuat…</p>';
    try {
        const notifs = await getRecentNotifications(15);
        if (!notifs.length) {
            panel.innerHTML = '<p style="padding:12px;font-size:13px;color:#6b7280">Tidak ada notifikasi baru.</p>';
            return;
        }
        const fmt = s => s ? new Date(s).toLocaleString('id-ID', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }) : '';
        const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        panel.innerHTML = notifs.map(n => `
            <div class="notif-item" data-id="${n.notification_id}"
                 style="padding:10px 14px;border-bottom:1px solid #e5e7eb;cursor:pointer;font-size:13px">
                <div style="font-weight:600;margin-bottom:2px">${esc(n.title)}</div>
                <div style="color:#6b7280;font-size:12px">${esc(n.body)}</div>
                <div style="color:#9ca3af;font-size:11px;margin-top:3px">${fmt(n.created_at)}</div>
            </div>`).join('') +
            `<div style="padding:8px 14px;text-align:center">
                <button id="notif-mark-all-btn" style="font-size:12px;padding:4px 10px;border:1px solid #d1d5db;border-radius:4px;background:#fff;cursor:pointer">Tandai semua dibaca</button>
            </div>`;

        panel.querySelectorAll('.notif-item').forEach(el => {
            el.addEventListener('mouseenter', () => { el.style.background = '#f9fafb'; });
            el.addEventListener('mouseleave', () => { el.style.background = ''; });
            el.addEventListener('click', async () => {
                panel.style.display = 'none';
                await markNotificationsRead([el.dataset.id]).catch(() => {});
                await refreshNotifBadge();
            });
        });
        document.getElementById('notif-mark-all-btn')?.addEventListener('click', async () => {
            await markNotificationsRead(notifs.map(n => n.notification_id)).catch(() => {});
            panel.style.display = 'none';
            _setBellBadge(0);
        });
    } catch {
        panel.innerHTML = '<p style="padding:12px;font-size:13px;color:#dc2626">Gagal memuat notifikasi.</p>';
    }
}

document.getElementById('notif-bell-btn')?.addEventListener('click', openNotifDropdown);
document.addEventListener('click', e => {
    const panel = document.getElementById('notif-dropdown');
    if (panel && !panel.contains(e.target) && e.target.id !== 'notif-bell-btn') {
        panel.style.display = 'none';
    }
});

// ── Init ──────────────────────────────────────────────────────
async function init() {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData?.user) { window.location.replace(getLoginUrl()); return; }

    const userRow = await getCurrentUserRow(authData.user);
    if (!isDudi(userRow)) { window.location.replace(getLoginUrl()); return; }

    currentUser = userRow;
    applyBrandingById(userRow.school_id, supabase);
    await checkMustChangePassword(supabase, userRow);
    await initLoginGuard(supabase, userRow);
    orgNameEl.textContent  = userRow.dudi_org_name ?? userRow.full_name;
    userNameEl.textContent = 'PJ: ' + userRow.full_name;

    // Flush antrian offline + tampilkan banner bila ada sisa
    flushPending().then(updateOfflineBanner);

    // Notifikasi: cek unread count, poll tiap 1 menit
    refreshNotifBadge();
    startNotifPolling();

    const uid = currentUser.user_id;

    // Cache-first: tampilkan data lama dulu
    const cachedStudents = LC.get(`students-${uid}`);
    if (cachedStudents?.length) {
        students = cachedStudents;
        statTotal.textContent = students.length;
        populateStudentSelect();
        attendanceDateEl.value = todayStr();
        loadingEl.style.display  = 'none';
        dashBodyEl.style.display = 'block';
        // Render cache segera, fetch latar belakang
        loadAttendanceForDate(attendanceDateEl.value);
        loadHistory();
        loadObservationHistory();
    }

    // Fetch latar belakang → update cache + re-render
    try {
        const fresh = await fetchMyStudents();
        LC.set(`students-${uid}`, fresh);
        if (JSON.stringify(fresh) !== JSON.stringify(students)) {
            students = fresh;
            statTotal.textContent = students.length;
            populateStudentSelect();
        }
    } catch (err) {
        if (!cachedStudents?.length) {
            loadingEl.textContent = fe(err);
            return;
        }
        // Data lama sudah tampil — biarkan saja
    }

    if (!cachedStudents?.length) {
        attendanceDateEl.value = todayStr();
        loadingEl.style.display  = 'none';
        dashBodyEl.style.display = 'block';
        await Promise.all([
            loadAttendanceForDate(attendanceDateEl.value),
            loadHistory(),
            loadObservationHistory(),
        ]);
    }

    showPwaBanner({ hasBottomNav: false });
}

// ── Attendance ────────────────────────────────────────────────
async function loadAttendanceForDate(date) {
    if (students.length === 0) {
        attendanceListEl.innerHTML = '';
        attendanceEmptyEl.style.display = 'block';
        updateSummary(new Map());
        return;
    }

    attendanceEmptyEl.style.display = 'none';
    attendanceListEl.innerHTML = '<p class="hint">Memuat...</p>';

    const ids = students.map(s => s.student_id);
    let byStudent;
    try {
        byStudent = await fetchAttendanceForDate(ids, date);
    } catch (err) {
        attendanceListEl.innerHTML = `<p class="hint">Gagal memuat data. ${esc(fe(err))}</p>`;
        return;
    }

    updateSummary(byStudent);
    renderAttendanceRows(byStudent, date);
}

function updateSummary(byStudent) {
    const hadirCount  = [...byStudent.values()].filter(r => r.status === 'HADIR').length;
    const notRecorded = students.length - byStudent.size;
    statHadir.textContent  = hadirCount;
    statAbsent.textContent = notRecorded;
}

function renderAttendanceRows(byStudent, date) {
    if (students.length === 0) {
        attendanceListEl.innerHTML = '';
        return;
    }

    attendanceListEl.innerHTML = students.map(s => {
        const existing = byStudent.get(s.student_id);
        const currentStatus = existing?.status ?? '';

        const radios = ['HADIR', 'IZIN', 'SAKIT', 'TIDAK_HADIR'].map(st => `
            <span class="status-radio radio-${st.toLowerCase()}">
                <input type="radio"
                       name="status-${s.student_id}"
                       id="st-${s.student_id}-${st}"
                       value="${st}"
                       ${currentStatus === st ? 'checked' : ''} />
                <label for="st-${s.student_id}-${st}">${STATUS_LABELS[st]}</label>
            </span>
        `).join('');

        return `
            <div class="attendance-row" data-student-id="${s.student_id}" data-placement-id="${s.placement_id}">
                <div>
                    <div class="student-name">${esc(s.full_name)}</div>
                    <div class="student-nis">NIS: ${esc(s.nis)}</div>
                </div>
                <div class="status-radios">${radios}</div>
                <button class="btn btn-primary btn-sm attendance-save-btn"
                        data-student-id="${s.student_id}"
                        data-placement-id="${s.placement_id}">
                    Simpan
                </button>
                <span class="save-status" id="save-status-${s.student_id}"></span>
            </div>
        `;
    }).join('');

    // Attach save listeners
    attendanceListEl.querySelectorAll('.attendance-save-btn').forEach(btn => {
        btn.addEventListener('click', () => handleSaveAttendance(btn, date));
    });
}

async function handleSaveAttendance(btn, date) {
    const studentId   = btn.dataset.studentId;
    const placementId = btn.dataset.placementId;
    const statusEl    = document.querySelector(`input[name="status-${studentId}"]:checked`);
    const saveStatusEl = document.getElementById(`save-status-${studentId}`);

    if (!statusEl) {
        saveStatusEl.textContent = '⚠ Pilih status dulu';
        saveStatusEl.style.color = 'var(--color-warning)';
        return;
    }

    btn.disabled = true;
    saveStatusEl.textContent = 'Menyimpan...';
    saveStatusEl.style.color = 'var(--color-text-muted)';

    try {
        const result = await saveAttendanceOffline({
            placementId,
            studentId,
            date,
            status: statusEl.value,
            userId: currentUser.user_id,
            schoolId: currentUser.school_id,
        });
        if (result.status === 'queued') {
            saveStatusEl.textContent = '⏳ Disimpan offline';
            saveStatusEl.style.color = 'var(--color-warning,#92400e)';
            await updateOfflineBanner();
        } else if (result.status === 'error') {
            saveStatusEl.textContent = '✗ ' + (result.error ?? 'Gagal menyimpan');
            saveStatusEl.style.color = 'var(--color-danger)';
        } else {
            saveStatusEl.textContent = '✓ Tersimpan';
            saveStatusEl.style.color = 'var(--color-success)';
            // Update summary
            const ids = students.map(s => s.student_id);
            const updated = await fetchAttendanceForDate(ids, date);
            updateSummary(updated);
        }
    } catch (err) {
        saveStatusEl.textContent = '✗ ' + fe(err, 's');
        saveStatusEl.style.color = 'var(--color-danger)';
    } finally {
        btn.disabled = false;
    }
}

// ── History ───────────────────────────────────────────────────
function renderHistoryRows(rows, nameById) {
    if (rows.length === 0) {
        historyTbody.innerHTML = '';
        historyEmptyEl.style.display = 'block';
        return;
    }
    historyEmptyEl.style.display = 'none';
    historyTbody.innerHTML = rows.map(r => `
        <tr>
            <td>${formatDate(r.attendance_date)}</td>
            <td>${esc(nameById.get(r.student_id) ?? '—')}</td>
            <td><span class="badge badge-${r.status.toLowerCase().replace(/_/g, '-')}">${STATUS_LABELS[r.status] ?? r.status}</span></td>
            <td>${esc(r.notes ?? '—')}</td>
        </tr>
    `).join('');
}

async function loadHistory() {
    const ids      = students.map(s => s.student_id);
    const nameById = new Map(students.map(s => [s.student_id, s.full_name]));
    const uid      = currentUser.user_id;
    const ckey     = `att-hist-${uid}`;

    const cached = LC.get(ckey);
    if (cached) renderHistoryRows(cached, nameById);

    try {
        const rows = await fetchRecentAttendance(ids, 90);
        LC.set(ckey, rows);
        renderHistoryRows(rows, nameById);
    } catch (err) {
        if (!cached) historyTbody.innerHTML = `<tr><td colspan="4" class="hint">Gagal memuat data. ${esc(fe(err))}</td></tr>`;
    }
}

// ── Observation form ──────────────────────────────────────────
function populateStudentSelect() {
    obsStudentEl.innerHTML = '<option value="">-- Pilih siswa --</option>'
        + students.map(s => `<option value="${s.student_id}">${esc(s.full_name)} (${esc(s.nis)})</option>`).join('');
}

obsContentEl.addEventListener('input', () => {
    obsCharCount.textContent = obsContentEl.value.length;
});

obsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    obsSuccessEl.style.display = 'none';
    obsErrorEl.style.display   = 'none';
    obsSubmitBtn.disabled      = true;
    obsSubmitBtn.textContent   = 'Menyimpan...';

    try {
        await saveObservation({
            studentId:  obsStudentEl.value,
            sentiment:  obsSentimentEl.value,
            dimension:  obsDimensionEl.value,
            content:    obsContentEl.value.trim(),
            userId:     currentUser.user_id,
            schoolId:   currentUser.school_id,
        });

        obsSuccessEl.textContent   = 'Catatan berhasil disimpan.';
        obsSuccessEl.style.display = 'block';
        obsForm.reset();
        obsCharCount.textContent = '0';
        await loadObservationHistory();
    } catch (err) {
        obsErrorEl.textContent   = fe(err, 's');
        obsErrorEl.style.display = 'block';
    } finally {
        obsSubmitBtn.disabled    = false;
        obsSubmitBtn.textContent = 'Simpan Catatan';
    }
});

function renderObsHistory(rows, nameById) {
    if (rows.length === 0) {
        obsHistoryListEl.innerHTML = '';
        obsHistoryEmptyEl.style.display = 'block';
        return;
    }
    obsHistoryEmptyEl.style.display = 'none';
    obsHistoryListEl.innerHTML = rows.map(r => `
        <div class="obs-card obs-${r.sentiment.toLowerCase()}">
            <div class="obs-meta">
                <strong>${esc(nameById.get(r.student_id) ?? 'Siswa')}</strong>
                &middot; ${DIMENSION_LABELS[r.dimension] ?? r.dimension}
                &middot; ${r.sentiment === 'POSITIF' ? 'Positif' : 'Perlu Perhatian'}
                &middot; ${formatDate(r.observed_at)}
            </div>
            <p class="obs-content">${esc(r.content)}</p>
        </div>
    `).join('');
}

async function loadObservationHistory() {
    const ids      = students.map(s => s.student_id);
    const nameById = new Map(students.map(s => [s.student_id, s.full_name]));
    const uid      = currentUser.user_id;
    const ckey     = `obs-${uid}`;

    const cached = LC.get(ckey);
    if (cached) renderObsHistory(cached, nameById);

    try {
        const rows = await fetchMyObservations(ids);
        LC.set(ckey, rows);
        renderObsHistory(rows, nameById);
    } catch (err) {
        if (!cached) obsHistoryListEl.innerHTML = `<p class="hint">Gagal memuat data. ${esc(fe(err))}</p>`;
    }
}

// ── Date navigation ───────────────────────────────────────────
attendanceDateEl.addEventListener('change', () => loadAttendanceForDate(attendanceDateEl.value));

btnPrevDay.addEventListener('click', () => {
    const d = new Date(attendanceDateEl.value);
    d.setDate(d.getDate() - 1);
    attendanceDateEl.value = d.toISOString().slice(0, 10);
    loadAttendanceForDate(attendanceDateEl.value);
});

btnNextDay.addEventListener('click', () => {
    const d = new Date(attendanceDateEl.value);
    d.setDate(d.getDate() + 1);
    const today = todayStr();
    if (d.toISOString().slice(0, 10) > today) return;
    attendanceDateEl.value = d.toISOString().slice(0, 10);
    loadAttendanceForDate(attendanceDateEl.value);
});

// ── Logout ────────────────────────────────────────────────────
logoutBtn.addEventListener('click', async () => {
    LC.clear();
    await clearOfflineQueue();
    await logout();
    window.location.replace(getLoginUrl());
});

// ── Helpers ───────────────────────────────────────────────────
function todayStr() {
    return new Date().toISOString().slice(0, 10);
}

function formatDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function esc(str) {
    const el = document.createElement('span');
    el.textContent = str ?? '';
    return el.innerHTML;
}
function fe(err, ctx = 'muat') {
    console.error('[dudi]', err);
    const m = String(err?.message ?? '').toLowerCase();
    if (m.includes('jwt') || m.includes('expired')) return 'Sesi habis. Silakan login ulang.';
    if (m.includes('fetch') || m.includes('network') || m.includes('failed to fetch')) return 'Tidak ada koneksi. Periksa jaringan.';
    return ctx === 's' ? 'Gagal menyimpan. Silakan coba lagi.' : 'Gagal memuat data. Silakan coba lagi.';
}

init().catch(err => {
    console.error('[init]', err);
    const el = document.getElementById('loading');
    if (el) {
        el.textContent = 'Gagal memuat. Silakan refresh halaman.';
        el.style.color = 'red';
    }
});
