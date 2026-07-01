/**
 * @file guru/js/dashboard.js
 * Dashboard utama Portal Guru — 1 login, tab Guru + tab Jabatan.
 */

import { applyBrandingById } from '../../shared/branding.js';
import {
    supabase, logout, getCurrentUserRow, GURU_ROLES,
    getJabatan, jabatanLabel, getSchoolConfig,
    getMyScheduleForDate, getEnrolledStudents,
    getAttendanceForSession, upsertAttendance,
    getMyStudents, searchStudents, insertObservation,
    getWaliKelasInfo, getWaliAttendanceSummary,
    getProgram, fetchPklStudents, fetchNonPklStudents,
    fetchDudiPartners, fetchPklAttendance, fetchDudiObservations,
    createPlacement, bulkImportPkl,
    getSchoolStats, getAbsentTeachersToday,
    getJournalEntries, insertJournalEntry, deleteJournalEntry,
} from './api.js';

// ─── State ───────────────────────────────────────────────────
let currentUser  = null;
let config       = null;   // { current_academic_year, current_semester }
let jabatan      = [];
let myStudents   = [];     // for observation selector
let kpStudents   = [];     // kaprodi PKL students
let kpDudiList   = [];

const DIMENSION_LABELS = { AKADEMIK:'Akademik', KEHADIRAN:'Kehadiran', PERILAKU:'Perilaku', SOSIAL:'Sosial', AFEKTIF:'Afektif', BAKAT_MINAT:'Bakat & Minat', FISIK:'Fisik', LAINNYA:'Lainnya' };

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
    if (!currentUser || !GURU_ROLES.includes(currentUser.role_type)) {
        await supabase.auth.signOut();
        window.location.href = 'index.html';
        return;
    }

    applyBrandingById(currentUser.school_id, supabase);
    config  = await getSchoolConfig();
    jabatan = getJabatan(currentUser);

    // Header
    document.getElementById('hdr-name').textContent = currentUser.full_name;
    const NON_GURU_ROLES = new Set(['KEPSEK', 'WAKA_KESISWAAN', 'WAKA_KURIKULUM']);
    const isGuruBiasa = !NON_GURU_ROLES.has(currentUser.role_type);
    const roleLabel = jabatan.length
        ? (isGuruBiasa ? 'Guru' : '') +
          (isGuruBiasa && jabatan.length ? ' · ' : '') +
          jabatan.map(jabatanLabel).join(' · ')
        : 'Guru';
    document.getElementById('hdr-role').textContent = roleLabel;

    buildTabs();
    document.getElementById('loading').style.display = 'none';
    document.getElementById('app').style.display     = 'block';

    activateTab('guru');
    await initGuruTab();
}

// ─── Tab navigation ──────────────────────────────────────────
function buildTabs() {
    const nav = document.getElementById('tab-nav');
    const tabs = [{ key: 'guru', label: 'Dashboard Guru' }];
    jabatan.forEach(j => tabs.push({ key: j, label: jabatanLabel(j) }));
    tabs.push({ key: 'jurnal', label: 'Jurnal Mengajar' });

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
        case 'guru':        await initGuruTab(); break;
        case 'wali_kelas':  await initWaliTab(); break;
        case 'bk':          await initBkTab(); break;
        case 'kaprodi':     await initKaprodiTab(); break;
        case 'waka_kesiswaan': break;  // placeholder
        case 'waka_kurikulum': await initWakaKurTab(); break;
        case 'kepsek':      await initKepsekTab(); break;
        case 'jurnal':      await initJurnalTab(); break;
    }
}

// ─── TAB GURU ────────────────────────────────────────────────

let _guruTabInit = false;
async function initGuruTab() {
    const dateEl = document.getElementById('sched-date');
    if (!dateEl.value) dateEl.value = new Date().toISOString().slice(0, 10);

    if (!_guruTabInit) {
        _guruTabInit = true;
        document.getElementById('sched-refresh').onclick = () => loadSchedule();
        dateEl.addEventListener('change', loadSchedule);
    }

    await loadSchedule();
    await initObsForm();
}

