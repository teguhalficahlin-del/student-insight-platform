/**
 * @file kaprodi/js/dashboard.js
 *
 * Dashboard Kaprodi (PKL):
 *   1. Ringkasan siswa PKL pada program-nya
 *   2. Rekap absensi PKL (per siswa, rentang tanggal)
 *   3. Observasi DUDI untuk siswa PKL
 */

import {
    supabase,
    getCurrentUserRow,
    isKaprodi,
    effectiveProgramId,
    getProgram,
    logout,
    fetchPklStudents,
    fetchPklAttendance,
    fetchDudiObservations,
    fetchDudiPartners,
} from './api.js';

const titleEl      = document.getElementById('dash-title');
const userNameEl   = document.getElementById('dash-user-name');
const programEl    = document.getElementById('dash-program');
const logoutBtn    = document.getElementById('logout-btn');
const loadingEl    = document.getElementById('loading');
const dashBody     = document.getElementById('dash-body');

const statStudents = document.getElementById('stat-students');
const statPlaced   = document.getElementById('stat-placed');
const statUnplaced = document.getElementById('stat-unplaced');

const studentsTbody = document.querySelector('#students-table tbody');
const studentsEmpty = document.getElementById('students-empty');

const dudiTbody     = document.querySelector('#dudi-table tbody');
const dudiEmpty     = document.getElementById('dudi-empty');

const filterStart  = document.getElementById('filter-date-start');
const filterEnd    = document.getElementById('filter-date-end');
const btnFilter    = document.getElementById('btn-filter');
const recapTbody   = document.querySelector('#recap-table tbody');
const recapEmpty   = document.getElementById('recap-empty');

const obsListEl    = document.getElementById('observations-list');
const obsEmpty     = document.getElementById('observations-empty');

let students = [];
let currentProgramId = null;

const STATUS_LABELS = {
    HADIR:       'Hadir',
    TIDAK_HADIR: 'Tidak Hadir',
    IZIN:        'Izin',
    SAKIT:       'Sakit',
    EKSKUL:      'Ekskul',
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

    const userRow = await getCurrentUserRow();
    if (!isKaprodi(userRow)) {
        window.location.href = 'index.html';
        return;
    }

    userNameEl.textContent = userRow.full_name;

    const programId = effectiveProgramId(userRow);
    if (!programId) {
        loadingEl.textContent = 'Akun Kaprodi belum terhubung ke program keahlian. Hubungi admin sekolah.';
        return;
    }
    currentProgramId = programId;

    let program = null;
    try {
        program = await getProgram(programId);
    } catch (err) {
        loadingEl.textContent = 'Gagal memuat data program: ' + err.message;
        return;
    }
    programEl.textContent = program ? `${program.name} (${program.code})` : '—';
    titleEl.textContent = `Dashboard Kaprodi — ${program?.name ?? 'PKL'}`;

    try {
        students = await fetchPklStudents(programId);
    } catch (err) {
        loadingEl.textContent = 'Gagal memuat siswa PKL: ' + err.message;
        return;
    }

    renderSummary();
    renderStudents();

    // Default rentang: 30 hari terakhir
    const today = new Date();
    const monthAgo = new Date(today);
    monthAgo.setDate(monthAgo.getDate() - 30);
    filterStart.value = monthAgo.toISOString().slice(0, 10);
    filterEnd.value   = today.toISOString().slice(0, 10);

    loadingEl.style.display = 'none';
    dashBody.style.display = 'block';

    await Promise.all([loadDudiPartners(), loadRecap(), loadObservations()]);
}

async function loadDudiPartners() {
    dudiTbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--color-text-muted)">Memuat...</td></tr>';
    dudiEmpty.style.display = 'none';

    try {
        const rows = await fetchDudiPartners(currentProgramId);
        if (rows.length === 0) {
            dudiTbody.innerHTML = '';
            dudiEmpty.style.display = 'block';
            return;
        }
        dudiTbody.innerHTML = rows.map(d => `
            <tr>
                <td>${esc(d.org_name)}</td>
                <td>${esc(d.pic_name)}</td>
                <td>${esc(d.login)}</td>
            </tr>
        `).join('');
    } catch (err) {
        dudiTbody.innerHTML = `<tr><td colspan="3" class="hint">Gagal memuat: ${esc(err.message)}</td></tr>`;
    }
}

