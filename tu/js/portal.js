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
    getExitsByRange,
    getForumSekolahPosts, getForumSekolahSentPosts, getForumSekolahComments,
    addForumSekolahComment, addForumSekolahAck, createForumSekolahPost,
    updateForumSekolahPost, deleteForumSekolahPost, getForumRecipientCandidates,
} from './api.js';
import { showPwaBanner } from '../../shared/pwa-banner.js';

// ── DOM refs ───────────────────────────────────────────────────
const portalTitle    = document.getElementById('portal-title');
const portalUserName = document.getElementById('portal-user-name');
const logoutBtn      = document.getElementById('logout-btn');
const loadingEl      = document.getElementById('loading');
const tabNav         = document.getElementById('tab-nav');
const bottomNav      = document.getElementById('tu-bottom-nav');
const ALL_SECTIONS   = ['section-piket', 'section-late', 'section-exits', 'section-attendance', 'section-forum'];
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

tabBtns.forEach(btn => btn.addEventListener('click', async () => {
    showTab(btn.dataset.tab);
    if (btn.dataset.tab === 'section-forum') await initForumSection();
}));

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

// ── Tab 3: Izin Keluar ────────────────────────────────────────
const exitsHintEl  = document.getElementById('exits-hint');
const exitsSummary = document.getElementById('exits-summary');
const exitsTable   = document.getElementById('exits-table');
const exitsTbody   = document.getElementById('exits-tbody');
const exitsEmpty   = document.getElementById('exits-empty');
let _cachedExits   = [];

async function loadExitsRecap() {
    const dateStart = document.getElementById('exits-date-start').value;
    const dateEnd   = document.getElementById('exits-date-end').value;
    const btn       = document.getElementById('btn-exits-filter');

    btn.disabled               = true;
    btn.textContent            = 'Memuat…';
    if (exitsHintEl)  exitsHintEl.style.display  = 'none';
    if (exitsSummary) exitsSummary.style.display  = 'none';
    if (exitsTable)   exitsTable.style.display    = 'none';
    if (exitsEmpty)   exitsEmpty.style.display    = 'none';
    if (exitsTbody)   exitsTbody.innerHTML        = '';

    try {
        const rows = await getExitsByRange(dateStart || null, dateEnd || null);
        _cachedExits = rows;

        if (!rows.length) { if (exitsEmpty) exitsEmpty.style.display = 'block'; return; }

        if (exitsSummary) {
            exitsSummary.innerHTML = `
                <div class="summary-card card-late">
                    <span class="count">${rows.length}</span>
                    <span class="label">Total Izin Keluar</span>
                </div>`;
            exitsSummary.style.display = 'flex';
        }

        if (exitsTbody) {
            exitsTbody.innerHTML = rows.map(r => `
                <tr>
                    <td>${esc(formatDate(r.date))}</td>
                    <td>${esc(r.exit_time ? r.exit_time.slice(0,5) : '—')}</td>
                    <td>${esc(r.return_time ? r.return_time.slice(0,5) : '—')}</td>
                    <td>${esc(r.student_name)}</td>
                    <td>${esc(r.nis)}</td>
                    <td>${esc(r.reason || '—')}</td>
                </tr>`).join('');
            if (exitsTable) exitsTable.style.display = 'table';
        }
    } catch (err) {
        if (exitsHintEl) {
            exitsHintEl.textContent   = `Gagal memuat data. ${esc(fe(err))}`;
            exitsHintEl.style.display = 'block';
        }
    } finally {
        btn.disabled    = false;
        btn.textContent = 'Tampilkan';
    }
}

document.getElementById('btn-exits-filter')?.addEventListener('click', loadExitsRecap);

document.getElementById('btn-export-exits')?.addEventListener('click', () => {
    if (!_cachedExits.length) { alert('Tampilkan data dulu sebelum export.'); return; }
    const header = [['Tanggal', 'Jam Keluar', 'Jam Kembali', 'Nama Siswa', 'NIS', 'Alasan']];
    const rows   = _cachedExits.map(r => [
        formatDate(r.date),
        r.exit_time ? r.exit_time.slice(0,5) : '—',
        r.return_time ? r.return_time.slice(0,5) : '—',
        r.student_name, r.nis, r.reason || '',
    ]);
    downloadCSV([...header, ...rows], `izin-keluar-${Date.now()}.csv`);
});