async function loadSchedule() {
    const date       = document.getElementById('sched-date').value;
    const contentEl  = document.getElementById('sched-content');
    contentEl.innerHTML = '<p class="hint">Memuat jadwal…</p>';

    try {
        const rows = await getMyScheduleForDate(currentUser.user_id, date);
        if (rows.length === 0) {
            contentEl.innerHTML = '<p class="hint">Tidak ada jadwal mengajar pada tanggal ini.</p>';
            return;
        }

        contentEl.innerHTML = `
            <div class="table-wrapper">
            <table class="table">
                <thead><tr><th>Jam</th><th>Kelas</th><th>Kehadiran</th></tr></thead>
                <tbody>
                ${rows.map(r => `
                    <tr>
                        <td>${fmtTime(r.session_start)} – ${fmtTime(r.session_end)}</td>
                        <td>${esc(r.class?.name ?? '—')}</td>
                        <td>
                            <button class="btn btn-primary btn-xs att-open-btn"
                                data-schedule="${r.schedule_id}"
                                data-class="${r.class?.class_id}"
                                data-classname="${esc(r.class?.name ?? '')}">
                                Input Kehadiran
                            </button>
                            <div class="att-panel" id="att-${r.schedule_id}" style="display:none"></div>
                        </td>
                    </tr>
                `).join('')}
                </tbody>
            </table>
            </div>`;

        contentEl.querySelectorAll('.att-open-btn').forEach(btn => {
            btn.addEventListener('click', () => toggleAttPanel(btn));
        });
    } catch (err) {
        contentEl.innerHTML = `<p class="hint" style="color:var(--color-danger)">Gagal memuat: ${esc(err.message)}</p>`;
    }
}