function renderSummary() {
    const placed = students.filter(s => s.has_placement).length;
    statStudents.textContent = students.length;
    statPlaced.textContent   = placed;
    statUnplaced.textContent = students.length - placed;
}

function renderStudents() {
    if (students.length === 0) {
        studentsTbody.innerHTML = '';
        studentsEmpty.style.display = 'block';
        return;
    }
    studentsEmpty.style.display = 'none';
    studentsTbody.innerHTML = students.map(s => `
        <tr>
            <td>${esc(s.full_name)}</td>
            <td>${esc(s.nis)}</td>
            <td>${esc(s.dudi_name)}</td>
            <td>${s.has_placement ? `${formatDate(s.start_date)} – ${formatDate(s.end_date)}` : '<span class="badge badge-tidak-hadir">Belum ditempatkan</span>'}</td>
        </tr>
    `).join('');
}

async function loadRecap() {
    recapTbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--color-text-muted)">Memuat...</td></tr>';
    recapEmpty.style.display = 'none';

    const ids = students.map(s => s.student_id);
    if (ids.length === 0) {
        recapTbody.innerHTML = '';
        recapEmpty.style.display = 'block';
        return;
    }

    try {
        const rows = await fetchPklAttendance(ids, filterStart.value, filterEnd.value);

        // Agregasi per siswa
        const byStudent = new Map();
        for (const s of students) {
            byStudent.set(s.student_id, { name: s.full_name, HADIR: 0, TIDAK_HADIR: 0, IZIN: 0, SAKIT: 0, total: 0 });
        }
        for (const r of rows) {
            const agg = byStudent.get(r.student_id);
            if (!agg) continue;
            if (agg[r.status] !== undefined) agg[r.status]++;
            agg.total++;
        }

        const recap = [...byStudent.values()];
        if (recap.every(a => a.total === 0)) {
            recapTbody.innerHTML = '';
            recapEmpty.style.display = 'block';
            return;
        }

        recapTbody.innerHTML = recap.map(a => {
            const pct = a.total > 0 ? Math.round((a.HADIR / a.total) * 100) : 0;
            return `
                <tr>
                    <td>${esc(a.name)}</td>
                    <td>${a.HADIR}</td>
                    <td>${a.SAKIT}</td>
                    <td>${a.IZIN}</td>
                    <td>${a.TIDAK_HADIR}</td>
                    <td>${a.total > 0 ? pct + '%' : '—'}</td>
                </tr>
            `;
        }).join('');

    } catch (err) {
        recapTbody.innerHTML = `<tr><td colspan="6" class="hint">Gagal memuat: ${esc(err.message)}</td></tr>`;
    }
}

async function loadObservations() {
    obsListEl.innerHTML = '<p class="hint">Memuat...</p>';
    obsEmpty.style.display = 'none';

    const ids = students.map(s => s.student_id);
    if (ids.length === 0) {
        obsListEl.innerHTML = '';
        obsEmpty.style.display = 'block';
        return;
    }

    const nameById = new Map(students.map(s => [s.student_id, s.full_name]));

    try {
        const rows = await fetchDudiObservations(ids);
        if (rows.length === 0) {
            obsListEl.innerHTML = '';
            obsEmpty.style.display = 'block';
            return;
        }

        obsListEl.innerHTML = rows.map(r => `
            <div class="obs-card obs-${r.sentiment.toLowerCase()}">
                <div class="obs-meta">
                    <strong>${esc(nameById.get(r.student_id) ?? 'Siswa')}</strong>
                    &middot; ${esc(r.author)}
                    &middot; ${DIMENSION_LABELS[r.dimension] || r.dimension}
                    &middot; ${formatDate(r.date)}
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
    el.textContent = str ?? '';
    return el.innerHTML;
}

btnFilter.addEventListener('click', loadRecap);

logoutBtn.addEventListener('click', async () => {
    await logout();
    window.location.href = 'index.html';
});

init();
