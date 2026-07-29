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
let _forumPrograms    = [];
let _forumClasses     = [];

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
    renderRecipientChips();
    document.getElementById('modal-forum-title').textContent = postId ? 'Edit Posting' : 'Buat Posting';
    document.getElementById('forum-input-title').value = '';
    document.getElementById('forum-input-body').value  = '';
    document.getElementById('forum-input-file').value  = '';
    document.getElementById('forum-file-name').textContent = '';
    document.getElementById('forum-post-error').style.display = 'none';
    buildRecipientGroupButtons();
    document.getElementById('modal-forum-post').style.display = 'flex';
}

function closeForumModal() {
    document.getElementById('modal-forum-post').style.display = 'none';
    _forumEditPostId = null; _forumRecipients.clear();
}

function buildRecipientGroupButtons() {
    const container = document.getElementById('forum-recipient-group-btns');
    container.innerHTML = '';
    const groups = [
        { label: 'Semua Guru',      group: 'SEMUA_GURU'       },
        { label: 'Semua Waka',      group: 'SEMUA_WAKA'       },
        { label: 'Semua Kaprodi',   group: 'SEMUA_KAPRODI'    },
        { label: 'Semua Wali Kls',  group: 'SEMUA_WALI_KELAS' },
        { label: 'Semua Guru BK',   group: 'SEMUA_BK'         },
        { label: 'Semua Siswa',     group: 'SEMUA_SISWA'      },
        { label: 'Siswa Kelas',     group: 'SISWA_KELAS',     needsKelas: true },
        { label: 'Siswa Jurusan',   group: 'SISWA_JURUSAN',   needsJurusan: true },
        { label: 'Semua Ortu',      group: 'SEMUA_ORTU'       },
        { label: 'Ortu Kelas',      group: 'ORTU_KELAS',      needsKelas: true },
        { label: 'Ortu Jurusan',    group: 'ORTU_JURUSAN',    needsJurusan: true },
        { label: 'Kepsek',          group: 'KEPSEK'           },
        { label: 'Semua TU',        group: 'SEMUA_TU'         },
        { label: 'Guru Piket',      group: 'GURU_PIKET',      needsHari: true },
    ];
    groups.forEach(g => {
        const btn = document.createElement('button');
        btn.className = 'btn btn-secondary';
        btn.textContent = g.label;
        btn.addEventListener('click', () => addRecipientGroup(g));
        container.appendChild(btn);
    });
}

async function addRecipientGroup(groupDef) {
    const errEl = document.getElementById('forum-post-error');
    errEl.style.display = 'none';
    let programId = null, classId = null, dayOfWeek = null;

    if (groupDef.needsJurusan) {
        const sel = document.getElementById('forum-filter-jurusan');
        document.getElementById('forum-filter-jurusan-wrap').style.display = 'block';
        if (!sel.value) { errEl.textContent = 'Pilih jurusan dulu.'; errEl.style.display = 'block'; return; }
        programId = sel.value;
    }
    if (groupDef.needsKelas) {
        const sel = document.getElementById('forum-filter-kelas');
        document.getElementById('forum-filter-kelas-wrap').style.display = 'block';
        if (!sel.value) { errEl.textContent = 'Pilih kelas dulu.'; errEl.style.display = 'block'; return; }
        classId = sel.value;
    }
    if (groupDef.needsHari) {
        const sel = document.getElementById('forum-filter-hari');
        document.getElementById('forum-filter-hari-wrap').style.display = 'block';
        if (!sel.value) { errEl.textContent = 'Pilih hari dulu.'; errEl.style.display = 'block'; return; }
        dayOfWeek = parseInt(sel.value, 10);
    }
    try {
        const candidates = await getForumRecipientCandidates(groupDef.group, {
            programId, classId, dayOfWeek,
            academicYear: schoolConfig?.current_academic_year,
        });
        candidates.forEach(c => _forumRecipients.set(c.user_id, c));
        renderRecipientChips();
    } catch (err) {
        errEl.textContent = fe(err); errEl.style.display = 'block';
    }
}

function renderRecipientChips() {
    const container = document.getElementById('forum-recipient-chips');
    const emptyEl   = document.getElementById('forum-chips-empty');
    const countEl   = document.getElementById('forum-recipient-count');
    container.querySelectorAll('.recipient-chip').forEach(el => el.remove());
    if (_forumRecipients.size === 0) {
        emptyEl.style.display = 'inline'; countEl.textContent = ''; return;
    }
    emptyEl.style.display = 'none';
    countEl.textContent = `${_forumRecipients.size} penerima dipilih`;
    _forumRecipients.forEach((r, uid) => {
        const chip = document.createElement('span');
        chip.className = 'recipient-chip';
        chip.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:2px 8px;' +
            'background:var(--color-bg-alt);border-radius:12px;font-size:12px';
        chip.innerHTML = `${esc(r.full_name)} <button data-uid="${uid}"
            style="background:none;border:none;cursor:pointer;padding:0;line-height:1">✕</button>`;
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
