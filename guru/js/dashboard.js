/**
 * @file guru/js/dashboard.js
 * Dashboard utama Portal Guru — 1 login, tab Guru + tab Jabatan.
 */

import { applyBrandingById } from '../../shared/branding.js';
import { initIdleTimeout } from '../../shared/idle-timeout.js';
import {
    supabase, logout, getCurrentUserRow, GURU_ROLES,
    listSchoolAdmins, addSchoolAdmin, removeSchoolAdmin,
    getJabatan, jabatanLabel, getSchoolConfig,
    getMyScheduleForDate, getEnrolledStudents,
    getAttendanceForSession, upsertAttendance,
    getMyStudents, searchStudents, insertObservation,
    getWaliKelasInfo, getWaliAttendanceSummary,
    getProgram, fetchPklStudents, fetchNonPklStudents,
    fetchDudiPartners, fetchPklAttendance, fetchDudiObservations,
    createPlacement, bulkImportPkl,
    getSchoolStats, getAbsentTeachersToday,
    getAttendanceRecapPerClass, getOpenCases,
    getJournalEntries, insertJournalEntry, deleteJournalEntry,
    getCases, getCase, getCaseEvents, createCase,
    addCaseComment, escalateCase, changeCaseStatus, closeCase,
    countNewCaseEvents,
} from './api.js';
import { saveAttendanceBatch, flushPending, pendingCount, clearOfflineQueue } from './offline.js';

// ─── Kasus badge ─────────────────────────────────────────────
// Tampilkan angka di tab Kasus jika ada escalasi baru ke role user.
// last_seen disimpan di localStorage; di-update saat tab Kasus dibuka.

function _kasusBadgeKey() { return `kasus-seen-${currentUser?.user_id}`; }

function setKasusBadge(n) {
    document.querySelectorAll('[data-tab="kasus"]').forEach(btn => {
        let badge = btn.querySelector('.kasus-notif-badge');
        if (n > 0) {
            if (!badge) {
                badge = document.createElement('span');
                badge.className = 'kasus-notif-badge';
                badge.style.cssText = 'display:inline-block;min-width:18px;height:18px;line-height:18px;border-radius:9px;background:var(--color-danger,#dc2626);color:#fff;font-size:11px;font-weight:700;text-align:center;padding:0 4px;margin-left:5px;vertical-align:middle';
                btn.appendChild(badge);
            }
            badge.textContent = n > 99 ? '99+' : String(n);
        } else {
            badge?.remove();
        }
    });
}

async function refreshKasusBadge() {
    if (!currentUser?.role_type) return;
    const since = LC.get(_kasusBadgeKey()) ?? '2000-01-01T00:00:00Z';
    try {
        const n = await countNewCaseEvents(currentUser.role_type, since);
        setKasusBadge(n);
    } catch { /* tidak kritis — badge hilang saja */ }
}

function markKasusAsSeen() {
    LC.set(_kasusBadgeKey(), new Date().toISOString());
    setKasusBadge(0);
}

// ─── State ───────────────────────────────────────────────────
let currentUser  = null;
let config       = null;   // { current_academic_year, current_semester }
let jabatan      = [];
let isTeacher    = false;  // hanya GURU & WALI_KELAS yang mengajar
let myStudents   = [];     // for observation selector
let kpStudents   = [];     // kaprodi PKL students
let kpDudiList   = [];

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
    if (!auth?.user) { window.location.href = 'index.html'; return; }

    currentUser = await getCurrentUserRow();
    if (!currentUser || !GURU_ROLES.includes(currentUser.role_type) || currentUser.is_active === false) {
        await supabase.auth.signOut();
        window.location.href = 'index.html';
        return;
    }

    applyBrandingById(currentUser.school_id, supabase);
    initIdleTimeout({ onIdle: async () => { await logout(); window.location.href = 'index.html'; } });
    config  = await getSchoolConfig();
    jabatan   = getJabatan(currentUser);
    isTeacher = ['GURU', 'WALI_KELAS'].includes(currentUser.role_type);

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
    if (isTeacher) await initGuruTab();

    // Offline sync: tampilkan status + kirim absensi tertunda.
    await updateSyncBanner();
    window.addEventListener('online',  runFlush);
    window.addEventListener('offline', updateSyncBanner);
    runFlush();

    // Badge kasus: cek eskalasi baru ke role user ini di background.
    refreshKasusBadge();
}

