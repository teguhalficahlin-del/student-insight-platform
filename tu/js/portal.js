/**
 * @file tu/js/portal.js
 * Logic utama portal Tata Usaha.
 * 3 tab: Jadwal Piket, Keterlambatan, Rekap Kehadiran.
 */

import { applyBrandingById, getLoginUrl } from '../../shared/branding.js';
import { checkMustChangePassword } from '../../shared/change-password.js';
import { initLoginGuard, registerLoginDevice } from '../../shared/login-guard.js';
import {
    supabase,
    getCurrentUserRow,
    logout,
    fetchSchoolConfig,
    fetchDutySchedules,
    fetchLateArrivals,
    fetchAttendanceSummary,
} from './api.js';
import { showPwaBanner } from '../../shared/pwa-banner.js';

// ── DOM refs ───────────────────────────────────────────────────
const portalTitle    = document.getElementById('portal-title');
const portalUserName = document.getElementById('portal-user-name');
const logoutBtn      = document.getElementById('logout-btn');
const loadingEl      = document.getElementById('loading');
const tabNav         = document.getElementById('tab-nav');
const bottomNav      = document.getElementById('tu-bottom-nav');
const ALL_SECTIONS   = ['section-piket', 'section-late', 'section-attendance'];
const tabBtns        = document.querySelectorAll('.tab-btn');

let currentUser  = null;
let schoolConfig = null;

// Data cache untuk export CSV
let _cachedPiket      = [];
let _cachedLate       = [];
let _cachedAttendance = [];

// ── Tab navigation ─────────────────────────────────────────────
function showTab(sectionId) {
    ALL_SECTIONS.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    const target = document.getElementById(sectionId);
    if (target) target.style.display = 'block';
    tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === sectionId));
}

tabBtns.forEach(btn => {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
});

// ── Helpers ────────────────────────────────────────────────────
function esc(str) {
    const el = document.createElement('span');
    el.textContent = String(str ?? '');
    return el.innerHTML;
}

function formatDate(d) {
    if (!d) return '-';
    return new Date(d + 'T00:00:00').toLocaleDateString('id-ID', {
        day: 'numeric', month: 'short', year: 'numeric',
    });
}

