/**
 * @file student/js/dashboard.js
 * Dashboard Portal Siswa — jadwal, kehadiran diri, observasi, status PKL.
 */

import {
    supabase, logout, getCurrentUserRow, STUDENT_ROLES,
    getMyStudent, getSchoolConfig, getMyClass,
    getScheduleForDate, getMyAttendance, getMyObservations,
    getMyPklPlacement, getMyPklAttendance,
} from './api.js';

// ─── State ───────────────────────────────────────────────────
let currentUser = null;
let student     = null;   // baris students milik user
let config      = null;   // { current_academic_year, current_semester }
let myClass     = null;   // enrollment + class
let obsLoaded   = false;
let pklLoaded   = false;

const DIMENSION_LABELS = { AKADEMIK:'Akademik', KEHADIRAN:'Kehadiran', PERILAKU:'Perilaku', SOSIAL:'Sosial', AFEKTIF:'Afektif', BAKAT_MINAT:'Bakat & Minat', FISIK:'Fisik', LAINNYA:'Lainnya' };
const STATUS_LABELS    = { HADIR:'Hadir', IZIN:'Izin', SAKIT:'Sakit', TIDAK_HADIR:'Alpha', EKSKUL:'Ekskul' };
const STATUS_BADGE     = { HADIR:'badge-hadir', IZIN:'badge-izin', SAKIT:'badge-sakit', TIDAK_HADIR:'badge-tidak-hadir', EKSKUL:'badge-ekskul' };

function esc(s) {
    const el = document.createElement('span');
    el.textContent = s ?? '';
    return el.innerHTML;
}
function fmt(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('id-ID', { day:'numeric', month:'short', year:'numeric' });
}
function fmtTime(t) { return t ? t.slice(0, 5) : '—'; }

// ─── Boot ────────────────────────────────────────────────────
async function init() {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) { window.location.href = 'index.html'; return; }

    currentUser = await getCurrentUserRow();
    if (!currentUser || !STUDENT_ROLES.includes(currentUser.role_type)) {
        await supabase.auth.signOut();
        window.location.href = 'index.html';
        return;
    }

    config  = await getSchoolConfig();
    student = await getMyStudent(currentUser.user_id);

    if (!student) {
        // Akun SISWA belum tertaut ke data siswa
        document.getElementById('loading').textContent =
            'Akun ini belum tertaut ke data siswa. Hubungi admin sekolah.';
        return;
    }

    myClass = await getMyClass(student.student_id, config.current_academic_year).catch(() => null);

    // Header
    document.getElementById('hdr-name').textContent = student.full_name;
    document.getElementById('hdr-meta').textContent =
        `NIS ${student.nis} · ${myClass?.class?.name ?? student.program?.name ?? 'Siswa'}`;

    buildTabs();
    document.getElementById('loading').style.display = 'none';
    document.getElementById('app').style.display     = 'block';

    activateTab('jadwal');
    await initJadwalTab();
}

// ─── Tab navigation ──────────────────────────────────────────
function buildTabs() {
    const nav  = document.getElementById('tab-nav');
    const tabs = [
        { key: 'jadwal',    label: 'Jadwal' },
        { key: 'kehadiran', label: 'Kehadiran' },
        { key: 'observasi', label: 'Observasi' },
    ];
    if (student.student_status === 'PKL') tabs.push({ key: 'pkl', label: 'PKL' });

    nav.innerHTML = tabs.map(t =>
        `<button class="tab-btn" data-tab="${t.key}">${esc(t.label)}</button>`
    ).join('');

    nav.addEventListener('click', async (e) => {
        const key = e.target.dataset?.tab;
        if (!key) return;
        activateTab(key);
        await loadTabContent(key);
    });
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
        case 'kehadiran': await loadAttendance(); break;
        case 'observasi': if (!obsLoaded) await loadObservations(); break;
        case 'pkl':       if (!pklLoaded) await loadPkl(); break;
    }
}

// ─── TAB JADWAL ──────────────────────────────────────────────

async function initJadwalTab() {
    const dateEl = document.getElementById('sched-date');
    if (!dateEl.value) dateEl.value = new Date().toISOString().slice(0, 10);
    document.getElementById('sched-refresh').onclick = () => loadSchedule();
    dateEl.addEventListener('change', loadSchedule);
    await loadSchedule();
}

