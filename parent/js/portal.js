/**
 * @file parent/js/portal.js
 *
 * Main logic for the parent portal.
 * Loads children, lets parent pick one, shows attendance + observations.
 */

import { applyBrandingById, getLoginUrl } from '../../shared/branding.js';
import { checkMustChangePassword } from '../../shared/change-password.js';
import { initLoginGuard } from '../../shared/login-guard.js';
import {
    supabase,
    getCurrentUserRow,
    logout,
    fetchChildren,
    fetchSchedule,
    fetchAttendance,
    fetchObservations,
    fetchCases,
} from './api.js';

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
const sectionCases   = document.getElementById('section-cases');
const casesListEl    = document.getElementById('cases-list');
const casesEmpty     = document.getElementById('cases-empty');
const filterStart    = document.getElementById('filter-date-start');
const filterEnd      = document.getElementById('filter-date-end');
const btnFilter      = document.getElementById('btn-filter');

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

const STATUS_LABELS = {
    HADIR:       'Hadir',
    TIDAK_HADIR: 'Alpa',
    IZIN:        'Izin',
    SAKIT:       'Sakit',
    EKSKUL:      'Hadir',   // EKSKUL dihapus dari absensi → tampil sebagai Hadir (data lama)
};

const STATUS_BADGE = {
    HADIR:       'badge-hadir',
    TIDAK_HADIR: 'badge-tidak-hadir',
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
        window.location.href = getLoginUrl();
        return;
    }

    currentUser = await getCurrentUserRow();
    if (!currentUser || currentUser.role_type !== 'ORTU') {
        window.location.href = getLoginUrl();
        return;
    }

    applyBrandingById(currentUser.school_id, supabase);
    await checkMustChangePassword(supabase, currentUser);
    await initLoginGuard(supabase, currentUser);
    portalUserName.textContent = currentUser.full_name;

    try {
        children = await fetchChildren(currentUser.user_id);
    } catch (err) {
        loadingEl.textContent = fe(err);
        return;
    }

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
    filterStart.value = monthAgo.toISOString().slice(0, 10);
    filterEnd.value   = today.toISOString().slice(0, 10);
    schedDate.value   = today.toISOString().slice(0, 10);

    loadingEl.style.display = 'none';
    sectionSched.style.display = 'block';
    sectionAtt.style.display = 'block';
    sectionObs.style.display   = 'block';
    sectionCases.style.display = 'block';

    await loadChildData(0);
}

async function loadChildData(index) {
    const child = children[index];
    portalTitle.textContent = `Portal Orang Tua — ${child.full_name}`;

    await Promise.all([
        loadSchedule(child.class_id),
        loadAttendance(child.student_id),
        loadObservations(child.student_id),
        loadCases(child.student_id),
    ]);
}

async function loadSchedule(classId) {
    schedTbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--color-text-muted)">Memuat...</td></tr>';
    schedEmpty.style.display = 'none';

    if (!classId) {
        schedTbody.innerHTML = '';
        schedEmpty.textContent = 'Anak belum terdaftar di kelas pada tahun ajaran ini.';
        schedEmpty.style.display = 'block';
        return;
    }

    try {
        const rows = await fetchSchedule(classId, schedDate.value);
        if (rows.length === 0) {
            schedTbody.innerHTML = '';
            schedEmpty.textContent = 'Tidak ada jadwal pelajaran pada tanggal ini.';
            schedEmpty.style.display = 'block';
            return;
        }
        schedTbody.innerHTML = rows.map(r => `
            <tr>
                <td>${r.start?.slice(0, 5)} – ${r.end?.slice(0, 5)}</td>
                <td>${esc(r.subject)}</td>
                <td>${esc(r.teacher)}</td>
            </tr>
        `).join('');
    } catch (err) {
        schedTbody.innerHTML = `<tr><td colspan="3" class="hint">Gagal memuat data. ${esc(fe(err))}</td></tr>`;
    }
}