async function toggleAttPanel(btn) {
    const scheduleId = btn.dataset.schedule;
    const classId    = btn.dataset.class;
    const className  = btn.dataset.classname;
    const panel      = document.getElementById(`att-${scheduleId}`);

    if (panel.style.display !== 'none') {
        panel.style.display = 'none';
        btn.textContent = 'Input Kehadiran';
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Memuat…';
    panel.style.display = 'block';
    panel.innerHTML = '<p class="hint">Memuat daftar siswa…</p>';

    try {
        const [students, existing] = await Promise.all([
            getEnrolledStudents(classId, config.current_academic_year),
            getAttendanceForSession(scheduleId),
        ]);

        if (students.length === 0) {
            panel.innerHTML = '<p class="hint">Tidak ada siswa terdaftar di kelas ini.</p>';
            btn.disabled = false; btn.textContent = 'Input Kehadiran';
            return;
        }

        const statuses = ['HADIR','IZIN','SAKIT','TIDAK_HADIR'];
        const statusLabel = { HADIR:'Hadir', IZIN:'Izin', SAKIT:'Sakit', TIDAK_HADIR:'Alpha' };

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
            <h4>Kehadiran — ${esc(className)}</h4>
            ${accordionHtml}
            <div class="att-save-btn">
                <button class="btn btn-success btn-sm att-save" data-schedule="${scheduleId}" data-count="${students.length}">
                    Simpan Kehadiran (${students.length} siswa)
                </button>
                <span class="status-msg" id="att-status-${scheduleId}" style="display:none; margin-left:8px"></span>
            </div>`;

        panel.querySelector('.att-save').addEventListener('click', () => saveAttendance(scheduleId, students));
        btn.disabled = false;
        btn.textContent = 'Tutup';
    } catch (err) {
        panel.innerHTML = `<p class="hint" style="color:var(--color-danger)">Gagal: ${esc(err.message)}</p>`;
        btn.disabled = false; btn.textContent = 'Input Kehadiran';
    }
}

async function saveAttendance(scheduleId, students) {
    const saveBtn  = document.querySelector(`.att-save[data-schedule="${scheduleId}"]`);
    const statusEl = document.getElementById(`att-status-${scheduleId}`);
    saveBtn.disabled = true;
    saveBtn.textContent = 'Menyimpan…';
    statusEl.style.display = 'none';

    try {
        const rows = students.map(s => {
            const checked   = document.querySelector(`input[name="att_${scheduleId}_${s.student_id}"]:checked`);
            const status    = checked?.value ?? 'HADIR';
            const notesEl   = document.getElementById(`notes_${scheduleId}_${s.student_id}`);
            const notes     = status === 'IZIN' ? (notesEl?.value.trim() || null) : null;
            return { student_id: s.student_id, status, notes };
        });
        await upsertAttendance(scheduleId, rows);
        statusEl.textContent = `✓ Tersimpan — ${rows.length} siswa`;
        statusEl.className   = 'status-msg status-ok';
        statusEl.style.display = 'inline-block';
    } catch (err) {
        statusEl.textContent = `✗ ${err.message}`;
        statusEl.className   = 'status-msg status-err';
        statusEl.style.display = 'inline-block';
    } finally {
        saveBtn.disabled    = false;
        saveBtn.textContent = `Simpan Kehadiran (${students.length} siswa)`;
    }
}

// ── Observasi ─────────────────────────────────────────────────

async function initObsForm() {
    try {
        myStudents = await getMyStudents(
            currentUser.user_id,
            config.current_academic_year,
            config.current_semester
        );
    } catch (_) { myStudents = []; }

    const searchEl   = document.getElementById('obs-student-search');
    const hiddenEl   = document.getElementById('obs-student-id');
    const listEl     = document.getElementById('obs-student-list');
    const form       = document.getElementById('obs-form');
    const submitBtn  = document.getElementById('obs-submit');
    const statusEl   = document.getElementById('obs-status');

    // Observer berjangkauan luas (BK/Kaprodi/Waka Kesiswaan/Kepsek) bisa
    // mengamati siswa di luar kelas yang ia ajar — bahkan saat tak mengajar
    // sama sekali (myStudents kosong). Untuk mereka, lengkapi daftar dengan
    // pencarian sisi-server (cakupan dibatasi RLS).
    const isBroadObserver = jabatan.some(j => ['bk', 'kaprodi', 'waka_kesiswaan', 'kepsek'].includes(j));

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

    let searchSeq = 0;
    searchEl.addEventListener('input', async () => {
        const raw = searchEl.value.trim();
        const q   = raw.toLowerCase();
        if (q.length < 2) { listEl.style.display = 'none'; return; }

        // Hasil lokal (siswa yang diajar) lebih dulu.
        const local = myStudents.filter(s =>
            s.full_name.toLowerCase().includes(q) || s.nis?.includes(q)
        );

        if (!isBroadObserver) { renderHits(local.slice(0, 10)); return; }

        // Broad observer: gabung lokal + hasil server (dedup by student_id).
        const seq = ++searchSeq;
        let merged = local;
        try {
            const remote = await searchStudents(raw);
            if (seq !== searchSeq) return;   // input sudah berubah, abaikan
            const seen = new Set(local.map(s => s.student_id));
            merged = [...local, ...remote.filter(s => !seen.has(s.student_id))];
        } catch (_) { /* fallback ke lokal saja */ }
        renderHits(merged.slice(0, 12));
    });
    document.addEventListener('click', (e) => {
        if (!listEl.contains(e.target) && e.target !== searchEl) listEl.style.display = 'none';
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!hiddenEl.value) { alert('Pilih siswa terlebih dahulu.'); return; }
        statusEl.style.display = 'none';
        submitBtn.disabled = true;
        submitBtn.textContent = 'Menyimpan…';
        try {
            await insertObservation({
                authorId:   currentUser.user_id,
                studentId:  hiddenEl.value,
                dimension:  document.getElementById('obs-dimension').value,
                sentiment:  document.getElementById('obs-sentiment').value,
                visibility: document.getElementById('obs-visibility').value,
                content:    document.getElementById('obs-content').value,
            });
            statusEl.textContent    = '✓ Observasi berhasil disimpan.';
            statusEl.className      = 'status-msg status-ok';
            statusEl.style.display  = 'block';
            form.reset();
            hiddenEl.value = '';
        } catch (err) {
            statusEl.textContent   = `✗ ${err.message}`;
            statusEl.className     = 'status-msg status-err';
            statusEl.style.display = 'block';
        } finally {
            submitBtn.disabled    = false;
            submitBtn.textContent = 'Simpan Observasi';
        }
    });
}

// ─── TAB WALI KELAS ──────────────────────────────────────────

async function initWaliTab() {
    const classId = currentUser.wali_kelas_class_id;
    if (!classId) return;

    const info = await getWaliKelasInfo(classId);
    document.getElementById('wali-class-title').textContent =
        `Kelas Walian — ${info?.name ?? ''}`;

    const today    = new Date().toISOString().slice(0, 10);
    const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
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
    tbody.innerHTML = '<tr><td colspan="7" class="hint">Memuat…</td></tr>';
    emptyEl.style.display = 'none';

    try {
        const rows = await getWaliAttendanceSummary(classId, config.current_academic_year, start, end);
        if (rows.length === 0) {
            tbody.innerHTML = '';
            emptyEl.style.display = 'block';
            return;
        }
        tbody.innerHTML = rows.map(r => {
            const pct = r.total > 0 ? Math.round(r.HADIR / r.total * 100) : 0;
            return `<tr>
                <td>${esc(r.full_name)}</td>
                <td>${esc(r.nis)}</td>
                <td>${r.HADIR}</td>
                <td>${r.IZIN}</td>
                <td>${r.SAKIT}</td>
                <td>${r.TIDAK_HADIR}</td>
                <td>${r.total > 0 ? pct + '%' : '—'}</td>
            </tr>`;
        }).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" style="color:var(--color-danger)">${esc(err.message)}</td></tr>`;
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
        hintEl.textContent = `Gagal memuat: ${err.message}`;
    }
}

// ─── TAB KAPRODI ─────────────────────────────────────────────

async function initKaprodiTab() {
    const programId = currentUser.kaprodi_program_id ??
        (currentUser.role_type === 'KAPRODI' ? currentUser.program_id : null);
    if (!programId) {
        document.getElementById('tab-kaprodi').querySelector('.page-body').innerHTML =
            '<div class="section-card"><p class="hint">Akun ini belum terhubung ke program keahlian. Hubungi admin.</p></div>';
        return;
    }

    try {
        const [program, students, dudi] = await Promise.all([
            getProgram(programId),
            fetchPklStudents(programId),
            fetchDudiPartners(programId),
        ]);
        kpStudents = students;
        kpDudiList = dudi;

        renderKpSummary();
        renderKpStudents();
        renderKpDudi();

        const today    = new Date().toISOString().slice(0, 10);
        const monthAgo = new Date(Date.now() - 30*86400000).toISOString().slice(0,10);
        document.getElementById('kp-date-start').value = monthAgo;
        document.getElementById('kp-date-end').value   = today;

        document.getElementById('kp-filter-btn').onclick = loadKpRecap;
        await Promise.all([loadKpRecap(), loadKpObs(), initKpPlacementForm(programId)]);
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
    const empty = document.getElementById('kp-students-empty');
    if (kpStudents.length === 0) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
    empty.style.display = 'none';
    tbody.innerHTML = kpStudents.map(s => `<tr>
        <td>${esc(s.full_name)}</td><td>${esc(s.nis)}</td>
        <td>${esc(s.dudi_name)}</td>
        <td>${s.has_placement ? `${fmt(s.start_date)} – ${fmt(s.end_date)}` : '<span class="badge badge-tidak-hadir">Belum</span>'}</td>
    </tr>`).join('');
}

function renderKpDudi() {
    const tbody = document.getElementById('kp-dudi-body');
    const empty = document.getElementById('kp-dudi-empty');
    if (kpDudiList.length === 0) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
    empty.style.display = 'none';
    tbody.innerHTML = kpDudiList.map(d => `<tr>
        <td>${esc(d.org_name)}</td><td>${esc(d.pic_name)}</td><td>${esc(d.login)}</td>
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
        const byStudent = new Map(kpStudents.map(s => [s.student_id, { name: s.full_name, HADIR:0, TIDAK_HADIR:0, IZIN:0, SAKIT:0, total:0 }]));
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
            return `<tr><td>${esc(a.name)}</td><td>${a.HADIR}</td><td>${a.SAKIT}</td><td>${a.IZIN}</td><td>${a.TIDAK_HADIR}</td><td>${a.total > 0 ? pct+'%' : '—'}</td></tr>`;
        }).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="6" style="color:var(--color-danger)">${esc(err.message)}</td></tr>`;
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
        listEl.innerHTML = `<p class="hint" style="color:var(--color-danger)">${esc(err.message)}</p>`;
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
            resultEl.innerHTML = `<p style="color:var(--color-danger)">✗ ${esc(err.message)}</p>`;
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
            resultEl.innerHTML = `<p style="color:var(--color-danger)">✗ ${esc(err.message)}</p>`;
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
        hintEl.textContent = `Gagal memuat: ${err.message}`;
    }
}

// ─── TAB KEPSEK ──────────────────────────────────────────────

async function initKepsekTab() {
    try {
        const stats = await getSchoolStats(config.current_academic_year, config.current_semester);
        document.getElementById('ks-siswa').textContent  = stats.total_siswa;
        document.getElementById('ks-staf').textContent   = stats.total_staf;
        document.getElementById('ks-sesi').textContent   = stats.sesi_hari_ini;
        document.getElementById('ks-hadir').textContent  = stats.kehadiran_hari_ini;
    } catch (err) {
        console.error('[kepsek]', err);
    }
}

// ─── TAB JURNAL MENGAJAR ─────────────────────────────────────

let _jurnalTabInit = false;
async function initJurnalTab() {
    if (_jurnalTabInit) return;
    _jurnalTabInit = true;

    // Tanggal default hari ini, tersembunyi
    const dateEl = document.getElementById('journal-date');
    dateEl.value = new Date().toISOString().slice(0, 10);

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
            await insertJournalEntry(currentUser.user_id, date, content);
            document.getElementById('journal-content').value = '';
            msgEl.textContent = 'Catatan berhasil disimpan.';
            msgEl.style.display = 'block';
            await loadJurnalList();
        } catch (err) {
            msgEl.textContent = 'Gagal menyimpan: ' + err.message;
            msgEl.style.display = 'block';
        } finally {
            btn.disabled = false;
            btn.textContent = 'Simpan';
        }
    });
}