// ── Tab 4: Rekap Kehadiran ─────────────────────────────────────
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

// ─── Forum Sekolah ────────────────────────────────────────────

let _forumMode        = 'masuk';
let _forumOffset      = 0;
let _forumHasMore     = false;
let _forumInitDone    = false;
let _forumScope       = null;
let _forumEditPostId  = null;
let _forumRecipients  = new Map();
let _forumGroupLabels = new Map(); // groupKey → label string
let _forumGroupBtns   = new Map(); // groupKey → btnEl
let _forumGroupUids   = new Map(); // groupKey → Set<uid>
let _forumPrograms    = [];
let _forumClasses     = [];

// Drill-down picker state
let _drillType       = null;        // 'SISWA' | 'ORTU'
let _drillExpanded   = new Set();   // program_id yang ter-expand
let _drillJurusanAll = new Set();   // program_id pilih semua
let _drillKelasAll   = new Set();   // class_id pilih semua
let _drillIndividu      = new Map();   // user_id → candidate
let _drillKelasExpanded = new Set();   // class_id yang ter-expand
let _drillKelasData     = new Map();   // class_id → candidates[] (cache)

async function initForumSection() {
    if (_forumInitDone) { await loadForumPosts(); return; }
    _forumInitDone = true;

    const { data: scope } = await supabase
        .rpc('fn_get_user_forum_scope', { p_user_id: currentUser.user_id })
        .maybeSingle();
    _forumScope = scope;

    const [progRes, classRes] = await Promise.all([
        supabase.from('programs').select('program_id, name').eq('is_active', true)
            .eq('school_id', currentUser.school_id).order('name'),
        supabase.from('classes').select('class_id, name, grade_level, program_id')
            .eq('is_active', true).eq('school_id', currentUser.school_id).order('name'),
    ]);
    _forumPrograms = progRes.data ?? [];
    _forumClasses  = classRes.data ?? [];

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

    document.getElementById('btn-forum-buat').addEventListener('click', () => openForumModal());
    document.getElementById('btn-forum-modal-batal').addEventListener('click', closeForumModal);
    document.getElementById('modal-forum-post').addEventListener('click', e => {
        if (e.target === e.currentTarget) closeForumModal();
    });
    document.getElementById('btn-forum-modal-simpan').addEventListener('click', submitForumPost);

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
        if (!confirm('Hapus posting ini?')) return;
        try {
            await deleteForumSekolahPost(postId);
            closeForumDetail();
            loadForumPosts();
        } catch (err) { alert(fe(err)); }
    });

    document.getElementById('btn-load-more-forum')
        .addEventListener('click', () => loadForumPosts(true));

    await loadForumPosts();
}

async function loadForumPosts(loadMore = false) {
    const loadingEl = document.getElementById('forum-loading');
    const listEl    = document.getElementById('forum-posts-list');
    const moreBtn   = document.getElementById('btn-load-more-forum');
    const LIMIT     = 20;

    if (!loadMore) { _forumOffset = 0; listEl.innerHTML = ''; }
    loadingEl.style.display = ''; loadingEl.textContent = 'Memuat…';
    moreBtn.style.display = 'none';

    try {
        const posts = _forumMode === 'masuk'
            ? await getForumSekolahPosts(currentUser.school_id, currentUser.user_id, LIMIT, _forumOffset)
            : await getForumSekolahSentPosts(currentUser.school_id, currentUser.user_id, LIMIT, _forumOffset);

        loadingEl.style.display = 'none';
        if (!posts.length && _forumOffset === 0) {
            loadingEl.style.display = '';
            loadingEl.textContent = 'Belum ada posting.';
            return;
        }
        posts.forEach(p => listEl.appendChild(renderForumCard(p)));
        _forumOffset += posts.length;
        _forumHasMore = posts.length === LIMIT;
        moreBtn.style.display = _forumHasMore ? '' : 'none';
    } catch (e) {
        loadingEl.style.display = '';
        loadingEl.textContent = 'Gagal memuat forum.';
    }
}