function localDateStr(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function fe(err) {
    console.error('[tu]', err);
    const m = String(err?.message ?? '').toLowerCase();
    if (m.includes('jwt') || m.includes('expired')) return 'Sesi habis. Silakan login ulang.';
    if (m.includes('fetch') || m.includes('network') || m.includes('failed to fetch')) return 'Tidak ada koneksi.';
    return 'Gagal memuat data. Silakan coba lagi.';
}

// ── CSV Export ─────────────────────────────────────────────────
function downloadCSV(rows, filename) {
    const BOM = '﻿';
    const csv  = BOM + rows.map(row =>
        row.map(cell => {
            const s = String(cell ?? '');
            return (s.includes(',') || s.includes('"') || s.includes('\n'))
                ? '"' + s.replace(/"/g, '""') + '"'
                : s;
        }).join(',')
    ).join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ── Tab 1: Jadwal Piket ────────────────────────────────────────
const DOW_ORDER = { SENIN: 0, SELASA: 1, RABU: 2, KAMIS: 3, JUMAT: 4, SABTU: 5 };
const DOW_LABEL = { SENIN: 'Senin', SELASA: 'Selasa', RABU: 'Rabu',
                    KAMIS: 'Kamis', JUMAT: 'Jumat', SABTU: 'Sabtu' };

async function loadPiket() {
    const year    = document.getElementById('piket-year').value;
    const sem     = document.getElementById('piket-semester').value;
    const btn     = document.getElementById('btn-piket-filter');
    const content = document.getElementById('piket-content');

    btn.disabled      = true;
    btn.textContent   = 'Memuat…';
    content.innerHTML = '<p class="hint">Memuat jadwal piket…</p>';

    try {
        const rows = await fetchDutySchedules(year, sem);
        _cachedPiket = rows;

        if (!rows.length) {
            content.innerHTML = '<p class="hint">Tidak ada jadwal piket aktif untuk periode ini.</p>';
            return;
        }

        // Kelompokkan per hari
        const byDay = {};
        for (const r of rows) {
            if (!byDay[r.day_of_week]) byDay[r.day_of_week] = [];
            byDay[r.day_of_week].push(r.teacher_name);
        }
        const days = Object.keys(byDay).sort((a, b) => (DOW_ORDER[a] ?? 9) - (DOW_ORDER[b] ?? 9));

        content.innerHTML = days.map(dow => `
            <div class="piket-day-card">
                <div class="piket-day-label">${esc(DOW_LABEL[dow] ?? dow)}</div>
                <ul class="piket-teacher-list">
                    ${byDay[dow].map(name => `<li>${esc(name)}</li>`).join('')}
                </ul>
            </div>
        `).join('');

    } catch (err) {
        content.innerHTML = `<p class="hint">Gagal memuat jadwal. ${esc(fe(err))}</p>`;
    } finally {
        btn.disabled    = false;
        btn.textContent = 'Tampilkan';
    }
}

document.getElementById('btn-piket-filter').addEventListener('click', loadPiket);

document.getElementById('btn-export-piket').addEventListener('click', () => {
    if (!_cachedPiket.length) { alert('Tampilkan data dulu sebelum export.'); return; }
    const header = [['Hari', 'Nama Guru', 'Tahun Ajaran', 'Semester']];
    const rows   = _cachedPiket.map(r => [
        DOW_LABEL[r.day_of_week] ?? r.day_of_week,
        r.teacher_name,
        r.academic_year,
        `Semester ${r.semester}`,
    ]);
    downloadCSV([...header, ...rows], `jadwal-piket-${Date.now()}.csv`);
});

// ── Tab 2: Keterlambatan ───────────────────────────────────────
const lateHintEl  = document.getElementById('late-hint');
const lateSummary = document.getElementById('late-summary');
const lateTable   = document.getElementById('late-table');
const lateTbody   = document.getElementById('late-tbody');
const lateEmpty   = document.getElementById('late-empty');

async function loadLate() {
    const dateStart = document.getElementById('late-date-start').value;
    const dateEnd   = document.getElementById('late-date-end').value;
    const btn       = document.getElementById('btn-late-filter');

    btn.disabled              = true;
    btn.textContent           = 'Memuat…';
    lateHintEl.style.display  = 'none';
    lateSummary.style.display = 'none';
    lateTable.style.display   = 'none';
    lateEmpty.style.display   = 'none';
    lateTbody.innerHTML       = '';

    try {
        const rows = await fetchLateArrivals(dateStart || null, dateEnd || null);
        _cachedLate = rows;

        if (!rows.length) {
            lateEmpty.style.display = 'block';
            return;
        }

        lateSummary.innerHTML = `
            <div class="summary-card card-late">
                <span class="count">${rows.length}</span>
                <span class="label">Total Keterlambatan</span>
            </div>`;
        lateSummary.style.display = 'flex';

        lateTbody.innerHTML = rows.map(r => `
            <tr>
                <td>${esc(formatDate(r.date))}</td>
                <td>${esc(r.arrival_time)}</td>
                <td>${esc(r.student_name)}</td>
                <td>${esc(r.nis)}</td>
                <td>${esc(r.reason || '—')}</td>
            </tr>`).join('');
        lateTable.style.display = 'table';

    } catch (err) {
        lateHintEl.textContent   = `Gagal memuat data. ${esc(fe(err))}`;
        lateHintEl.style.display = 'block';
    } finally {
        btn.disabled    = false;
        btn.textContent = 'Tampilkan';
    }
}

document.getElementById('btn-late-filter').addEventListener('click', loadLate);

document.getElementById('btn-export-late').addEventListener('click', () => {
    if (!_cachedLate.length) { alert('Tampilkan data dulu sebelum export.'); return; }
    const header = [['Tanggal', 'Jam Datang', 'Nama Siswa', 'NIS', 'Alasan']];
    const rows   = _cachedLate.map(r => [
        formatDate(r.date), r.arrival_time, r.student_name, r.nis, r.reason || '',
    ]);
    downloadCSV([...header, ...rows], `keterlambatan-${Date.now()}.csv`);
});

// ── Tab 3: Rekap Kehadiran ─────────────────────────────────────
const attHintEl  = document.getElementById('att-hint');
const attSummary = document.getElementById('att-summary');
const attTable   = document.getElementById('att-table');
const attTbody   = document.getElementById('att-tbody');
const attEmpty   = document.getElementById('att-empty');

const STATUS_LABEL = { ALPA: 'Alpa', IZIN: 'Izin', SAKIT: 'Sakit' };
const STATUS_BADGE = { ALPA: 'badge-danger', IZIN: 'badge-warning', SAKIT: 'badge-info' };

async function loadAttendance() {
    const dateStart    = document.getElementById('att-date-start').value;
    const dateEnd      = document.getElementById('att-date-end').value;
    const statusFilter = document.getElementById('att-status').value;
    const btn          = document.getElementById('btn-att-filter');

    const statuses = statusFilter ? [statusFilter] : ['ALPA', 'IZIN', 'SAKIT'];

    btn.disabled             = true;
    btn.textContent          = 'Memuat…';
    attHintEl.style.display  = 'none';
    attSummary.style.display = 'none';
    attTable.style.display   = 'none';
    attEmpty.style.display   = 'none';
    attTbody.innerHTML       = '';

    try {
        const rows = await fetchAttendanceSummary(dateStart || null, dateEnd || null, statuses);
        _cachedAttendance = rows;

        if (!rows.length) {
            attEmpty.style.display = 'block';
            return;
        }

        const counts = { ALPA: 0, IZIN: 0, SAKIT: 0 };
        for (const r of rows) if (r.status in counts) counts[r.status]++;

        attSummary.innerHTML = `
            <div class="summary-card card-alpha">
                <span class="count">${counts.ALPA}</span>
                <span class="label">Alpa</span>
            </div>
            <div class="summary-card card-izin">
                <span class="count">${counts.IZIN}</span>
                <span class="label">Izin</span>
            </div>
            <div class="summary-card card-sakit">
                <span class="count">${counts.SAKIT}</span>
                <span class="label">Sakit</span>
            </div>`;
        attSummary.style.display = 'flex';

        attTbody.innerHTML = rows.map(r => `
            <tr>
                <td>${esc(formatDate(r.date))}</td>
                <td>${esc(r.student_name)}</td>
                <td>${esc(r.nis)}</td>
                <td>${esc(r.class_name)}</td>
                <td><span class="badge ${STATUS_BADGE[r.status] ?? ''}">${STATUS_LABEL[r.status] ?? r.status}</span></td>
                <td>${esc(r.notes || '—')}</td>
            </tr>`).join('');
        attTable.style.display = 'table';

    } catch (err) {
        attHintEl.textContent   = `Gagal memuat data. ${esc(fe(err))}`;
        attHintEl.style.display = 'block';
    } finally {
        btn.disabled    = false;
        btn.textContent = 'Tampilkan';
    }
}

document.getElementById('btn-att-filter').addEventListener('click', loadAttendance);

document.getElementById('btn-export-att').addEventListener('click', () => {
    if (!_cachedAttendance.length) { alert('Tampilkan data dulu sebelum export.'); return; }
    const header = [['Tanggal', 'Nama Siswa', 'NIS', 'Kelas', 'Status', 'Catatan']];
    const rows   = _cachedAttendance.map(r => [
        formatDate(r.date), r.student_name, r.nis, r.class_name,
        STATUS_LABEL[r.status] ?? r.status, r.notes || '',
    ]);
    downloadCSV([...header, ...rows], `rekap-kehadiran-${Date.now()}.csv`);
});

// ── Logout ─────────────────────────────────────────────────────
logoutBtn.addEventListener('click', async () => {
    await logout();
    window.location.replace(getLoginUrl());
});

// ── Init ───────────────────────────────────────────────────────
async function init() {
    const { data: authData } = await supabase.auth.getUser();
    if (!authData?.user) {
        window.location.replace(getLoginUrl());
        return;
    }

    currentUser = await getCurrentUserRow(authData.user);
    if (!currentUser || currentUser.role_type !== 'TU') {
        window.location.replace(getLoginUrl());
        return;
    }

    registerLoginDevice(supabase);
    portalUserName.textContent = currentUser.full_name;

    await Promise.all([
        applyBrandingById(currentUser.school_id, supabase),
        checkMustChangePassword(supabase, currentUser),
        initLoginGuard(supabase, currentUser),
        fetchSchoolConfig().then(cfg => { schoolConfig = cfg; }).catch(() => {}),
    ]);

    loadingEl.style.display = 'none';

    // Default filter tanggal: 30 hari terakhir
    const today    = new Date();
    const monthAgo = new Date(today);
    monthAgo.setDate(monthAgo.getDate() - 30);
    const todayStr    = localDateStr(today);
    const monthAgoStr = localDateStr(monthAgo);

    document.getElementById('late-date-start').value = monthAgoStr;
    document.getElementById('late-date-end').value   = todayStr;
    document.getElementById('att-date-start').value  = monthAgoStr;
    document.getElementById('att-date-end').value    = todayStr;

    // Isi dropdown tahun ajaran dari school_config
    const yearSelect  = document.getElementById('piket-year');
    const currentYear = schoolConfig?.current_academic_year ?? null;
    if (currentYear) {
        const [startYear] = currentYear.split('/').map(Number);
        const options = [currentYear, `${startYear - 1}/${startYear}`];
        yearSelect.innerHTML = options.map(y =>
            `<option value="${y}" ${y === currentYear ? 'selected' : ''}>${y}</option>`
        ).join('');
    }

    // Set semester default dari school_config
    const semSelect = document.getElementById('piket-semester');
    if (schoolConfig?.current_semester) {
        semSelect.value = String(schoolConfig.current_semester);
    }

    tabNav.style.display    = 'flex';
    bottomNav.style.display = 'block';

    showTab('section-piket');
    await loadPiket();
    showPwaBanner({ hasBottomNav: true });
}

init().catch(err => {
    console.error('[tu:init]', err);
    if (loadingEl) {
        loadingEl.textContent = 'Gagal memuat. Silakan refresh halaman.';
        loadingEl.style.color = 'red';
    }
});