async function loadJurnalList() {
    const listEl = document.getElementById('journal-list');
    listEl.innerHTML = '<p class="hint">Memuat…</p>';
    try {
        const entries = await getJournalEntries(currentUser.user_id);
        if (!entries.length) {
            listEl.innerHTML = '<p class="hint">Belum ada catatan.</p>';
            return;
        }
        listEl.innerHTML = entries.map(e => `
            <div class="section-card" style="margin-bottom:8px">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                    <strong>${fmt(e.entry_date)}</strong>
                    <button class="btn btn-secondary btn-sm" data-delete="${esc(e.journal_id)}">Hapus</button>
                </div>
                <p style="white-space:pre-wrap;margin:0">${esc(e.content)}</p>
            </div>
        `).join('');

        listEl.querySelectorAll('[data-delete]').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!confirm('Hapus catatan ini?')) return;
                btn.disabled = true;
                try {
                    await deleteJournalEntry(btn.dataset.delete);
                    await loadJurnalList();
                } catch (err) {
                    alert('Gagal menghapus: ' + err.message);
                    btn.disabled = false;
                }
            });
        });
    } catch (err) {
        listEl.innerHTML = `<p class="hint">Gagal memuat: ${esc(err.message)}</p>`;
    }
}

// ─── Logout ──────────────────────────────────────────────────

document.getElementById('logout-btn')?.addEventListener('click', async () => {
    await logout();
    window.location.href = 'index.html';
});

// ─── Start ───────────────────────────────────────────────────
init();