function renderForumCard(post) {
    const card = document.createElement('div');
    card.className = 'section-card';
    card.style.cssText = 'margin-bottom:12px;cursor:pointer';
    const time   = new Date(post.created_at).toLocaleString('id-ID',
        { dateStyle: 'medium', timeStyle: 'short' });
    const author = esc(post.author?.full_name ?? (_forumMode === 'terkirim' ? 'Anda' : '—'));
    const ackCnt = post.acknowledgements?.length ?? 0;
    const edited = post.is_edited ? ' <span class="hint" style="font-size:11px">(diedit)</span>' : '';
    const bodyText = post.body ?? '';
    card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
            <strong>${esc(post.title ?? '')}${edited}</strong>
            <span class="hint" style="white-space:nowrap;font-size:12px">${time}</span>
        </div>
        <p class="hint" style="margin:4px 0 8px">${author}</p>
        <p style="margin:0 0 8px;font-size:14px;white-space:pre-wrap">${
            esc(bodyText).substring(0, 160)}${bodyText.length > 160 ? '…' : ''}</p>
        <div style="display:flex;gap:12px;font-size:12px;color:var(--color-muted)">
            ${post.attachment_url ? '<span>📎 Lampiran</span>' : ''}
            <span>✓ ${ackCnt} dibaca</span>
        </div>`;
    card.addEventListener('click', () => openForumDetail(post));
    return card;
}

function openForumModal(postId = null) {
    _forumEditPostId = postId;
    _forumRecipients.clear();
    _forumGroupLabels.clear();
    _forumGroupBtns.clear();
    _forumGroupUids.clear();
    renderRecipientChips();
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
    document.getElementById('modal-forum-post').style.display = 'flex';
}

function closeForumModal() {
    document.getElementById('modal-forum-post').style.display = 'none';
    _forumEditPostId = null;
    _forumRecipients.clear(); _forumGroupLabels.clear();
    _forumGroupBtns.clear();  _forumGroupUids.clear();
}

// ─── Panel Penerima — State Picker ────────────────────────────
let _pickerGroupDef   = null;
let _pickerCandidates = [];
let _pickerSelected   = new Map();

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

// ─── Bangun Tombol Grup Penerima ─────────────────────────────
function buildRecipientGroupButtons() {
    const container = document.getElementById('forum-recipient-group-btns');
    container.innerHTML = '';
    container.style.cssText = 'display:flex;flex-wrap:wrap;align-items:flex-start;';

    // Bug #6: TU tidak boleh broadcast ke sesama TU — hapus "Semua TU/Admin",
    //          hanya "TU/Admin tertentu" (hasIndividual: true, labelSemua kosong trick: tidak ada btnAll)
    // Bug #7: tambah Guru Wali
    const groups = [
        { label: 'Kepsek',        group: 'KEPSEK',           hasIndividual: false, labelSemua: 'Kepsek' },
        { label: 'Waka',          group: 'SEMUA_WAKA',       hasIndividual: true, needsJabatan: true },
        { label: 'Kaprodi',       group: 'SEMUA_KAPRODI',    hasIndividual: true },
        { label: 'Guru',          group: 'SEMUA_GURU',       hasIndividual: true, pickerGroup: 'GURU_MAPEL' },
        { label: 'Wali Kelas',    group: 'SEMUA_WALI_KELAS', hasIndividual: true, labelSemua: 'Semua Wali Kelas'    },
        { label: 'Guru Wali',     group: 'SEMUA_GURU_WALI',  hasIndividual: true  },
        { label: 'Guru BK',       group: 'SEMUA_BK',         hasIndividual: true  },
        { label: 'Guru Piket',    group: 'GURU_PIKET',       hasIndividual: true },
        { label: 'Semua Siswa',   group: 'SEMUA_SISWA',      hasIndividual: false, labelSemua: 'Semua Siswa' },
        { label: 'Semua Ortu',    group: 'SEMUA_ORTU',       hasIndividual: false, labelSemua: 'Semua Ortu'  },
        { label: 'Siswa tertentu', group: 'SISWA_DRILL', isDrillDown: true, labelSemua: 'Siswa tertentu' },
        { label: 'Ortu tertentu',  group: 'ORTU_DRILL',  isDrillDown: true, labelSemua: 'Ortu tertentu'  },
        { label: 'TU / Admin',    group: 'SEMUA_TU',         hasIndividual: true, skipSemua: true },
    ];

    const rendered = new Set();
    groups.forEach(g => {
        if (rendered.has(g.group)) return;

        if (g.isDrillDown) {
            const btn = document.createElement('button');
            btn.className = 'btn btn-secondary';
            btn.textContent = g.labelSemua ?? g.label;
            btn.addEventListener('click', () => addRecipientGroup(g, btn));
            container.appendChild(btn);
            return;
        }

        // SEMUA_SISWA + SEMUA_ORTU → satu baris berdampingan
        if (g.group === 'SEMUA_SISWA') {
            const ortu = groups.find(x => x.group === 'SEMUA_ORTU');
            if (ortu) {
                rendered.add('SEMUA_ORTU');
                const wrap = document.createElement('div');
                wrap.style.cssText = 'display:flex;gap:8px;margin-bottom:6px;width:auto;flex-wrap:wrap';
                [g, ortu].forEach(entry => {
                    const btn = document.createElement('button');
                    btn.className = 'btn btn-secondary';
                    btn.textContent = entry.labelSemua ?? `Semua ${entry.label}`;
                    btn.addEventListener('click', () => addRecipientGroup({ ...entry, mode: 'semua' }, btn));
                    wrap.appendChild(btn);
                });
                container.appendChild(wrap);
                return;
            }
        }

        const wrap = document.createElement('div');
        wrap.style.cssText = `display:flex;gap:2px;margin-bottom:6px;width:${g.hasIndividual ? '100%' : 'auto'}`;

        // skipSemua: true → jangan tampilkan tombol "Semua X" (hanya picker)
        if (!g.skipSemua) {
            const btnAll = document.createElement('button');
            btnAll.className = 'btn btn-secondary';
            btnAll.style.cssText = g.hasIndividual
                ? 'border-radius:6px 0 0 6px;padding-right:8px'
                : '';
            btnAll.textContent = g.labelSemua ?? `Semua ${g.label}`;
            btnAll.addEventListener('click', () => addRecipientGroup({ ...g, mode: 'semua' }, btnAll));
            wrap.appendChild(btnAll);
        }

        if (g.hasIndividual) {
            const btnPick = document.createElement('button');
            btnPick.className = 'btn btn-secondary';
            btnPick.style.cssText = g.skipSemua
                ? 'border-radius:6px;'
                : 'border-radius:0 6px 6px 0;padding-left:6px;border-left:1px solid var(--color-border)';
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
                academicYear: schoolConfig?.current_academic_year,
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
            academicYear: schoolConfig?.current_academic_year,
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
        else closeRecipientPicker();
    });
    modal.addEventListener('click', e => {
        if (e.target === e.currentTarget) {
            if (modal.dataset.drillMode === '1') closeDrillDownPicker();
            else closeRecipientPicker();
        }
    });
    document.getElementById('picker-search').addEventListener('input', () => {
        if (modal.dataset.drillMode === '1') renderDrillTree();
        else renderPickerList();
    });
    document.getElementById('picker-filter-jabatan').addEventListener('change', loadPickerCandidates);
    document.getElementById('picker-filter-jurusan').addEventListener('change', loadPickerCandidates);
    document.getElementById('picker-filter-kelas').addEventListener('change', loadPickerCandidates);
    document.getElementById('picker-filter-hari').addEventListener('change', loadPickerCandidates);
    document.getElementById('btn-picker-tambahkan').addEventListener('click', () => {
        if (modal.dataset.drillMode === '1') {
            submitDrillDown();
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
        const jurAll   = _drillJurusanAll.has(prog.program_id);
        const klsCnt   = _forumClasses.filter(c => c.program_id === prog.program_id && _drillKelasAll.has(c.class_id)).length;
        const indCnt   = [..._drillIndividu.values()].filter(c => c._programId === prog.program_id).length;
        const selCount = (jurAll ? 1 : 0) + klsCnt + indCnt;

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
            jurCb.addEventListener('change', () => {
                if (jurCb.checked) {
                    _drillJurusanAll.add(prog.program_id);
                    _forumClasses.filter(c => c.program_id === prog.program_id)
                        .forEach(c => _drillKelasAll.delete(c.class_id));
                    for (const [uid, c] of _drillIndividu.entries()) {
                        if (c._programId === prog.program_id) _drillIndividu.delete(uid);
                    }
                } else {
                    _drillJurusanAll.delete(prog.program_id);
                }
                renderDrillTree();
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
                const klsSelCnt   = (klsAll ? 1 : 0) + iCnt;

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
                        klsAllCb.type    = 'checkbox';
                        klsAllCb.checked = klsAll;
                        klsAllCb.addEventListener('change', () => {
                            if (klsAllCb.checked) {
                                _drillKelasAll.add(cls.class_id);
                                for (const [uid, c] of _drillIndividu.entries()) {
                                    if (c._classId === cls.class_id) _drillIndividu.delete(uid);
                                }
                            } else {
                                _drillKelasAll.delete(cls.class_id);
                            }
                            renderDrillTree();
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
                            cb.type    = 'checkbox';
                            cb.checked = _drillIndividu.has(c.user_id);
                            cb.addEventListener('change', () => {
                                if (cb.checked) _drillIndividu.set(c.user_id, c);
                                else _drillIndividu.delete(c.user_id);
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
                academicYear: schoolConfig?.current_academic_year,
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
    const acYear = schoolConfig?.current_academic_year;
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

// ─── Chips Penerima ───────────────────────────────────────────
function renderRecipientChips() {
    const container = document.getElementById('forum-recipient-chips');
    const emptyEl   = document.getElementById('forum-chips-empty');
    const countEl   = document.getElementById('forum-recipient-count');
    container.querySelectorAll('.recipient-chip').forEach(el => el.remove());
    if (_forumRecipients.size === 0 && _forumGroupLabels.size === 0) {
        emptyEl.style.display = 'inline'; countEl.textContent = ''; return;
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
        chip.innerHTML = `${esc(label)} <button style="${btnCss}">✕</button>`;
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
        chip.innerHTML = `${esc(r.full_name)} <button data-uid="${uid}" style="${btnCss}">✕</button>`;
        chip.querySelector('button').addEventListener('click', () => {
            _forumRecipients.delete(uid); renderRecipientChips();
        });
        container.appendChild(chip);
    });
}

async function submitForumPost() {
    const errEl  = document.getElementById('forum-post-error');
    const btnEl  = document.getElementById('btn-forum-modal-simpan');
    const title  = document.getElementById('forum-input-title').value.trim();
    const body   = document.getElementById('forum-input-body').value.trim();
    const fileEl = document.getElementById('forum-input-file');
    errEl.style.display = 'none';
    if (!title) { errEl.textContent = 'Judul wajib diisi.'; errEl.style.display = 'block'; return; }
    if (!body)  { errEl.textContent = 'Isi posting wajib diisi.'; errEl.style.display = 'block'; return; }
    if (_forumRecipients.size === 0 && !_forumEditPostId) {
        errEl.textContent = 'Pilih minimal satu penerima.'; errEl.style.display = 'block'; return;
    }
    btnEl.disabled = true; btnEl.textContent = 'Mengirim…';
    try {
        let attachmentUrl = null, attachmentName = null;
        if (fileEl.files[0]) {
            const file = fileEl.files[0];
            if (file.size > 10 * 1024 * 1024) {
                errEl.textContent = 'Ukuran file maks. 10 MB.'; errEl.style.display = 'block'; return;
            }
            const ext  = file.name.split('.').pop();
            const path = `${currentUser.school_id}/${Date.now()}.${ext}`;
            const { error: upErr } = await supabase.storage
                .from('forum-attachments').upload(path, file, { upsert: false });
            if (upErr) throw upErr;
            const { data: urlData } = supabase.storage
                .from('forum-attachments').getPublicUrl(path);
            attachmentUrl = urlData.publicUrl; attachmentName = file.name;
        }
        if (_forumEditPostId) {
            await updateForumSekolahPost(_forumEditPostId, title, body);
        } else {
            const recipientIds = [..._forumRecipients.keys()];
            await createForumSekolahPost(title, body, recipientIds,
                schoolConfig?.current_academic_year ?? '');
            if (attachmentUrl) {
                await supabase.from('forum_posts')
                    .update({ attachment_url: attachmentUrl, attachment_name: attachmentName })
                    .eq('author_user_id', currentUser.user_id)
                    .order('created_at', { ascending: false })
                    .limit(1);
            }
        }
        closeForumModal();
        _forumMode = 'terkirim';
        document.getElementById('forum-tab-masuk').className    = 'btn btn-secondary';
        document.getElementById('forum-tab-terkirim').className = 'btn btn-primary';
        _forumOffset = 0; loadForumPosts();
    } catch (err) {
        errEl.textContent = fe(err); errEl.style.display = 'block';
    } finally {
        btnEl.disabled = false; btnEl.textContent = 'Kirim';
    }
}

async function openForumDetail(post) {
    const modal = document.getElementById('modal-forum-detail');
    modal.dataset.postId = post.post_id;
    modal.style.display  = 'flex';
    document.getElementById('detail-forum-title').textContent = post.title ?? '';
    document.getElementById('detail-forum-body').textContent  = post.body ?? '';
    const time   = new Date(post.created_at).toLocaleString('id-ID',
        { dateStyle: 'long', timeStyle: 'short' });
    const author = post.author?.full_name ?? (_forumMode === 'terkirim' ? 'Anda' : '—');
    document.getElementById('detail-forum-meta').textContent =
        `${author} · ${time}${post.is_edited ? ' • diedit' : ''}`;
    const attEl = document.getElementById('detail-forum-attachment');
    attEl.innerHTML = post.attachment_url
        ? `<a href="${post.attachment_url}" target="_blank" class="btn btn-secondary"
              style="font-size:13px">📎 ${esc(post.attachment_name ?? 'Unduh')}</a>` : '';
    document.getElementById('forum-author-actions').style.display =
        post.author_user_id === currentUser.user_id ? 'block' : 'none';
    document.getElementById('forum-comment-error').style.display = 'none';
    document.getElementById('forum-comment-input').value = '';
    if (_forumMode === 'masuk') {
        addForumSekolahAck(post.post_id, currentUser.user_id, currentUser.school_id).catch(() => {});
    }
    await loadForumComments(post.post_id);
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
        listEl.innerHTML = comments.length
            ? comments.map(c => {
                const time   = new Date(c.created_at).toLocaleString('id-ID',
                    { dateStyle: 'short', timeStyle: 'short' });
                const author = esc(c.author?.full_name ?? '—');
                return `<div style="padding:8px 0;border-bottom:1px solid var(--color-border)">
                    <div style="display:flex;justify-content:space-between">
                        <strong style="font-size:13px">${author}</strong>
                        <span class="hint" style="font-size:11px">${time}</span>
                    </div>
                    <p style="margin:4px 0 0;font-size:14px;white-space:pre-wrap">${esc(c.body)}</p>
                </div>`;
              }).join('')
            : '<p class="hint">Belum ada komentar.</p>';
    } catch (e) {
        loadEl.textContent = 'Gagal memuat komentar.'; loadEl.style.display = '';
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
        errEl.textContent = fe(err); errEl.style.display = 'block';
    }
}

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