async function loadSchedule() {
    const date      = document.getElementById('sched-date').value;
    const contentEl = document.getElementById('sched-content');

    if (!myClass?.class_id) {
        contentEl.innerHTML = '<p class="hint">Kamu belum terdaftar di kelas pada tahun ajaran ini.</p>';
        return;
    }

    contentEl.innerHTML = '<p class="hint">Memuat jadwal…</p>';
    try {
        const rows = await getScheduleForDate(myClass.class_id, date);
        if (rows.length === 0) {
            contentEl.innerHTML = '<p class="hint">Tidak ada jadwal pelajaran pada tanggal ini.</p>';
            return;
        }
        contentEl.innerHTML = `
            <div class="table-wrapper">
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
    } catch (err) {
        contentEl.innerHTML = `<p class="hint" style="color:var(--color-danger)">Gagal memuat: ${esc(err.message)}</p>`;
    }
}

// ─── TAB KEHADIRAN ───────────────────────────────────────────

let attInit = false;
async function loadAttendance() {
    if (!attInit) {
        const today    = new Date().toISOString().slice(0, 10);
        const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
        document.getElementById('att-date-start').value = monthAgo;
        document.getElementById('att-date-end').value   = today;
        document.getElementById('att-filter-btn').onclick = loadAttendance;
        attInit = true;
    }

    const start   = document.getElementById('att-date-start').value;
    const end     = document.getElementById('att-date-end').value;
    const tbody   = document.getElementById('att-body');
    const emptyEl = document.getElementById('att-empty');
    tbody.innerHTML = '<tr><td colspan="3" class="hint">Memuat…</td></tr>';
    emptyEl.style.display = 'none';

    try {
        const rows = await getMyAttendance(student.student_id, start, end);
        const agg = { HADIR:0, IZIN:0, SAKIT:0, TIDAK_HADIR:0, EKSKUL:0, total:0 };
        for (const r of rows) {
            if (agg[r.status] !== undefined) agg[r.status]++;
            agg.total++;
        }
        const pct = agg.total > 0 ? Math.round(agg.HADIR / agg.total * 100) : 0;
        document.getElementById('att-hadir').textContent = agg.HADIR;
        document.getElementById('att-izin').textContent  = agg.IZIN;
        document.getElementById('att-sakit').textContent = agg.SAKIT;
        document.getElementById('att-alpha').textContent = agg.TIDAK_HADIR;
        document.getElementById('att-pct').textContent   = agg.total > 0 ? pct + '%' : '—';

        if (rows.length === 0) {
            tbody.innerHTML = '';
            emptyEl.style.display = 'block';
            return;
        }
        tbody.innerHTML = rows.map(r => {
            const dt = r.schedule?.session_date ?? r.created_at;
            return `<tr>
                <td>${fmt(dt)}</td>
                <td>${esc(r.schedule?.subject?.name ?? '—')}</td>
                <td><span class="badge ${STATUS_BADGE[r.status] ?? ''}">${esc(STATUS_LABELS[r.status] ?? r.status)}</span></td>
            </tr>`;
        }).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="3" style="color:var(--color-danger)">${esc(err.message)}</td></tr>`;
    }
}

// ─── TAB OBSERVASI ───────────────────────────────────────────

async function loadObservations() {
    const hintEl = document.getElementById('obs-hint');
    const listEl = document.getElementById('obs-list');
    hintEl.style.display = 'block';
    hintEl.textContent   = 'Memuat observasi…';
    listEl.innerHTML     = '';

    try {
        const rows = await getMyObservations(student.student_id);
        obsLoaded = true;
        if (rows.length === 0) {
            hintEl.textContent = 'Belum ada observasi yang dibagikan untukmu.';
            return;
        }
        hintEl.style.display = 'none';
        listEl.innerHTML = rows.map(r => `
            <div class="obs-card obs-${(r.sentiment ?? '').toLowerCase()}">
                <div class="obs-meta">
                    ${esc(DIMENSION_LABELS[r.dimension] ?? r.dimension)}
                    &middot; oleh ${esc(r.author?.full_name ?? '—')}
                    &middot; ${fmt(r.observed_at ?? r.created_at)}
                </div>
                <p class="obs-content">${esc(r.content)}</p>
            </div>`).join('');
    } catch (err) {
        hintEl.textContent = `Gagal memuat: ${err.message}`;
    }
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
        const agg = { HADIR:0, IZIN:0, SAKIT:0, TIDAK_HADIR:0, total:0 };
        for (const r of att) {
            if (agg[r.status] !== undefined) agg[r.status]++;
            agg.total++;
        }
        const pct = agg.total > 0 ? Math.round(agg.HADIR / agg.total * 100) : 0;
        document.getElementById('pkl-hadir').textContent = agg.HADIR;
        document.getElementById('pkl-izin').textContent  = agg.IZIN;
        document.getElementById('pkl-sakit').textContent = agg.SAKIT;
        document.getElementById('pkl-alpha').textContent = agg.TIDAK_HADIR;
        document.getElementById('pkl-pct').textContent   = agg.total > 0 ? pct + '%' : '—';
        statsEl.style.display = 'flex';

        if (att.length > 0) {
            recapCard.style.display = 'block';
            recapBody.innerHTML = att.map(r => `<tr>
                <td>${fmt(r.attendance_date)}</td>
                <td><span class="badge ${STATUS_BADGE[r.status] ?? ''}">${esc(STATUS_LABELS[r.status] ?? r.status)}</span></td>
            </tr>`).join('');
        }
    } catch (err) {
        infoEl.innerHTML = `<p class="hint" style="color:var(--color-danger)">Gagal memuat: ${esc(err.message)}</p>`;
    }
}

// ─── Logout ──────────────────────────────────────────────────

document.getElementById('logout-btn')?.addEventListener('click', async () => {
    await logout();
    window.location.href = 'index.html';
});

// ─── Start ───────────────────────────────────────────────────
init();