async function loadAttendance(studentId) {
    attTbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--color-text-muted)">Memuat...</td></tr>';
    attEmpty.style.display = 'none';

    try {
        const rows = await fetchAttendance(studentId, filterStart.value, filterEnd.value);

        const counts = { HADIR: 0, TIDAK_HADIR: 0, IZIN: 0, SAKIT: 0 };
        for (const r of rows) {
            // EKSKUL dihapus dari absensi → dihitung sebagai HADIR (kompat data lama)
            const st = r.status === 'EKSKUL' ? 'HADIR' : r.status;
            counts[st] = (counts[st] || 0) + 1;
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
                <span class="count">${counts.TIDAK_HADIR}</span>
                <span class="label">Alpa</span>
            </div>
        `;

        if (rows.length === 0) {
            attTbody.innerHTML = '';
            attEmpty.style.display = 'block';
            return;
        }

        attTbody.innerHTML = rows.map(r => `
            <tr>
                <td>${formatDate(r.date)}</td>
                <td>${r.start?.slice(0, 5)} – ${r.end?.slice(0, 5)}</td>
                <td>${esc(r.subject)}</td>
                <td>${esc(r.teacher)}</td>
                <td><span class="badge ${STATUS_BADGE[r.status] || ''}">${STATUS_LABELS[r.status] || r.status}</span></td>
                <td>${esc(r.notes || '-')}</td>
            </tr>
        `).join('');

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

async function loadObservations(studentId) {
    const cacheKey = `ortu-obs-${studentId}`;
    const cached   = LC.get(cacheKey);
    if (cached) {
        renderObsRows(cached);
    } else {
        obsListEl.innerHTML = '<p class="hint">Memuat...</p>';
        obsEmpty.style.display = 'none';
    }

    try {
        const rows = await fetchObservations(studentId);
        LC.set(cacheKey, rows);
        renderObsRows(rows);
    } catch (err) {
        if (!cached) obsListEl.innerHTML = `<p class="hint">Gagal memuat data. ${esc(fe(err))}</p>`;
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
            const eventsHtml = c.events.length === 0 ? '' : `
                <div style="margin-top:10px;border-top:1px solid var(--color-border,#e5e7eb);padding-top:10px">
                    ${c.events.map(e => `
                        <div style="margin-bottom:8px;font-size:0.85rem">
                            <span style="color:var(--color-text-muted,#6b7280)">${esc(e.author?.full_name ?? '—')} · ${formatDate(e.created_at)}</span>
                            <p style="margin:4px 0 0">${esc(e.content)}</p>
                        </div>`).join('')}
                </div>`;
            return `<div style="padding:14px;border:1px solid var(--color-border,#e5e7eb);border-radius:8px;margin-bottom:12px;border-left:3px solid ${isClosed ? '#9ca3af' : '#f59e0b'}">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:4px">
                    <strong>${esc(c.title)}</strong>
                    <span style="font-size:0.75rem;padding:2px 8px;border-radius:12px;background:${isClosed ? '#e5e7eb' : '#d1fae5'};color:${isClosed ? '#374151' : '#065f46'}">${CASE_STATUS_LABEL[c.status] ?? c.status}</span>
                </div>
                <div style="font-size:0.8rem;color:var(--color-text-muted,#6b7280);margin-top:4px">
                    Ditangani: ${esc(ROLE_LABEL_SHORT[c.current_handler_role] ?? c.current_handler_role ?? '—')} · ${formatDate(c.created_at)}
                </div>
                ${eventsHtml}
            </div>`;
        }).join('');
    } catch (err) {
        casesListEl.innerHTML = `<p class="hint">Gagal memuat data. ${esc(fe(err))}</p>`;
    }
}

selectChild.addEventListener('change', () => loadChildData(Number(selectChild.value)));

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

btnSchedule.addEventListener('click', async () => {
    const idx = Number(selectChild.value);
    const prev = btnSchedule.textContent;
    btnSchedule.disabled = true;
    btnSchedule.textContent = 'Memuat…';
    try {
        await loadSchedule(children[idx].class_id);
    } finally {
        btnSchedule.disabled = false;
        btnSchedule.textContent = prev;
    }
});

logoutBtn.addEventListener('click', async () => {
    LC.clear();
    await logout();
    window.location.href = getLoginUrl();
});

init();
