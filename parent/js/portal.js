/**
 * @file parent/js/portal.js
 *
 * Main logic for the parent portal.
 * Loads children, lets parent pick one, shows attendance + observations.
 */

import {
    supabase,
    getCurrentUserRow,
    logout,
    fetchChildren,
    fetchAttendance,
    fetchObservations,
} from './api.js';

const portalTitle    = document.getElementById('portal-title');
const portalUserName = document.getElementById('portal-user-name');
const logoutBtn      = document.getElementById('logout-btn');
const loadingEl      = document.getElementById('loading');
const childSelector  = document.getElementById('child-selector');
const selectChild    = document.getElementById('select-child');
const sectionAtt     = document.getElementById('section-attendance');
const sectionObs     = document.getElementById('section-observations');
const attSummary     = document.getElementById('attendance-summary');
const attTbody       = document.querySelector('#attendance-table tbody');
const attEmpty       = document.getElementById('attendance-empty');
const obsListEl      = document.getElementById('observations-list');
const obsEmpty       = document.getElementById('observations-empty');
const filterStart    = document.getElementById('filter-date-start');
const filterEnd      = document.getElementById('filter-date-end');
const btnFilter      = document.getElementById('btn-filter');

let currentUser = null;
let children    = [];

const STATUS_LABELS = {
    HADIR:       'Hadir',
    TIDAK_HADIR: 'Tidak Hadir',
    IZIN:        'Izin',
    SAKIT:       'Sakit',
    EKSKUL:      'Ekskul',
};

const STATUS_BADGE = {
    HADIR:       'badge-hadir',
    TIDAK_HADIR: 'badge-tidak-hadir',
    IZIN:        'badge-izin',
    SAKIT:       'badge-sakit',
    EKSKUL:      'badge-ekskul',
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
        window.location.href = 'index.html';
        return;
    }

    currentUser = await getCurrentUserRow();
    if (!currentUser || currentUser.role_type !== 'ORTU') {
        window.location.href = 'index.html';
        return;
    }

    portalUserName.textContent = currentUser.full_name;

    try {
        children = await fetchChildren(currentUser.user_id);
    } catch (err) {
        loadingEl.textContent = 'Gagal memuat data anak: ' + err.message;
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

    loadingEl.style.display = 'none';
    sectionAtt.style.display = 'block';
    sectionObs.style.display = 'block';

    await loadChildData(0);
}

async function loadChildData(index) {
    const child = children[index];
    portalTitle.textContent = `Portal Orang Tua — ${child.full_name}`;

    await Promise.all([
        loadAttendance(child.student_id),
        loadObservations(child.student_id),
    ]);
}

async function loadAttendance(studentId) {
    attTbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--color-text-muted)">Memuat...</td></tr>';
    attEmpty.style.display = 'none';

    try {
        const rows = await fetchAttendance(studentId, filterStart.value, filterEnd.value);

        const counts = { HADIR: 0, TIDAK_HADIR: 0, IZIN: 0, SAKIT: 0, EKSKUL: 0 };
        for (const r of rows) {
            counts[r.status] = (counts[r.status] || 0) + 1;
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
                <span class="label">Tidak Hadir</span>
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
        attTbody.innerHTML = `<tr><td colspan="6" class="hint">Gagal memuat: ${esc(err.message)}</td></tr>`;
    }
}

async function loadObservations(studentId) {
    obsListEl.innerHTML = '<p class="hint">Memuat...</p>';
    obsEmpty.style.display = 'none';

    try {
        const rows = await fetchObservations(studentId);

        if (rows.length === 0) {
            obsListEl.innerHTML = '';
            obsEmpty.style.display = 'block';
            return;
        }

        obsListEl.innerHTML = rows.map(r => `
            <div class="obs-card obs-${r.sentiment.toLowerCase()}">
                <div class="obs-meta">
                    ${esc(r.author)} &middot; ${DIMENSION_LABELS[r.dimension] || r.dimension} &middot; ${formatDate(r.date)}
                </div>
                <p class="obs-content">${esc(r.content)}</p>
            </div>
        `).join('');

    } catch (err) {
        obsListEl.innerHTML = `<p class="hint">Gagal memuat: ${esc(err.message)}</p>`;
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

selectChild.addEventListener('change', () => loadChildData(Number(selectChild.value)));

btnFilter.addEventListener('click', () => {
    const idx = Number(selectChild.value);
    loadAttendance(children[idx].student_id);
});

logoutBtn.addEventListener('click', async () => {
    await logout();
    window.location.href = 'index.html';
});

init();