// ─── Tab navigation ──────────────────────────────────────────
const TAB_SHORT = {
    guru: 'Beranda', wali_kelas: 'Wali', bk: 'BK', kaprodi: 'Prodi',
    waka_kesiswaan: 'Kesiswaan', waka_kurikulum: 'Kurikulum', kepsek: 'Kepsek',
    kasus: 'Kasus', jurnal: 'Jurnal',
};

function buildTabs() {
    const nav    = document.getElementById('tab-nav');
    const botNav = document.getElementById('bottom-nav');
    const tabs = [];
    if (isTeacher) tabs.push({ key: 'guru', label: 'Dashboard Guru' });
    jabatan.forEach(j => tabs.push({ key: j, label: jabatanLabel(j) }));
    tabs.push({ key: 'kasus', label: 'Kasus' });
    if (isTeacher) tabs.push({ key: 'jurnal', label: 'Jurnal Mengajar' });

    nav.innerHTML = tabs.map(t =>
        `<button class="tab-btn" data-tab="${t.key}">${esc(t.label)}</button>`
    ).join('');

    botNav.innerHTML = tabs.map(t =>
        `<button class="tab-btn" data-tab="${t.key}">${esc(TAB_SHORT[t.key] ?? t.label)}</button>`
    ).join('');

    const handler = async (e) => {
        const key = e.target.dataset?.tab;
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
        case 'kepsek':      await initKepsekTab(); break;
        case 'kasus':       await initKasusTab(); break;
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

function renderScheduleRows(rows, contentEl) {
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
}

async function loadSchedule() {
    const date      = document.getElementById('sched-date').value;
    const contentEl = document.getElementById('sched-content');
    const cacheKey  = `sched-${currentUser.user_id}-${date}`;

    // Tampilkan cache dulu — halaman langsung berisi data walau offline
    const cached = LC.get(cacheKey);
    if (cached) {
        renderScheduleRows(cached, contentEl);
    } else {
        contentEl.innerHTML = '<p class="hint">Memuat jadwal…</p>';
    }

    try {
        const rows = await getMyScheduleForDate(currentUser.user_id, date);
        LC.set(cacheKey, rows);
        renderScheduleRows(rows, contentEl);
    } catch (err) {
        if (!cached) {
            contentEl.innerHTML = `<p class="hint" style="color:var(--color-danger)">Gagal memuat data. ${esc(fe(err))}</p>`;
        }
        // Jika ada cache, biarkan data lama tetap tampil — jangan overwrite dengan error
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
        const statusLabel = { HADIR:'Hadir', IZIN:'Izin', SAKIT:'Sakit', TIDAK_HADIR:'Tidak Hadir' };

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
        panel.innerHTML = `<p class="hint" style="color:var(--color-danger)">Gagal memuat data. ${esc(fe(err))}</p>`;
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
        const records = students.map(s => {
            const checked = document.querySelector(`input[name="att_${scheduleId}_${s.student_id}"]:checked`);
            const status  = checked?.value ?? 'HADIR';
            const notesEl = document.getElementById(`notes_${scheduleId}_${s.student_id}`);
            const notes   = status === 'IZIN' ? (notesEl?.value.trim() || null) : null;
            return { student_id: s.student_id, status, source: 'TEACHER_DECLARED', notes };
        });

        // Satu jalur idempoten (online + offline). session_date = tanggal
        // yang sedang dilihat di tab Guru.
        const batch = {
            idempotency_key: crypto.randomUUID(),
            schedule_id:     scheduleId,
            submitted_by:    currentUser.user_id,
            session_date:    document.getElementById('sched-date').value,
            records,
        };

        const result = await saveAttendanceBatch(batch);
        if (result.status === 'synced') {
            statusEl.textContent = `✓ Tersimpan — ${records.length} siswa`;
            statusEl.className   = 'status-msg status-ok';
        } else if (result.status === 'queued') {
            statusEl.textContent = `⏳ Tersimpan di perangkat — menunggu sinkron (${records.length} siswa)`;
            statusEl.className   = 'status-msg status-warn';
        } else {
            statusEl.textContent = `✗ ${result.error}`;
            statusEl.className   = 'status-msg status-err';
        }
        statusEl.style.display = 'inline-block';
        await updateSyncBanner();
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
        el.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:2000;padding:8px 14px;' +
            'font-size:13px;text-align:center;display:none;background:var(--color-warning-bg,#fffbeb);' +
            'color:var(--color-warning,#b45309);border-top:1px solid var(--color-warning,#d97706)';
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

// ── Observasi ─────────────────────────────────────────────────

async function initObsForm() {
    // Load students dari cache dulu agar dropdown siap pakai walau offline
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
        if (!hiddenEl.value) {
            statusEl.style.display = 'block';
            statusEl.style.color = 'var(--color-danger)';
            statusEl.textContent = 'Pilih siswa terlebih dahulu.';
            return;
        }
        statusEl.style.display = 'none';
        submitBtn.disabled = true;
        submitBtn.textContent = 'Menyimpan…';
        try {
            const r = await insertObservation({
                authorId:   currentUser.user_id,
                studentId:  hiddenEl.value,
                dimension:  document.getElementById('obs-dimension').value,
                sentiment:  document.getElementById('obs-sentiment').value,
                visibility: document.getElementById('obs-visibility').value,
                content:    document.getElementById('obs-content').value,
            });
            if (r.status === 'error') throw new Error(r.error);
            statusEl.textContent   = r.status === 'queued'
                ? '⏳ Observasi disimpan lokal — akan dikirim saat online.'
                : '✓ Observasi berhasil disimpan.';
            statusEl.className     = 'status-msg status-ok';
            statusEl.style.display = 'block';
            form.reset();
            hiddenEl.value = '';
        } catch (err) {
            statusEl.textContent   = `✗ ${fe(err, 's')}`;
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
        tbody.innerHTML = `<tr><td colspan="7" style="color:var(--color-danger)">${esc(fe(err))}</td></tr>`;
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
        hintEl.textContent = `Gagal memuat data. ${fe(err)}`;
    }
}

// ─── TAB WAKA KESISWAAN ──────────────────────────────────────

async function initWakaKesiswaanTab() {
    const today = new Date().toISOString().slice(0, 10);
    document.getElementById('wk-att-date').value = today;
    document.getElementById('wk-att-filter-btn').onclick = loadWkAttendanceRecap;

    await Promise.all([
        loadWkAttendanceRecap(),
        loadWkObservations(),
        loadWkOpenCases(),
    ]);
}

async function loadWkAttendanceRecap() {
    const date    = document.getElementById('wk-att-date').value;
    const tbody   = document.getElementById('wk-att-body');
    const emptyEl = document.getElementById('wk-att-empty');
    tbody.innerHTML = '<tr><td colspan="6" class="hint">Memuat…</td></tr>';
    emptyEl.style.display = 'none';

    try {
        const rows = await getAttendanceRecapPerClass(date);
        if (rows.length === 0) {
            tbody.innerHTML = '';
            emptyEl.style.display = 'block';
            return;
        }
        tbody.innerHTML = rows.map(r => {
            const pct = r.total > 0 ? Math.round(r.HADIR / r.total * 100) : 0;
            return `<tr>
                <td>${esc(r.name)}</td>
                <td>${r.HADIR}</td>
                <td>${r.IZIN}</td>
                <td>${r.SAKIT}</td>
                <td>${r.TIDAK_HADIR}</td>
                <td>${r.total > 0 ? pct + '%' : '—'}</td>
            </tr>`;
        }).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="6" style="color:var(--color-danger)">${esc(fe(err))}</td></tr>`;
    }
}

async function loadWkObservations() {
    const hintEl = document.getElementById('wk-obs-hint');
    const listEl = document.getElementById('wk-obs-list');
    hintEl.textContent = 'Memuat…';
    listEl.innerHTML = '';

    try {
        const { data, error } = await supabase
            .from('observations')
            .select(`observation_id, sentiment, dimension, content, observed_at, created_at,
                student:students(full_name, nis),
                author:users!observations_author_user_id_fkey(full_name)`)
            .order('created_at', { ascending: false })
            .limit(50);
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
        hintEl.textContent = `Gagal memuat data. ${fe(err)}`;
    }
}

const HANDLER_ROLE_LABELS = {
    GURU: 'Guru', WALI_KELAS: 'Wali Kelas', BK: 'BK', KAPRODI: 'Kaprodi',
    KEPSEK: 'Kepala Sekolah', WAKA_KESISWAAN: 'Waka Kesiswaan',
    WAKA_KURIKULUM: 'Waka Kurikulum', DUDI: 'DUDI',
};

async function loadWkOpenCases() {
    const tbody   = document.getElementById('wk-cases-body');
    const emptyEl = document.getElementById('wk-cases-empty');
    tbody.innerHTML = '<tr><td colspan="4" class="hint">Memuat…</td></tr>';
    emptyEl.style.display = 'none';

    try {
        const rows = await getOpenCases();
        if (rows.length === 0) {
            tbody.innerHTML = '';
            emptyEl.style.display = 'block';
            return;
        }
        tbody.innerHTML = rows.map(c => `<tr>
            <td>${esc(c.student?.full_name ?? '—')} (${esc(c.student?.nis ?? '—')})</td>
            <td>${esc(c.title)}</td>
            <td>${esc(HANDLER_ROLE_LABELS[c.current_handler_role] ?? c.current_handler_role ?? '—')}</td>
            <td>${fmt(c.created_at)}</td>
        </tr>`).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="4" style="color:var(--color-danger)">${esc(fe(err))}</td></tr>`;
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
        tbody.innerHTML = `<tr><td colspan="6" style="color:var(--color-danger)">${esc(fe(err))}</td></tr>`;
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
        listEl.innerHTML = `<p class="hint" style="color:var(--color-danger)">${esc(fe(err))}</p>`;
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
        hintEl.textContent = `Gagal memuat data. ${fe(err)}`;
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

    await loadAdminList();

    document.getElementById('ks-add-admin-form')
        .addEventListener('submit', handleAddAdmin);
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
                <thead><tr><th>Nama</th><th>Login ID</th><th></th></tr></thead>
                <tbody>
                    ${admins.map(a => `
                        <tr>
                            <td>${esc(a.full_name)}</td>
                            <td><code>${esc(a.login_identifier)}</code></td>
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

    btn.disabled = true;
    msgEl.style.display = 'none';
    resultEl.style.display = 'none';

    try {
        const result = await addSchoolAdmin({ full_name: name, login_identifier: loginId });

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
const ESCALATION_CHAIN = {
    SEKOLAH: ['GURU','BK','WALI_KELAS','KAPRODI','KEPSEK'],
    PKL:     ['DUDI','KAPRODI','KEPSEK'],
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
};

let _kasusTabInit   = false;
let _kasusAllCases  = [];
let _kasusCurrentId = null;

async function initKasusTab() {
    markKasusAsSeen();
    if (_kasusTabInit) { renderKasusList(); return; }
    _kasusTabInit = true;

    // Filters
    document.getElementById('kasus-filter-status').addEventListener('change', renderKasusList);
    document.getElementById('kasus-filter-track').addEventListener('change',  renderKasusList);

    // Offline guard — disable tombol + banner saat tidak ada koneksi
    function syncKasusOnlineState() {
        const online = navigator.onLine;
        const btn    = document.getElementById('kasus-new-btn');
        const banner = document.getElementById('kasus-offline-banner');
        btn.disabled          = !online;
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
    const createForm = document.getElementById('kasus-create-form');
    const searchEl   = document.getElementById('kasus-c-student-search');
    const studentIdEl = document.getElementById('kasus-c-student-id');
    const listEl     = document.getElementById('kasus-c-student-list');

    searchEl.addEventListener('input', async () => {
        const q = searchEl.value.trim();
        if (q.length < 2) { listEl.style.display = 'none'; return; }
        try {
            const rows = await searchStudents(q);
            if (!rows.length) { listEl.style.display = 'none'; return; }
            listEl.innerHTML = rows.map(r =>
                `<div style="padding:8px 12px; cursor:pointer; font-size:13px" data-id="${r.student_id}" data-name="${esc(r.full_name)}">${esc(r.full_name)} — ${esc(r.nis ?? '')}</div>`
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
        } catch { listEl.style.display = 'none'; }
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
        if (!sId)          { showCreateMsg('Pilih siswa dari daftar.', true); return; }
        if (!title)        { showCreateMsg('Judul tidak boleh kosong.', true); return; }
        if (desc.length < 20) { showCreateMsg('Deskripsi minimal 20 karakter.', true); return; }

        btnEl.disabled = true; btnEl.textContent = 'Menyimpan…';
        try {
            await createCase({
                studentId:   sId,
                title,
                description: desc,
                track,
                authorUserId: currentUser.user_id,
                authorRole:   currentUser.role_type,
            });
            closeKasusModal();
            _kasusAllCases = [];
            _kasusTabInit = false;
            await initKasusTab();
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

async function loadKasusList() {
    const contentEl = document.getElementById('kasus-list-content');
    contentEl.innerHTML = '<p class="hint">Memuat kasus…</p>';
    try {
        _kasusAllCases = await getCases();
        renderKasusList();
    } catch (err) {
        contentEl.innerHTML = `<p class="hint" style="color:var(--color-danger)">${esc(fe(err))}</p>`;
    }
}

function renderKasusList() {
    const contentEl   = document.getElementById('kasus-list-content');
    const statusFilter = document.getElementById('kasus-filter-status').value;
    const trackFilter  = document.getElementById('kasus-filter-track').value;

    let rows = _kasusAllCases;
    if (statusFilter) rows = rows.filter(r => r.status === statusFilter);
    if (trackFilter)  rows = rows.filter(r => r.track  === trackFilter);

    if (!rows.length) {
        contentEl.innerHTML = '<p class="hint">Tidak ada kasus yang sesuai filter.</p>';
        return;
    }

    contentEl.innerHTML = rows.map(r => `
        <div class="kasus-row" data-id="${r.case_id}" style="border:1px solid var(--color-border); border-radius:var(--radius); padding:14px 16px; margin-bottom:10px; cursor:pointer; transition:background .12s">
            <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:8px; flex-wrap:wrap">
                <strong style="font-size:14px; flex:1">${esc(r.title)}</strong>
                <span class="badge kasus-badge-${(r.status||'').toLowerCase()}">${esc(CASE_STATUS_LABEL[r.status] ?? r.status)}</span>
            </div>
            <div style="font-size:12px; color:var(--color-text-muted); margin-top:4px">
                ${esc(r.student?.full_name ?? '—')} (${esc(r.student?.nis ?? '—')})
                &middot; ${esc(CASE_TRACK_LABEL[r.track] ?? r.track)}
                &middot; Handler: ${esc(ROLE_LABEL[r.current_handler_role] ?? r.current_handler_role ?? '—')}
                &middot; ${fmt(r.created_at)}
            </div>
        </div>
    `).join('');

    contentEl.querySelectorAll('.kasus-row').forEach(el => {
        el.addEventListener('mouseenter', () => { el.style.background = 'var(--color-bg)'; });
        el.addEventListener('mouseleave', () => { el.style.background = ''; });
        el.addEventListener('click', () => openKasusDetail(el.dataset.id));
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
            `<p class="hint" style="color:var(--color-danger)">${esc(fe(err))}</p>`;
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
        return `
            <div style="border-left:3px solid var(--color-border); padding:10px 14px; margin-bottom:10px">
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

function renderKasusActions(kasus) {
    const actionsEl   = document.getElementById('kasus-actions');
    const escalateBlock = document.getElementById('kasus-escalate-block');
    const statusBlock   = document.getElementById('kasus-status-block');
    const closeBtn      = document.getElementById('kasus-close-btn');
    const escalateTo    = document.getElementById('kasus-escalate-to');
    const statusSel     = document.getElementById('kasus-new-status');

    if (kasus.status === 'CLOSED') {
        actionsEl.style.display = 'none';
        return;
    }

    actionsEl.style.display = 'block';

    // Escalate: show if there's a next role in chain AND user is current handler or senior
    const chain = ESCALATION_CHAIN[kasus.track] ?? [];
    const handlerIdx = chain.indexOf(kasus.current_handler_role);
    const nextRoles  = chain.slice(handlerIdx + 1);
    const isHandler  = kasus.current_handler_role === currentUser.role_type;

    if (nextRoles.length && isHandler) {
        escalateTo.innerHTML = nextRoles.map(r =>
            `<option value="${r}">${esc(ROLE_LABEL[r] ?? r)}</option>`
        ).join('');
        escalateBlock.style.display = 'block';
    } else {
        escalateBlock.style.display = 'none';
    }

    // Status change
    const nextStatuses = STATUS_AFTER_CURRENT[kasus.status] ?? [];
    const canChangeStatus = isHandler || ['KEPSEK','BK','WAKA_KESISWAAN'].includes(currentUser.role_type);

    if (canChangeStatus && nextStatuses.length) {
        statusSel.innerHTML = nextStatuses.map(s =>
            `<option value="${s}">${esc(CASE_STATUS_LABEL[s])}</option>`
        ).join('');
        statusBlock.style.display = 'block';
    } else {
        statusBlock.style.display = 'none';
    }

    // Close: Kepsek/BK/handler di akhir chain
    const canClose = currentUser.role_type === 'KEPSEK' || isHandler;
    closeBtn.style.display = canClose ? 'inline-flex' : 'none';

    // Wire action buttons (replace old listeners by cloning)
    const newCommentBtn = replaceEl('kasus-comment-submit-btn');
    const newEscBtn     = replaceEl('kasus-escalate-btn');
    const newStatusBtn  = replaceEl('kasus-status-btn');
    const newCloseBtn   = replaceEl('kasus-close-btn');

    newCommentBtn.addEventListener('click', async () => {
        const text = document.getElementById('kasus-comment-text').value.trim();
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
        const to   = document.getElementById('kasus-escalate-to').value;
        const note = document.getElementById('kasus-escalate-note').value.trim();
        const msgEl = document.getElementById('kasus-escalate-msg');
        newEscBtn.disabled = true; newEscBtn.textContent = 'Mengeskalasi…';
        try {
            await escalateCase({
                caseId: kasus.case_id,
                previousHandlerRole: kasus.current_handler_role,
                newHandlerRole: to,
                note,
                authorUserId: currentUser.user_id,
                authorRole:   currentUser.role_type,
            });
            msgEl.style.color = 'var(--color-success)'; msgEl.textContent = `Dieskalasi ke ${ROLE_LABEL[to] ?? to}.`;
            await refreshKasusDetail();
        } catch (err) {
            msgEl.style.color = 'var(--color-danger)'; msgEl.textContent = fe(err, 's');
        } finally {
            newEscBtn.disabled = false; newEscBtn.textContent = 'Eskalasi';
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
        // Inline konfirmasi: tanya dulu, baru eksekusi saat klik kedua
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
            await closeCase({ caseId: kasus.case_id, note, authorUserId: currentUser.user_id, authorRole: currentUser.role_type });
            msgEl.style.color = 'var(--color-success)'; msgEl.textContent = 'Kasus berhasil ditutup.';
            await refreshKasusDetail();
        } catch (err) {
            msgEl.style.color = 'var(--color-danger)'; msgEl.textContent = fe(err, 's');
        } finally {
            newCloseBtn.disabled = false; newCloseBtn.textContent = 'Tutup Kasus';
        }
    });
}

function replaceEl(id) {
    const old = document.getElementById(id);
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
        // Update list cache
        _kasusAllCases = await getCases();
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
            const r = await insertJournalEntry(currentUser.user_id, date, content);
            if (r.status === 'error') throw new Error(r.error);
            document.getElementById('journal-content').value = '';
            msgEl.textContent = r.status === 'queued'
                ? '⏳ Catatan disimpan lokal — akan dikirim saat online.'
                : 'Catatan berhasil disimpan.';
            msgEl.style.display = 'block';
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
        <div class="section-card" style="margin-bottom:8px" data-entry-id="${esc(e.journal_id)}">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;flex-wrap:wrap;gap:6px">
                <strong>${fmt(e.entry_date)}</strong>
                <div class="jrn-del-confirm" style="display:none;align-items:center;gap:8px">
                    <span style="font-size:13px;color:var(--color-text-muted)">Hapus catatan ini?</span>
                    <button class="btn btn-danger btn-sm jrn-del-yes">Ya, Hapus</button>
                    <button class="btn btn-secondary btn-sm jrn-del-no">Batal</button>
                </div>
                <button class="btn btn-secondary btn-sm jrn-del-ask" data-delete="${esc(e.journal_id)}">Hapus</button>
            </div>
            <p style="white-space:pre-wrap;margin:0">${esc(e.content)}</p>
            <p class="jrn-del-err" style="display:none;font-size:13px;color:var(--color-danger);margin:4px 0 0"></p>
        </div>
    `).join('');

    listEl.querySelectorAll('[data-entry-id]').forEach(card => {
        const askBtn    = card.querySelector('.jrn-del-ask');
        const confirmEl = card.querySelector('.jrn-del-confirm');
        const yesBtn    = card.querySelector('.jrn-del-yes');
        const noBtn     = card.querySelector('.jrn-del-no');
        const errEl     = card.querySelector('.jrn-del-err');

            askBtn.addEventListener('click', () => {
                confirmEl.style.display = 'flex';
                askBtn.style.display    = 'none';
            });
            noBtn.addEventListener('click', () => {
                confirmEl.style.display = 'none';
                askBtn.style.display    = 'inline-flex';
            });
            yesBtn.addEventListener('click', async () => {
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

// ─── Logout ──────────────────────────────────────────────────

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
    window.location.href = 'index.html';
});

// ─── Start ───────────────────────────────────────────────────
init();
