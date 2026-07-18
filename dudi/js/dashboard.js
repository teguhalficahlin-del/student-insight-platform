/**
 * @file dudi/js/dashboard.js
 * Dashboard DUDI: input absensi harian PKL + tulis observasi siswa.
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
    createDudiCase,
    getDudiCases,
    getDudiCaseEvents,
    addDudiCaseComment,
    escalateDudiCase,
    closeDudiCase,
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
            <div class="notif-item" data-id="${n.notification_id}" data-case="${n.case_id ?? ''}"
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
                if (el.dataset.case) scrollToKasus(el.dataset.case);
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

function scrollToKasus(caseId) {
    const el = document.querySelector(`[data-case-id="${caseId}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

    // Inisialisasi section kasus PKL
    await initKasusSection(user, students);
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

// ── KASUS PKL ────────────────────────────────────────────────

const CASE_STATUS_LABEL = { OPEN: 'Buka', UNDER_REVIEW: 'Ditinjau', INTERVENTION: 'Intervensi', MONITORING: 'Monitoring', CLOSED: 'Tutup' };
const EVENT_LABEL = { COMMENT_ADDED: 'Komentar', DECISION_ESCALATE: 'Diteruskan ke Ka. Prodi', DECISION_CLOSE: 'Laporan Ditutup', STATUS_CHANGED: 'Status Berubah' };

let _currentUser = null;
let _myStudents  = [];
let _currentCaseId = null;

async function initKasusSection(user, students) {
    _currentUser = user;
    _myStudents  = students;

    // Isi dropdown siswa di form buat kasus
    const sel = document.getElementById('kasus-c-student');
    sel.innerHTML = '<option value="">-- Pilih siswa --</option>' +
        students.map(s => `<option value="${s.student_id}">${esc(s.full_name)} (${esc(s.nis)})</option>`).join('');

    document.getElementById('kasus-new-btn').addEventListener('click', () => {
        document.getElementById('kasus-create-form-wrap').style.display = 'block';
        document.getElementById('kasus-c-msg').style.display = 'none';
        document.getElementById('kasus-c-title').value = '';
        document.getElementById('kasus-c-desc').value  = '';
        sel.value = '';
    });
    document.getElementById('kasus-c-cancel').addEventListener('click', () => {
        document.getElementById('kasus-create-form-wrap').style.display = 'none';
    });
    document.getElementById('kasus-c-submit').addEventListener('click', async () => {
        const studentId = sel.value;
        const title     = document.getElementById('kasus-c-title').value.trim();
        const desc      = document.getElementById('kasus-c-desc').value.trim();
        const msgEl     = document.getElementById('kasus-c-msg');
        const btn       = document.getElementById('kasus-c-submit');
        if (!studentId)        { showKasusMsg(msgEl, 'Pilih siswa terlebih dahulu.', true); return; }
        if (!title)            { showKasusMsg(msgEl, 'Judul tidak boleh kosong.', true); return; }
        if (desc.length < 20)  { showKasusMsg(msgEl, 'Keterangan minimal 20 karakter.', true); return; }
        btn.disabled = true; btn.textContent = 'Mengirim…';
        try {
            await createDudiCase({ studentId, title, description: desc, authorUserId: _currentUser.user_id, authorRole: 'DUDI' });
            document.getElementById('kasus-create-form-wrap').style.display = 'none';
            await loadKasusList();
        } catch (err) {
            showKasusMsg(msgEl, fe(err, 's'), true);
        } finally {
            btn.disabled = false; btn.textContent = 'Kirim Laporan';
        }
    });
    document.getElementById('kasus-back-btn').addEventListener('click', () => {
        document.getElementById('kasus-detail-wrap').style.display = 'none';
        document.getElementById('kasus-list-wrap').style.display   = 'block';
        document.getElementById('kasus-new-btn').style.display     = 'inline-flex';
        _currentCaseId = null;
    });

    await loadKasusList();
}

async function loadKasusList() {
    const listEl = document.getElementById('kasus-list-wrap');
    listEl.innerHTML = '<p class="hint">Memuat laporan…</p>';
    try {
        const cases = await getDudiCases();
        if (!cases.length) {
            listEl.innerHTML = '<p class="hint">Belum ada laporan. Klik "+ Laporan Baru" untuk membuat.</p>';
            return;
        }
        listEl.innerHTML = cases.map(c => `
            <div style="border:1px solid var(--color-border);border-radius:var(--radius);padding:12px;margin-bottom:10px;cursor:pointer" data-id="${c.case_id}">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
                    <strong style="font-size:14px">${esc(c.title)}</strong>
                    <span style="font-size:12px;padding:2px 8px;border-radius:20px;border:1px solid var(--color-border);white-space:nowrap">${esc(CASE_STATUS_LABEL[c.status] ?? c.status)}</span>
                </div>
                <div style="font-size:12px;color:var(--color-text-muted);margin-top:4px">
                    Siswa: ${esc(c.student?.full_name ?? '—')} · Handler: ${esc(c.current_handler_role === 'KAPRODI' ? 'Ka. Prodi' : c.current_handler_role === 'DUDI' ? 'Anda' : c.current_handler_role)}
                    · ${formatDate(c.created_at)}
                </div>
            </div>`).join('');
        listEl.querySelectorAll('[data-id]').forEach(el => {
            el.addEventListener('click', () => openKasusDetail(el.dataset.id));
            el.addEventListener('mouseenter', () => { el.style.background = 'var(--color-bg)'; });
            el.addEventListener('mouseleave', () => { el.style.background = ''; });
        });
    } catch (err) {
        listEl.innerHTML = `<p class="hint" style="color:var(--color-danger)">${esc(fe(err))}</p>`;
    }
}

async function openKasusDetail(caseId) {
    _currentCaseId = caseId;
    document.getElementById('kasus-list-wrap').style.display   = 'none';
    document.getElementById('kasus-create-form-wrap').style.display = 'none';
    document.getElementById('kasus-new-btn').style.display     = 'none';
    document.getElementById('kasus-detail-wrap').style.display = 'block';
    document.getElementById('kasus-detail-header').innerHTML   = '<p class="hint">Memuat…</p>';
    try {
        const [cases, events] = await Promise.all([getDudiCases(), getDudiCaseEvents(caseId)]);
        const kasus = cases.find(c => c.case_id === caseId);
        if (!kasus) { document.getElementById('kasus-detail-header').innerHTML = '<p class="hint">Laporan tidak ditemukan.</p>'; return; }
        renderKasusDetail(kasus);
        renderKasusEvents(events);
        renderKasusActions(kasus);
    } catch (err) {
        document.getElementById('kasus-detail-header').innerHTML = `<p class="hint" style="color:var(--color-danger)">${esc(fe(err))}</p>`;
    }
}

function renderKasusDetail(k) {
    document.getElementById('kasus-detail-header').innerHTML = `
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:10px">
            <h4 style="margin:0;flex:1">${esc(k.title)}</h4>
            <span style="font-size:12px;padding:2px 8px;border-radius:20px;border:1px solid var(--color-border)">${esc(CASE_STATUS_LABEL[k.status] ?? k.status)}</span>
        </div>
        <div style="font-size:13px;color:var(--color-text-muted);margin-bottom:8px">
            Siswa: <strong>${esc(k.student?.full_name ?? '—')}</strong> (${esc(k.student?.nis ?? '—')})
            · Handler: <strong>${k.current_handler_role === 'KAPRODI' ? 'Ka. Prodi' : 'Anda (DUDI)'}</strong>
            · 🔒 Privat
        </div>`;
}

function renderKasusEvents(events) {
    const el = document.getElementById('kasus-events-wrap');
    if (!events.length) { el.innerHTML = '<p class="hint">Belum ada aktivitas.</p>'; return; }
    el.innerHTML = events.map(ev => {
        const label = EVENT_LABEL[ev.event_type] ?? ev.event_type;
        const text  = ev.payload?.text ?? '';
        return `<div style="border-left:3px solid var(--color-border);padding:8px 12px;margin-bottom:8px">
            <div style="font-size:12px;color:var(--color-text-muted);margin-bottom:3px">
                <strong>${esc(label)}</strong> · ${esc(ev.author?.full_name ?? '—')} · ${formatDate(ev.created_at)}
            </div>
            ${text ? `<p style="font-size:13px;margin:0">${esc(text)}</p>` : ''}
        </div>`;
    }).join('');
}

function renderKasusActions(kasus) {
    const wrap = document.getElementById('kasus-actions-wrap');
    if (kasus.status === 'CLOSED') { wrap.style.display = 'none'; return; }
    wrap.style.display = 'block';

    const escWrap = document.getElementById('kasus-escalate-wrap');
    // Tampilkan eskalasi hanya jika handler masih DUDI (belum diteruskan)
    escWrap.style.display = kasus.current_handler_role === 'DUDI' ? 'block' : 'none';

    // Wire buttons (clone untuk hapus listener lama)
    const newCommentBtn  = cloneEl('kasus-comment-btn');
    const newEscBtn      = cloneEl('kasus-escalate-btn');
    const newCloseBtn    = cloneEl('kasus-close-btn');

    newCommentBtn.addEventListener('click', async () => {
        const text  = document.getElementById('kasus-comment-text').value.trim();
        const msgEl = document.getElementById('kasus-comment-msg');
        if (!text) { msgEl.style.color = 'var(--color-danger)'; msgEl.textContent = 'Komentar kosong.'; return; }
        newCommentBtn.disabled = true; newCommentBtn.textContent = 'Mengirim…';
        try {
            await addDudiCaseComment({ caseId: kasus.case_id, text, authorUserId: _currentUser.user_id, authorRole: 'DUDI' });
            document.getElementById('kasus-comment-text').value = '';
            msgEl.style.color = 'var(--color-success)'; msgEl.textContent = 'Terkirim.';
            await refreshKasusDetail();
        } catch (err) {
            msgEl.style.color = 'var(--color-danger)'; msgEl.textContent = fe(err, 's');
        } finally {
            newCommentBtn.disabled = false; newCommentBtn.textContent = 'Kirim';
        }
    });

    newEscBtn.addEventListener('click', async () => {
        const note  = document.getElementById('kasus-escalate-note').value.trim();
        const msgEl = document.getElementById('kasus-escalate-msg');
        newEscBtn.disabled = true; newEscBtn.textContent = 'Meneruskan…';
        try {
            await escalateDudiCase({ caseId: kasus.case_id, note, authorUserId: _currentUser.user_id, authorRole: 'DUDI' });
            msgEl.style.color = 'var(--color-success)'; msgEl.textContent = 'Laporan diteruskan ke Ka. Prodi.';
            await refreshKasusDetail();
        } catch (err) {
            msgEl.style.color = 'var(--color-danger)'; msgEl.textContent = fe(err, 's');
        } finally {
            newEscBtn.disabled = false; newEscBtn.textContent = 'Teruskan ke Ka. Prodi';
        }
    });

    newCloseBtn.addEventListener('click', async () => {
        const msgEl = document.getElementById('kasus-close-msg');
        if (newCloseBtn.dataset.confirming !== 'yes') {
            newCloseBtn.dataset.confirming = 'yes';
            msgEl.style.color   = 'var(--color-warning)';
            msgEl.textContent   = 'Klik sekali lagi untuk konfirmasi penutupan laporan.';
            newCloseBtn.textContent = 'Konfirmasi Tutup';
            setTimeout(() => {
                if (newCloseBtn.dataset.confirming === 'yes') {
                    newCloseBtn.dataset.confirming = '';
                    newCloseBtn.textContent = 'Tutup Laporan';
                    msgEl.textContent = '';
                }
            }, 6000);
            return;
        }
        newCloseBtn.dataset.confirming = '';
        newCloseBtn.disabled = true; newCloseBtn.textContent = 'Menutup…';
        try {
            await closeDudiCase({ caseId: kasus.case_id, note: '', authorUserId: _currentUser.user_id, authorRole: 'DUDI' });
            msgEl.style.color = 'var(--color-success)'; msgEl.textContent = 'Laporan ditutup.';
            await refreshKasusDetail();
        } catch (err) {
            msgEl.style.color = 'var(--color-danger)'; msgEl.textContent = fe(err, 's');
        } finally {
            newCloseBtn.disabled = false; newCloseBtn.textContent = 'Tutup Laporan';
        }
    });
}

async function refreshKasusDetail() {
    if (!_currentCaseId) return;
    const [cases, events] = await Promise.all([getDudiCases(), getDudiCaseEvents(_currentCaseId)]);
    const kasus = cases.find(c => c.case_id === _currentCaseId);
    if (kasus) { renderKasusDetail(kasus); renderKasusEvents(events); renderKasusActions(kasus); }
}

function cloneEl(id) {
    const old = document.getElementById(id);
    const neu = old.cloneNode(true);
    old.parentNode.replaceChild(neu, old);
    return neu;
}

function showKasusMsg(el, msg, isErr) {
    el.style.display = 'block';
    el.style.color   = isErr ? 'var(--color-danger)' : 'var(--color-success)';
    el.textContent   = msg;
}

init().catch(err => {
    console.error('[init]', err);
    const el = document.getElementById('loading');
    if (el) {
        el.textContent = 'Gagal memuat. Silakan refresh halaman.';
        el.style.color = 'red';
    }
});
