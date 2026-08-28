import {
    supabase,
    getCurrentUserRow, getCpForSubject,
    getTps, createTp, updateTp, deleteTp,
    getKktps, createKktp, updateKktp, deleteKktp,
    getStudentsForClass,
    getAssessments, createAssessment, updateAssessment, deleteAssessment,
    getAssessmentResults, upsertAssessmentResult,
    getStudentGroups, upsertStudentGroup,
    upsertGradeRecapBatch, getGradeRecap, hitungRekapTp, hapusRekapTp,
    getCp, upsertCp, createCpElemen, updateCpElemen, deleteCpElemen,
} from './api.js';

// ── State ─────────────────────────────────────────────────────────────────────

let _schoolId   = null;   // resolved from getCurrentUserRow
let _teacherId  = null;
let _kelasId    = null;
let _subjectId  = null;
let _year       = null;
let _semester   = null;
let _programCode = null;
let _gradeLevel = null;

let _tpCache    = [];       // learning_objectives rows
let _asmtCache  = [];       // assessments rows
let _rosterCache = [];      // [{id, nama}]
let _sGroupsCache = {};     // { student_id: grup }

// rekap state
let _rcSemester = null;
let _rcYear     = null;
let _rcJenis    = 'SUMATIF'; // DIAGNOSTIK_NK | DIAGNOSTIK_K | FORMATIF | SUMATIF
let _rcTeknik   = '';
let _rcInstrumen = '';
let _rcMetode   = 'rata';   // 'rata' | 'bobot' | 'terbaik'
let _rcBobots   = {};       // { asmt_id: number }
let _rcLastSumatifIds = [];
let _rcHasil    = null;
let _rcPage     = 0;        // halaman aktif paginasi siswa di rekap

const RC_SISWA_PER_HAL = 20;

let _nilaiSedangDisimpan = false; // guard double-submit simpan rekap

let _delegInit  = false;
let _userReady  = false;

let _cpId = null;   // cp_id dari teaching_cp — null jika belum ada record di DB

// sumatif state
let _sumPage         = 0;
let _sumNilai        = {};   // { sid: { nilai, predikat, tl } }
let _sumSiswaList    = [];
let _sumActiveSid    = null;
let _sumSiswaContainer = null; // reference to #pai-siswa-section in open modal

// ── Constants ─────────────────────────────────────────────────────────────────

const PREDIKAT_RUBRIK = [
    { val: 'SB',  lbl: 'Sangat Berkembang' },
    { val: 'BSH', lbl: 'Berkembang Sesuai Harapan' },
    { val: 'MB',  lbl: 'Mulai Berkembang' },
    { val: 'BB',  lbl: 'Belum Berkembang' },
];

const DEFAULT_RENTANG = { BB: [0, 54], MB: [55, 69], BSH: [70, 84], SB: [85, 100] };

const JENIS_LIST   = ['DIAGNOSTIK_NK', 'DIAGNOSTIK_K', 'FORMATIF', 'SUMATIF'];
const JENIS_LABEL  = {
    DIAGNOSTIK_NK : 'Diagnostik Non-Kognitif',
    DIAGNOSTIK_K  : 'Diagnostik Kognitif',
    FORMATIF      : 'Formatif',
    SUMATIF       : 'Sumatif',
};
const TEKNIK_LIST  = ['OBSERVASI', 'TES', 'PENUGASAN', 'PROYEK', 'PORTOFOLIO', 'UNJUK_KERJA', 'TES_LISAN'];
const INSTRUMEN_MAP = {
    OBSERVASI:   ['Lembar Observasi', 'Catatan Anekdot', 'Checklist'],
    TES:         ['Pilihan Ganda', 'Uraian', 'Campuran'],
    PENUGASAN:   ['Rubrik', 'Checklist'],
    PROYEK:      ['Rubrik', 'Checklist'],
    PORTOFOLIO:  ['Rubrik', 'Checklist'],
    UNJUK_KERJA: ['Rubrik', 'Checklist'],
    TES_LISAN:   ['Wawancara', 'Monolog', 'Dialog'],
};

const STATUS_GRUP   = { PAHAM: 'A', BELUM_PAHAM: 'B', PERLU_PERHATIAN: 'C' };
const TINGKAT_OBS   = ['Terlihat Jelas', 'Terlihat', 'Belum Terlihat'];
const PREDIKAT_ORDER = ['BB', 'MB', 'BSH', 'SB'];

// ── Utility ───────────────────────────────────────────────────────────────────

function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function toast(msg, ok = true) {
    const t = document.createElement('div');
    t.style.cssText =
        'position:fixed;bottom:1.5rem;right:1.5rem;z-index:9999;pointer-events:none;' +
        'padding:.5rem 1.25rem;border-radius:.5rem;font-size:13px;line-height:1.4;' +
        'max-width:320px;word-break:break-word;box-shadow:0 2px 8px rgba(0,0,0,.25);' +
        'background:' + (ok ? 'var(--color-success,#2d6a4f)' : 'var(--color-danger,#c0392b)') + ';' +
        'color:#fff;animation:pen-toast-in .2s ease';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
}

function ctxOk() {
    return _kelasId && _subjectId && _year && _semester;
}

async function ensureUser() {
    if (_userReady) return;
    const u = await getCurrentUserRow();
    if (!u) throw new Error('Sesi tidak ditemukan. Muat ulang halaman.');
    _schoolId  = u.school_id;
    _teacherId = u.user_id;
    _userReady = true;
}

// ── Styles ────────────────────────────────────────────────────────────────────

function injectStyles() {
    if (document.getElementById('pen-styles')) return;
    const s = document.createElement('style');
    s.id = 'pen-styles';
    s.textContent = `
/* sections */
.pen-section { border:1px solid var(--color-border); border-radius:8px; margin-bottom:12px; overflow:hidden }
.pen-section-header { display:flex; justify-content:space-between; align-items:center;
  padding:12px 16px; cursor:pointer; font-weight:600; font-size:14px;
  background:var(--color-surface); user-select:none }
.pen-section-header:hover { background:var(--color-surface-hover,var(--color-surface)) }
.pen-chevron { font-size:11px; transition:transform .2s }
.pen-section-body { padding:16px }
/* sub sections */
.pen-sec { margin-bottom:20px }
.pen-sec-label { font-weight:600; font-size:13px; color:var(--color-text-muted);
  text-transform:uppercase; letter-spacing:.04em; margin-bottom:8px }
.pen-placeholder { color:var(--color-text-muted); font-size:13px; padding:8px 0 }
/* cp */
.pen-cp-block { border:1px solid var(--color-border); border-radius:6px; overflow:hidden; margin-bottom:8px }
.pen-cp-header { display:flex; justify-content:space-between; align-items:center;
  padding:10px 14px; cursor:pointer; background:var(--color-surface); font-size:13px; font-weight:600 }
.pen-cp-badge { font-size:11px; background:var(--color-primary); color:#fff; border-radius:4px; padding:2px 6px }
.pen-cp-body { padding:12px 14px; font-size:13px; display:none }
.pen-cp-umum { margin-bottom:8px; line-height:1.5 }
.pen-cp-elemen { margin-bottom:10px }
.pen-cp-elemen-nama { font-weight:600; margin-bottom:2px }
.pen-cp-elemen-desc { color:var(--color-text-muted); line-height:1.5 }
/* tp rows */
.pen-tp-row { border:1px solid var(--color-border); border-radius:6px; margin-bottom:8px; overflow:hidden }
.pen-tp-headline { display:flex; align-items:center; gap:8px; padding:10px 14px;
  background:var(--color-surface); font-size:13px }
.pen-tp-toggle { background:none; border:none; cursor:pointer; font-size:11px; padding:2px 4px; color:var(--color-text) }
.pen-tp-title { font-weight:600 }
.pen-tp-count { font-size:11px; color:var(--color-text-muted) }
.pen-tp-item-body { padding:10px 14px; border-top:1px solid var(--color-border) }
.pen-tp-desc-short,.pen-tp-desc-full { font-size:13px; line-height:1.5; margin:0 0 6px }
.pen-tp-more { background:none; border:none; font-size:12px; color:var(--color-primary); cursor:pointer; padding:0 }
.pen-item-actions { display:flex; gap:6px }
/* kktp */
.pen-kktp-list { margin-top:8px }
.pen-kktp-row { display:grid; grid-template-columns:auto 1fr auto auto; gap:8px; align-items:center;
  padding:6px 8px; border:1px solid var(--color-border); border-radius:4px; margin-bottom:4px; font-size:12px }
.pen-kktp-badge { font-weight:700; font-size:11px; padding:2px 6px; border-radius:3px; background:var(--color-primary); color:#fff }
.pen-kktp-rentang { color:var(--color-text-muted) }
/* buttons */
.pen-btn { display:inline-flex; align-items:center; gap:4px; padding:5px 10px;
  border:1px solid var(--color-border); border-radius:5px; font-size:12px;
  cursor:pointer; background:var(--color-surface); color:var(--color-text); white-space:nowrap }
.pen-btn:hover { background:var(--color-surface-hover,var(--color-surface)) }
.pen-btn-primary { background:var(--color-primary); color:#fff; border-color:var(--color-primary) }
.pen-btn-danger { border-color:var(--color-danger); color:var(--color-danger) }
.pen-btn-danger:hover { background:var(--color-danger); color:#fff }
.pen-btn-sm { padding:3px 7px; font-size:11px }
.pen-add-row { margin-top:8px }
.pen-del-bar { display:flex; gap:6px; align-items:center; padding:6px 8px;
  background:var(--color-danger-bg,#fff0f0); border-radius:4px; margin-top:4px }
/* modal */
.pen-overlay { position:fixed; inset:0; background:rgba(0,0,0,.45); z-index:1000;
  display:flex; align-items:center; justify-content:center; padding:16px }
.pen-modal { background:var(--color-bg); border-radius:10px; width:100%; max-width:580px;
  max-height:90vh; overflow:hidden; display:flex; flex-direction:column; box-shadow:0 8px 32px rgba(0,0,0,.3) }
.pen-modal-header { display:flex; justify-content:space-between; align-items:center;
  padding:14px 18px; border-bottom:1px solid var(--color-border); font-weight:600; font-size:15px }
.pen-modal-close { background:none; border:none; font-size:20px; cursor:pointer; color:var(--color-text-muted) }
.pen-modal-wide { max-width:720px }
.pen-modal-body { padding:18px; overflow-y:auto; flex:1 }
.pen-modal-body label { display:block; font-size:12px; font-weight:600;
  color:var(--color-text-muted); margin:10px 0 4px }
.pen-modal-body input, .pen-modal-body textarea, .pen-modal-body select {
  width:100%; padding:8px 10px; border:1px solid var(--color-border); border-radius:5px;
  font-size:13px; background:var(--color-bg); color:var(--color-text); box-sizing:border-box }
.pen-modal-footer { display:flex; justify-content:flex-end; gap:8px;
  padding:12px 18px; border-top:1px solid var(--color-border) }
.pen-modal-err { color:var(--color-danger); font-size:12px; margin-top:6px }
/* assessments */
.pen-asmt-row { border:1px solid var(--color-border); border-radius:6px; margin-bottom:8px }
.pen-asmt-head { display:flex; align-items:center; gap:8px; padding:10px 14px;
  background:var(--color-surface); font-size:13px; cursor:pointer }
.pen-asmt-badge { font-size:11px; font-weight:700; padding:2px 6px; border-radius:3px }
.pen-asmt-badge-D { background:#e8f5e9; color:#2e7d32 }
.pen-asmt-badge-F { background:#e3f2fd; color:#1565c0 }
.pen-asmt-badge-S { background:#fce4ec; color:#880e4f }
.pen-asmt-body { padding:10px 14px; border-top:1px solid var(--color-border); font-size:12px }
.pen-asmt-meta { color:var(--color-text-muted); margin-bottom:8px }
/* student rows in modal */
.pai-srow { font-size:12px; padding:6px 0; border-bottom:1px solid var(--color-border) }
.pai-srow:last-child { border-bottom:none }
.pai-srow-name { font-weight:600; margin-bottom:4px }
/* sumatif */
.sum-names-wrap { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px }
.sum-nav { display:flex; align-items:center; gap:8px; margin-bottom:6px }
.sum-dots { display:flex; gap:4px; flex-wrap:wrap }
.sum-input-panel { margin-top:10px }
/* instrumen body — instrumen-centric siswa pickers */
.pai-sw-picker { margin-top:3px }
.pai-sw-chips { display:flex; flex-wrap:wrap; gap:4px; margin-bottom:4px; min-height:4px }
.pai-sw-chip { display:inline-flex; align-items:center; gap:3px; padding:2px 8px;
  border-radius:12px; background:var(--color-primary); color:#fff;
  font-size:11px; cursor:pointer; user-select:none }
.pai-sw-chip:hover { opacity:.85 }
/* rekap */
.rc-filter-bar { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px; align-items:center }
.rc-filter-bar select, .rc-filter-bar input { padding:6px 8px; border:1px solid var(--color-border);
  border-radius:5px; font-size:12px; background:var(--color-bg); color:var(--color-text) }
.rc-table { width:100%; border-collapse:collapse; font-size:12px }
.rc-table th,.rc-table td { padding:7px 10px; border:1px solid var(--color-border); text-align:left }
.rc-table th { background:var(--color-surface); font-weight:600 }
.rc-bobot-input { width:50px; text-align:center; padding:3px; border:1px solid var(--color-border); border-radius:3px }
/* rekap paginasi */
.rc-nav { display:flex; align-items:center; gap:8px; margin-top:10px; font-size:12px }
.rc-nav-info { flex:1; color:var(--color-text-muted); text-align:center }
/* toast */
@keyframes pen-toast-in { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:translateY(0) } }
`;
    document.head.appendChild(s);
}

// ── Modal scaffold ────────────────────────────────────────────────────────────

function openModal({ title, bodyHtml, onSave, wide }) {
    const overlay = document.createElement('div');
    overlay.className = 'pen-overlay';
    overlay.innerHTML =
        '<div class="pen-modal' + (wide ? ' pen-modal-wide' : '') + '">' +
            '<div class="pen-modal-header">' +
                '<span>' + esc(title) + '</span>' +
                '<button class="pen-modal-close" data-action="modal-close">×</button>' +
            '</div>' +
            '<div class="pen-modal-body">' + bodyHtml + '</div>' +
            '<div class="pen-modal-footer">' +
                '<button class="pen-btn" data-action="modal-close">Batal</button>' +
                '<button class="pen-btn pen-btn-primary" data-action="modal-save">Simpan</button>' +
            '</div>' +
        '</div>';

    const closeModal = () => overlay.remove();
    overlay.addEventListener('click', e => {
        const act = e.target.closest('[data-action]')?.dataset.action;
        if (act === 'modal-close') closeModal();
        if (act === 'modal-save') {
            if (_nilaiSedangDisimpan) return;
            _nilaiSedangDisimpan = true;
            const saveBtn = overlay.querySelector('[data-action="modal-save"]');
            saveBtn.disabled = true; saveBtn.textContent = 'Menyimpan…';
            let errEl = overlay.querySelector('.pen-modal-err');
            if (!errEl) { errEl = document.createElement('p'); errEl.className = 'pen-modal-err'; overlay.querySelector('.pen-modal-footer').prepend(errEl); }
            errEl.textContent = '';
            Promise.resolve().then(() => onSave(overlay, closeModal)).catch(err => {
                errEl.textContent = err.message || 'Terjadi kesalahan.';
                saveBtn.disabled = false; saveBtn.textContent = 'Simpan';
            }).finally(() => {
                _nilaiSedangDisimpan = false;
            });
        }
        if (e.target === overlay) closeModal();
    });

    document.body.appendChild(overlay);
    overlay.querySelector('input, textarea, select')?.focus();
}

// ── Section 1: Perencanaan ─────────────────────────────────────────────────────

async function renderCp() {
    let cp;
    try { cp = await getCpForSubject(_subjectId, _programCode, _gradeLevel); }
    catch (err) { return '<p class="pen-placeholder" style="color:var(--color-danger)">Gagal memuat CP: ' + esc(err.message) + '</p>'; }
    if (!cp?.found) return '<p class="pen-placeholder">CP nasional belum tersedia untuk mapel ini.</p>';
    const badge = cp.confidence === 'HIGH' ? 'Cocok' : cp.confidence === 'MEDIUM' ? 'Perkiraan' : 'Rendah';
    let elHtml = '';
    (cp.elemen || []).forEach(e => {
        elHtml += '<div class="pen-cp-elemen"><div class="pen-cp-elemen-nama">' + esc(e.nama_elemen) + '</div><div class="pen-cp-elemen-desc">' + esc(e.deskripsi_cp) + '</div></div>';
    });
    return (
        '<div class="pen-cp-block">' +
        '<div class="pen-cp-header" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display===\'none\'?\'block\':\'none\'">' +
        '<span class="pen-cp-title">Capaian Pembelajaran — ' + esc(cp.core_subject_name || '') + '</span>' +
        '<span class="pen-cp-badge">' + esc(badge) + '</span></div>' +
        '<div class="pen-cp-body">' + (cp.cp_umum ? '<p class="pen-cp-umum">' + esc(cp.cp_umum) + '</p>' : '') + elHtml + '</div></div>'
    );
}

function kktpRowHtml(k) {
    const r = k.rentang || DEFAULT_RENTANG;
    const rangeTxt = PREDIKAT_RUBRIK.map(p => p.val + ': ' + (r[p.val] || [0,0]).join('–')).join(' | ');
    return (
        '<div class="pen-kktp-row" data-kktp-id="' + esc(k.id) + '">' +
        '<span class="pen-kktp-badge">' + esc(k.keterangan || 'KKTP') + '</span>' +
        '<span class="pen-kktp-rentang">' + esc(rangeTxt) + '</span>' +
        '<button class="pen-btn pen-btn-sm" data-action="kktp-edit" data-id="' + esc(k.id) + '">Edit</button>' +
        '<button class="pen-btn pen-btn-sm pen-btn-danger" data-action="kktp-delete" data-id="' + esc(k.id) + '">Hapus</button>' +
        '</div>'
    );
}

function renderKktpList(tpId, kktps) {
    const listEl = document.getElementById('pen-kktp-list-' + tpId);
    if (!listEl) return;
    const countEl = document.getElementById('pen-tp-count-' + tpId);
    if (countEl) countEl.textContent = kktps.length + ' KKTP';
    listEl.innerHTML = kktps.length
        ? kktps.map(kktpRowHtml).join('')
        : '<p class="pen-placeholder">Belum ada KKTP.</p>';
    // 1 TP = 1 KKTP — tombol tambah hanya muncul saat TP belum punya KKTP
    const addEl = document.getElementById('pen-kktp-add-' + tpId);
    if (addEl) addEl.style.display = kktps.length ? 'none' : '';
}

async function loadAndRenderKktps(tpId) {
    try {
        const kktps = await getKktps(tpId);
        renderKktpList(tpId, kktps);
    } catch (err) {
        const el = document.getElementById('pen-kktp-list-' + tpId);
        if (el) el.innerHTML = '<p class="pen-placeholder" style="color:var(--color-danger)">Gagal: ' + esc(err.message) + '</p>';
    }
}

function kktpRentangFormHtml(rentang) {
    const r = rentang || DEFAULT_RENTANG;
    return PREDIKAT_RUBRIK.map(p => (
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">' +
        '<span style="width:36px;font-weight:700;font-size:12px">' + p.val + '</span>' +
        '<input type="number" class="pen-rentang-lo" data-predikat="' + p.val + '" min="0" max="100" value="' + (r[p.val]||[0,0])[0] + '" style="width:70px">' +
        '<span style="font-size:12px">–</span>' +
        '<input type="number" class="pen-rentang-hi" data-predikat="' + p.val + '" min="0" max="100" value="' + (r[p.val]||[0,0])[1] + '" style="width:70px">' +
        '</div>'
    )).join('');
}

function openKktpModal(tpId, kktp) {
    const existing = kktp;
    openModal({
        title: existing ? 'Edit KKTP' : 'Tambah KKTP',
        bodyHtml:
            '<label>Label / Keterangan</label>' +
            '<input type="text" id="pen-kktp-label" maxlength="100" placeholder="Contoh: KKTP 1" value="' + esc(existing?.keterangan || '') + '">' +
            '<label>Rentang Nilai (BB/MB/BSH/SB)</label>' +
            kktpRentangFormHtml(existing?.rentang),
        onSave: async (_overlay, close) => {
            const label  = _overlay.querySelector('#pen-kktp-label').value.trim();
            const rentang = {};
            PREDIKAT_RUBRIK.forEach(p => {
                const lo = parseInt(_overlay.querySelector('.pen-rentang-lo[data-predikat="' + p.val + '"]').value, 10);
                const hi = parseInt(_overlay.querySelector('.pen-rentang-hi[data-predikat="' + p.val + '"]').value, 10);
                rentang[p.val] = [isNaN(lo) ? 0 : lo, isNaN(hi) ? 100 : hi];
            });
            await ensureUser();
            if (existing) {
                await updateKktp(existing.id, { keterangan: label, rentang });
            } else {
                const urutan = (await getKktps(tpId)).length + 1;
                await createKktp({
                    school_id: _schoolId,
                    learning_objective_id: tpId,
                    keterangan: label,
                    rentang,
                    urutan,
                });
            }
            close();
            await loadAndRenderKktps(tpId);
        },
    });
}

function confirmDeleteKktp(tpId, kktpId, origBtn) {
    origBtn.style.display = 'none';
    const row = origBtn.closest('.pen-kktp-row');
    const bar = document.createElement('div');
    bar.className = 'pen-del-bar';
    bar.innerHTML = '<span style="flex:1;font-size:12px">Hapus KKTP ini?</span>' +
        '<button class="pen-btn pen-btn-sm pen-btn-danger pen-del-yes">Ya, Hapus</button>' +
        '<button class="pen-btn pen-btn-sm pen-del-no">Tidak</button>';
    row.after(bar);
    bar.querySelector('.pen-del-yes').addEventListener('click', async function () {
        this.disabled = true; this.textContent = 'Menghapus…';
        try { await deleteKktp(kktpId); await loadAndRenderKktps(tpId); }
        catch (err) { bar.remove(); origBtn.style.display = ''; alert('Gagal hapus: ' + err.message); }
    });
    bar.querySelector('.pen-del-no').addEventListener('click', () => { bar.remove(); origBtn.style.display = ''; });
}

function tpRowHtml(tp) {
    const bodyId  = 'pen-tp-body-' + tp.id;
    const kktpId  = 'pen-kktp-list-' + tp.id;
    const countId = 'pen-tp-count-' + tp.id;
    const descShort = tp.deskripsi_tp?.length > 120 ? tp.deskripsi_tp.slice(0, 120) + '…' : tp.deskripsi_tp;
    const hasMore   = tp.deskripsi_tp?.length > 120;
    return (
        '<div class="pen-tp-row" data-tp-id="' + esc(tp.id) + '">' +
        '<div class="pen-tp-headline">' +
        '<button class="pen-tp-toggle" data-action="pen-toggle" data-body="' + bodyId + '" data-tp-id="' + esc(tp.id) + '">▶</button>' +
        '<span class="pen-tp-title">' + esc(tp.kode_tp) + '</span>' +
        '<span class="pen-tp-count" id="' + countId + '">0 KKTP</span>' +
        '<div class="pen-item-actions" style="margin-left:auto">' +
        '<button class="pen-btn pen-btn-sm" data-action="tp-edit" data-id="' + esc(tp.id) + '">Edit</button>' +
        '<button class="pen-btn pen-btn-sm pen-btn-danger" data-action="tp-delete" data-id="' + esc(tp.id) + '">Hapus</button>' +
        '</div></div>' +
        '<div class="pen-tp-item-body" id="' + bodyId + '" style="display:none">' +
        '<p class="pen-tp-desc-short" id="pen-tp-short-' + tp.id + '">' + esc(descShort) + '</p>' +
        (hasMore
            ? '<p class="pen-tp-desc-full" id="pen-tp-full-' + tp.id + '" style="display:none">' + esc(tp.deskripsi_tp) + '</p>' +
              '<button class="pen-tp-more" data-action="tp-desc-toggle" data-id="' + esc(tp.id) + '">Selengkapnya</button>'
            : '') +
        '<div class="pen-kktp-list" id="' + kktpId + '"><p class="pen-placeholder">Memuat KKTP…</p></div>' +
        '<div class="pen-add-row" id="pen-kktp-add-' + tp.id + '" style="display:none">' +
        '<button class="pen-btn pen-btn-sm" data-action="kktp-add" data-tp-id="' + esc(tp.id) + '">+ Tambah KKTP</button></div>' +
        '</div></div>'
    );
}

function openTpModal(tp) {
    openModal({
        title: tp ? 'Edit Tujuan Pembelajaran' : 'Tambah Tujuan Pembelajaran',
        bodyHtml:
            '<label>Kode TP <span style="color:var(--color-danger)">*</span></label>' +
            '<input type="text" id="pen-tp-kode" maxlength="30" placeholder="Contoh: TP.1" value="' + esc(tp?.kode_tp || '') + '">' +
            '<label>Deskripsi TP <span style="color:var(--color-danger)">*</span></label>' +
            '<textarea id="pen-tp-desc" rows="4" maxlength="2000" placeholder="Deskripsi tujuan pembelajaran…">' + esc(tp?.deskripsi_tp || '') + '</textarea>' +
            '<label>Urutan</label>' +
            '<input type="number" id="pen-tp-urutan" min="1" step="1" value="' + esc(String(tp?.urutan ?? '')) + '">',
        onSave: async (_ov, close) => {
            const kode   = _ov.querySelector('#pen-tp-kode').value.trim();
            const desc   = _ov.querySelector('#pen-tp-desc').value.trim();
            const urutan = parseInt(_ov.querySelector('#pen-tp-urutan').value, 10) || (_tpCache.length + 1);
            if (!kode) throw new Error('Kode TP wajib diisi.');
            if (!desc) throw new Error('Deskripsi TP wajib diisi.');
            await ensureUser();
            if (tp) {
                await updateTp(tp.id, { kode_tp: kode, deskripsi_tp: desc, urutan });
            } else {
                await createTp({
                    school_id: _schoolId, teacher_id: _teacherId,
                    class_id: _kelasId, subject_id: _subjectId,
                    academic_year: _year, semester: Number(_semester),
                    kode_tp: kode, deskripsi_tp: desc, urutan,
                });
            }
            close();
            await renderPerencanaan();
        },
    });
}

async function confirmDeleteTp(tp, origBtn) {
    origBtn.style.display = 'none';
    const row = origBtn.closest('.pen-tp-row');
    const bar = document.createElement('div');
    bar.className = 'pen-del-bar';
    bar.innerHTML = '<span style="flex:1;font-size:12px">Menghitung rekap nilai…</span>' +
        '<button class="pen-btn pen-btn-sm pen-btn-danger pen-del-yes" disabled>Ya, Hapus</button>' +
        '<button class="pen-btn pen-btn-sm pen-del-no">Tidak</button>';
    row.appendChild(bar);
    let rekapCount = 0;
    try {
        rekapCount = await hitungRekapTp(tp.id);
    } catch (_) { /* tampilkan konfirmasi tanpa count jika gagal */ }
    const msgSpan = bar.querySelector('span');
    if (msgSpan) {
        msgSpan.textContent = 'Hapus "' + tp.kode_tp + '"? Semua KKTP dan ' +
            (rekapCount > 0 ? rekapCount + ' rekap nilai siswa' : 'rekap nilai siswa') +
            ' untuk TP ini ikut terhapus permanen.';
    }
    bar.querySelector('.pen-del-yes').disabled = false;
    bar.querySelector('.pen-del-yes').addEventListener('click', async function () {
        this.disabled = true; this.textContent = 'Menghapus…';
        try { await deleteTp(tp.id); await renderPerencanaan(); }
        catch (err) { bar.remove(); origBtn.style.display = ''; alert('Gagal hapus: ' + err.message); }
    });
    bar.querySelector('.pen-del-no').addEventListener('click', () => { bar.remove(); origBtn.style.display = ''; });
}

async function refreshCpElemenList() {
    const el = document.getElementById('pen-cp-elemen-body');
    if (!el) return;
    if (!_cpId) { el.innerHTML = '<p class="pen-placeholder">Belum ada elemen CP.</p>'; return; }
    let rows;
    try {
        const { data, error } = await supabase
            .from('teaching_cp_elements')
            .select('element_id, nama_elemen, deskripsi_cp, urutan')
            .eq('cp_id', _cpId)
            .order('urutan', { ascending: true })
            .order('created_at', { ascending: true });
        if (error) throw error;
        rows = data || [];
    } catch (err) {
        el.innerHTML = '<p class="pen-placeholder" style="color:var(--color-danger)">Gagal memuat elemen: ' + esc(err.message) + '</p>';
        return;
    }
    if (!rows.length) { el.innerHTML = '<p class="pen-placeholder">Belum ada elemen CP.</p>'; return; }
    el.innerHTML = rows.map((e, i) => (
        '<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--color-border);border-radius:4px;margin-bottom:4px;font-size:13px">' +
        '<span style="flex:1"><strong>Elemen ' + (i + 1) + '</strong> — ' + esc(e.nama_elemen) + '</span>' +
        '<button class="pen-btn pen-btn-sm" data-action="cp-elemen-edit" data-element-id="' + e.element_id + '" data-nama="' + esc(e.nama_elemen) + '" data-deskripsi="' + esc(e.deskripsi_cp) + '">Edit</button>' +
        '<button class="pen-btn pen-btn-sm pen-btn-danger" data-action="cp-elemen-delete" data-element-id="' + e.element_id + '">Hapus</button>' +
        '</div>'
    )).join('');
}

function openCpElemenModal(elementId, existingNama, existingDesk) {
    openModal({
        title: elementId ? 'Edit Elemen CP' : 'Tambah Elemen CP',
        bodyHtml:
            '<label>Nama Elemen <span style="color:var(--color-danger)">*</span></label>' +
            '<input type="text" id="pen-cp-el-nama" maxlength="200" placeholder="Nama elemen…" value="' + esc(existingNama || '') + '">' +
            '<label>Deskripsi Elemen <span style="color:var(--color-danger)">*</span></label>' +
            '<textarea id="pen-cp-el-desk" rows="4" maxlength="2000" placeholder="Deskripsi elemen…">' + esc(existingDesk || '') + '</textarea>',
        onSave: async (_ov, close) => {
            const nama = _ov.querySelector('#pen-cp-el-nama').value.trim();
            const desk = _ov.querySelector('#pen-cp-el-desk').value.trim();
            if (!nama) throw new Error('Nama Elemen wajib diisi.');
            if (!desk) throw new Error('Deskripsi Elemen wajib diisi.');
            await ensureUser();
            if (elementId) {
                await updateCpElemen(elementId, nama, desk);
            } else {
                if (!_cpId) {
                    const cpUmum = document.getElementById('pen-cp-umum-input')?.value.trim() || '';
                    _cpId = await upsertCp(_schoolId, _teacherId, _kelasId, _subjectId, _year, Number(_semester), cpUmum);
                }
                const nextUrutan = document.querySelectorAll('#pen-cp-elemen-body [data-element-id]').length;
                await createCpElemen(_cpId, _schoolId, _teacherId, nama, desk, nextUrutan);
            }
            close();
            await refreshCpElemenList();
        },
    });
}

async function renderPerencanaan() {
    const body = document.getElementById('pen-perencanaan-body');
    if (!body) return;
    const hasCtx = ctxOk();

    body.innerHTML =
        '<div class="pen-sec">' +
        '<div class="pen-sec-label">Capaian Pembelajaran</div>' +
        '<div class="pen-sec-body" id="pen-cp-manual-body">' +
        '<label style="display:block;font-size:12px;font-weight:600;color:var(--color-text-muted);margin:0 0 4px">CP Umum</label>' +
        '<textarea id="pen-cp-umum-input" rows="4" style="width:100%;padding:8px 10px;border:1px solid var(--color-border);border-radius:5px;font-size:13px;background:var(--color-bg);color:var(--color-text);box-sizing:border-box;resize:vertical" placeholder="Tulis capaian pembelajaran umum…"' +
        (hasCtx ? '' : ' disabled') + '></textarea>' +
        '<div class="pen-sec-label" style="margin-top:12px">Elemen CP</div>' +
        '<div id="pen-cp-elemen-body"><p class="pen-placeholder">Memuat…</p></div>' +
        (hasCtx ? '<div class="pen-add-row"><button class="pen-btn" data-action="cp-elemen-add">+ Tambah Elemen</button></div>' : '') +
        '</div></div>' +
        '<div class="pen-sec"><div class="pen-sec-label" id="pen-tp-label">Tujuan Pembelajaran</div>' +
        '<div id="pen-tp-body">' +
        (hasCtx ? '<p class="pen-placeholder">Memuat TP…</p>' : '<p class="pen-placeholder">Pilih kelas, mapel, tahun, dan semester.</p>') +
        '</div>' +
        (hasCtx ? '<div class="pen-add-row"><button class="pen-btn" data-action="tp-add">+ Tambah TP</button></div>' : '') +
        '</div>';

    if (!hasCtx) {
        document.getElementById('pen-cp-elemen-body').innerHTML = '<p class="pen-placeholder">Pilih kelas, mapel, tahun, dan semester.</p>';
        return;
    }

    // Load CP dan TP secara paralel
    await ensureUser();
    const [cpResult, tps] = await Promise.allSettled([
        getCp(_kelasId, _subjectId, _year, Number(_semester)),
        getTps(_kelasId, _subjectId, _year, Number(_semester)),
    ]);

    // Populate CP section
    if (cpResult.status === 'fulfilled' && cpResult.value) {
        const cpData = cpResult.value;
        _cpId = cpData.cp_id;
        const ta = document.getElementById('pen-cp-umum-input');
        if (ta) ta.value = cpData.cp_umum || '';
        const elBody = document.getElementById('pen-cp-elemen-body');
        if (elBody) {
            if (!cpData.elemen.length) {
                elBody.innerHTML = '<p class="pen-placeholder">Belum ada elemen CP.</p>';
            } else {
                elBody.innerHTML = cpData.elemen.map((e, i) => (
                    '<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--color-border);border-radius:4px;margin-bottom:4px;font-size:13px">' +
                    '<span style="flex:1"><strong>Elemen ' + (i + 1) + '</strong> — ' + esc(e.nama_elemen) + '</span>' +
                    '<button class="pen-btn pen-btn-sm" data-action="cp-elemen-edit" data-element-id="' + e.element_id + '" data-nama="' + esc(e.nama_elemen) + '" data-deskripsi="' + esc(e.deskripsi_cp) + '">Edit</button>' +
                    '<button class="pen-btn pen-btn-sm pen-btn-danger" data-action="cp-elemen-delete" data-element-id="' + e.element_id + '">Hapus</button>' +
                    '</div>'
                )).join('');
            }
        }
    } else {
        _cpId = null;
        const elBody = document.getElementById('pen-cp-elemen-body');
        if (elBody) elBody.innerHTML = '<p class="pen-placeholder">Belum ada elemen CP.</p>';
        if (cpResult.status === 'rejected') {
            console.error('Gagal memuat CP:', cpResult.reason);
        }
    }

    // Wire auto-save cp_umum on blur (debounce 800ms)
    const ta = document.getElementById('pen-cp-umum-input');
    if (ta) {
        let _cpBlurTimer = null;
        ta.addEventListener('blur', () => {
            clearTimeout(_cpBlurTimer);
            _cpBlurTimer = setTimeout(async () => {
                const val = ta.value.trim();
                try {
                    await ensureUser();
                    _cpId = await upsertCp(_schoolId, _teacherId, _kelasId, _subjectId, _year, Number(_semester), val);
                } catch (err) {
                    console.error('Auto-save CP umum gagal:', err);
                }
            }, 800);
        });
    }

    // Populate TP section
    if (tps.status === 'rejected') {
        const el = document.getElementById('pen-tp-body');
        if (el) el.innerHTML = '<p class="pen-placeholder" style="color:var(--color-danger)">Gagal memuat TP: ' + esc(tps.reason.message) + '</p>';
        return;
    }
    const tpData = tps.value;
    _tpCache = tpData;
    const tpLabel = document.getElementById('pen-tp-label');
    if (tpLabel) tpLabel.textContent = 'Tujuan Pembelajaran (' + tpData.length + ')';
    const tpBody = document.getElementById('pen-tp-body');
    if (!tpBody) return;
    if (!tpData.length) {
        tpBody.innerHTML = '<p class="pen-placeholder">Belum ada TP. Klik "+ Tambah TP" untuk mulai.</p>';
        return;
    }
    tpBody.innerHTML = tpData.map(tpRowHtml).join('');
    tpData.forEach(tp => loadAndRenderKktps(tp.id));
}

// ── Section 2: Pelaksanaan ────────────────────────────────────────────────────

// ── Instrumen-body helpers ────────────────────────────────────────────────────

function inputCss(extra) {
    return 'width:100%;padding:6px 8px;border:1px solid var(--color-border);border-radius:4px;' +
        'background:var(--color-bg);color:var(--color-text);font-size:12px;box-sizing:border-box;' +
        (extra ? extra + ';' : '');
}

function fieldLbl(label) {
    return '<label style="display:block;font-size:11px;font-weight:600;color:var(--color-text-muted);margin:5px 0 2px">' + esc(label) + '</label>';
}

function addBtnHtml(cls, label) {
    return '<button type="button" class="' + esc(cls) + '" ' +
        'style="margin-top:6px;font-size:11px;background:transparent;' +
        'border:1.5px dashed var(--color-border);color:var(--color-text-muted);' +
        'border-radius:4px;cursor:pointer;padding:4px 10px;width:100%">' + esc(label) + '</button>';
}

function siswaPickerHtml(pickerId) {
    const opts = _rosterCache.map(s =>
        '<option value="' + esc(s.id) + '">' + esc(s.nama) + '</option>'
    ).join('');
    return '<div class="pai-sw-picker" data-picker-id="' + esc(pickerId) + '">' +
        '<div class="pai-sw-chips"></div>' +
        '<select class="pai-sw-sel" style="' + inputCss('font-size:11px;margin-top:3px') + '">' +
        '<option value="">— Tambah siswa —</option>' + opts +
        '</select></div>';
}

function chipSiswaHtml(sid, nama) {
    return '<span class="pai-sw-chip" data-sid="' + esc(sid) + '">' + esc(nama) + ' ×</span>';
}

function aspekRowHtml(idx) {
    return '<div class="pai-aspek-row" data-aspek="' + idx + '" ' +
        'style="border:1px solid var(--color-border);border-radius:6px;padding:8px 10px;margin-bottom:6px">' +
        '<div style="display:flex;gap:6px;align-items:center;margin-bottom:4px">' +
        '<span style="font-size:11px;font-weight:600;color:var(--color-text-muted)">Aspek ' + (idx + 1) + ':</span>' +
        '<input class="aspek-nama" type="text" placeholder="Nama aspek…" style="' + inputCss('flex:1') + '">' +
        '<button type="button" class="btn-del-aspek" ' +
        'style="background:transparent;border:none;cursor:pointer;font-size:13px;color:var(--color-text-muted);padding:2px 5px">✕</button>' +
        '</div>' +
        PREDIKAT_RUBRIK.map(p => (
            '<div class="pai-aspek-pred" data-pred="' + p.val + '" ' +
            'style="padding:4px 0;border-top:1px solid var(--color-border)">' +
            '<div style="font-size:11px;font-weight:700;color:var(--color-text-muted);margin-bottom:3px">' + esc(p.lbl) + ':</div>' +
            '<textarea class="predikat-desk predikat-desk-' + p.val + '" rows="2" ' +
            'placeholder="Deskripsi deskriptor… (opsional)" ' +
            'style="' + inputCss('resize:vertical;font-size:11px;margin-bottom:3px') + '"></textarea>' +
            '<div style="font-size:11px;color:var(--color-text-muted);margin-bottom:2px">Siswa:</div>' +
            siswaPickerHtml('aspek-' + idx + '-' + p.val) +
            '</div>'
        )).join('') +
        '</div>';
}

function checklistItemHtml(idx) {
    return '<div class="pai-item-row" data-item="' + idx + '" ' +
        'style="border:1px solid var(--color-border);border-radius:6px;padding:8px 10px;margin-bottom:6px">' +
        '<div style="display:flex;gap:6px;align-items:center;margin-bottom:6px">' +
        '<input class="item-nama" type="text" placeholder="Item ' + (idx + 1) + '…" ' +
        'style="' + inputCss('flex:1') + '">' +
        '<button type="button" class="btn-del-item" ' +
        'style="background:transparent;border:none;cursor:pointer;font-size:13px;color:var(--color-text-muted);padding:2px 5px">✕</button>' +
        '</div>' +
        '<div style="font-size:11px;color:var(--color-text-muted);margin-bottom:3px">Siswa yang memenuhi:</div>' +
        siswaPickerHtml('item-' + idx + '-siswa') +
        '</div>';
}

function observasiAspekHtml(idx) {
    return '<div class="pai-obs-aspek" data-aspek="' + idx + '" ' +
        'style="border:1px solid var(--color-border);border-radius:6px;padding:8px 10px;margin-bottom:6px">' +
        '<div style="display:flex;gap:6px;align-items:center;margin-bottom:4px">' +
        '<span style="font-size:11px;font-weight:600;color:var(--color-text-muted)">Aspek ' + (idx + 1) + ':</span>' +
        '<input class="obs-aspek-nama" type="text" placeholder="Nama aspek observasi…" style="' + inputCss('flex:1') + '">' +
        '<button type="button" class="btn-del-obs-aspek" ' +
        'style="background:transparent;border:none;cursor:pointer;font-size:13px;color:var(--color-text-muted);padding:2px 5px">✕</button>' +
        '</div>' +
        '<div style="margin-bottom:4px">' + fieldLbl('Indikator (opsional):') +
        '<input class="obs-indikator" type="text" placeholder="Tuliskan indikator…" style="' + inputCss() + '"></div>' +
        TINGKAT_OBS.map(t => (
            '<div style="padding:4px 0;border-top:1px solid var(--color-border)">' +
            '<div style="font-size:11px;font-weight:700;margin-bottom:3px">' + esc(t) + ':</div>' +
            siswaPickerHtml('obs-' + idx + '-' + t.replace(/\s/g, '_')) +
            '</div>'
        )).join('') +
        '</div>';
}

function anekdotCatatanHtml(idx, modePerSiswa) {
    const siswaOpts = _rosterCache.map(s =>
        '<option value="' + esc(s.id) + '">' + esc(s.nama) + '</option>'
    ).join('');
    return '<div class="pai-anekdot-row" data-catatan="' + idx + '" ' +
        'style="border:1px solid var(--color-border);border-radius:6px;padding:6px 10px;margin-bottom:4px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">' +
        '<span style="font-size:11px;font-weight:700">Catatan ' + (idx + 1) + '</span>' +
        '<button type="button" class="btn-del-catatan" ' +
        'style="background:transparent;border:none;cursor:pointer;font-size:13px;color:var(--color-text-muted);padding:2px 5px">✕</button>' +
        '</div>' +
        (modePerSiswa
            ? '<div style="margin-bottom:4px">' + fieldLbl('Siswa') +
              '<select class="anekdot-siswa-sel" style="' + inputCss('font-size:11px') + '">' +
              '<option value="">— Pilih siswa —</option>' + siswaOpts + '</select></div>'
            : '<div style="margin-bottom:4px"><div style="font-size:11px;color:var(--color-text-muted);margin-bottom:2px">Siswa yang terlibat:</div>' +
              siswaPickerHtml('anekdot-' + idx + '-siswa') + '</div>') +
        '<div style="margin-bottom:4px">' + fieldLbl('Deskripsi kejadian') +
        '<textarea class="anekdot-deskripsi" rows="2" placeholder="Tuliskan kejadian…" ' +
        'style="' + inputCss('resize:vertical;font-size:11px') + '"></textarea></div>' +
        '<div>' + fieldLbl('Interpretasi (opsional)') +
        '<textarea class="anekdot-interpretasi" rows="2" placeholder="Tuliskan interpretasi opsional…" ' +
        'style="' + inputCss('resize:vertical;font-size:11px') + '"></textarea></div>' +
        '</div>';
}

function konteksPrefixHtml(teknik) {
    if (teknik === 'PENUGASAN') return '<div style="margin-bottom:6px">' + fieldLbl('Deskripsi tugas (opsional)') + '<textarea id="pai-konteks-1" rows="2" placeholder="Tuliskan deskripsi tugas…" style="' + inputCss('resize:vertical;font-size:11px') + '"></textarea></div>';
    if (teknik === 'PROYEK') return '<div style="margin-bottom:6px">' + fieldLbl('Nama proyek (opsional)') + '<input type="text" id="pai-konteks-1" placeholder="Tuliskan nama proyek…" style="' + inputCss() + '">' + '<div style="margin-top:4px">' + fieldLbl('Deskripsi (opsional)') + '<textarea id="pai-konteks-2" rows="2" placeholder="Tuliskan deskripsi proyek…" style="' + inputCss('resize:vertical;font-size:11px') + '"></textarea></div></div>';
    if (teknik === 'PORTOFOLIO') return '<div style="margin-bottom:6px">' + fieldLbl('Tema portofolio (opsional)') + '<input type="text" id="pai-konteks-1" placeholder="Tuliskan tema…" style="' + inputCss() + '">' + '<div style="margin-top:4px">' + fieldLbl('Periode (opsional)') + '<input type="text" id="pai-konteks-2" placeholder="Tuliskan periode…" style="' + inputCss() + '"></div></div>';
    if (teknik === 'UNJUK_KERJA') return '<div style="margin-bottom:6px">' + fieldLbl('Deskripsi unjuk kerja (opsional)') + '<textarea id="pai-konteks-1" rows="2" placeholder="Tuliskan deskripsi…" style="' + inputCss('resize:vertical;font-size:11px') + '"></textarea></div>';
    return '';
}

function renderBodyInstrumen(teknik, instrumen, container) {
    if (!container) return;
    let inner = '';

    if (teknik === 'OBSERVASI') {
        if (instrumen === 'Lembar Observasi') {
            inner = '<div id="pai-obs-aspeks">' + observasiAspekHtml(0) + '</div>' +
                addBtnHtml('btn-tambah-obs-aspek', '+ Tambah aspek observasi');
        } else if (instrumen === 'Catatan Anekdot') {
            inner = '<div style="margin-bottom:6px">' + fieldLbl('Mode') +
                '<select id="pai-anekdot-mode" style="' + inputCss() + '">' +
                '<option value="per_siswa">Per Siswa</option>' +
                '<option value="per_kejadian">Per Kejadian</option>' +
                '</select></div>' +
                '<div id="pai-anekdot-rows">' + anekdotCatatanHtml(0, true) + '</div>' +
                addBtnHtml('btn-tambah-catatan', '+ Tambah catatan');
        } else if (instrumen === 'Checklist') {
            inner = '<div id="pai-cl-items">' + checklistItemHtml(0) + '</div>' +
                addBtnHtml('btn-tambah-item', '+ Tambah item');
        }
    } else if (teknik === 'TES') {
        inner = ['Menjawab dengan baik', 'Menjawab sebagian', 'Belum bisa menjawab'].map((dsk, i) => (
            '<div class="pai-tl-dsk-block" data-dsk="' + i + '" ' +
            'style="padding:5px 0;border-top:1px solid var(--color-border)">' +
            '<div style="font-size:11px;font-weight:700;margin-bottom:3px">' + esc(dsk) + ':</div>' +
            siswaPickerHtml('tes-dsk-' + i) +
            '</div>'
        )).join('');
    } else if (teknik === 'TES_LISAN') {
        if (instrumen === 'Wawancara') {
            inner = '<div style="margin-bottom:6px">' + fieldLbl('Topik wawancara (opsional)') +
                '<input type="text" id="pai-tl-topik" placeholder="Tuliskan topik…" style="' + inputCss() + '"></div>' +
                ['Menjawab dengan baik', 'Menjawab sebagian', 'Belum bisa menjawab'].map((dsk, i) => (
                    '<div class="pai-tl-dsk-block" data-dsk="' + i + '" ' +
                    'style="padding:5px 0;border-top:1px solid var(--color-border)">' +
                    '<div style="font-size:11px;font-weight:700;margin-bottom:3px">' + esc(dsk) + ':</div>' +
                    siswaPickerHtml('tl-waw-' + i) +
                    '</div>'
                )).join('');
        } else {
            const topikLabel = instrumen === 'Monolog' ? 'Topik monolog (opsional)' : 'Topik dialog (opsional)';
            inner = '<div style="margin-bottom:6px">' + fieldLbl(topikLabel) +
                '<input type="text" id="pai-tl-topik" placeholder="Tuliskan topik…" style="' + inputCss() + '"></div>' +
                PREDIKAT_RUBRIK.map((p, i) => (
                    '<div class="pai-tl-pred-block" data-pred="' + p.val + '" ' +
                    'style="padding:5px 0;border-top:1px solid var(--color-border)">' +
                    '<div style="font-size:11px;font-weight:700;margin-bottom:3px">' + esc(p.lbl) + '</div>' +
                    '<textarea class="tl-pred-desk tl-pred-desk-' + p.val + '" rows="2" ' +
                    'placeholder="Deskripsi deskriptor… (opsional)" style="' + inputCss('resize:vertical;font-size:11px') + '"></textarea>' +
                    '<div style="font-size:11px;color:var(--color-text-muted);margin:.3rem 0 .1rem">Siswa:</div>' +
                    siswaPickerHtml('tl-' + i + '-' + p.val) +
                    '</div>'
                )).join('');
        }
    } else if (['PENUGASAN', 'PROYEK', 'PORTOFOLIO', 'UNJUK_KERJA'].includes(teknik)) {
        const prefix = konteksPrefixHtml(teknik);
        if (instrumen === 'Rubrik') {
            inner = prefix + '<div id="pai-rubrik-aspeks">' + aspekRowHtml(0) + '</div>' +
                addBtnHtml('btn-tambah-aspek', '+ Tambah aspek');
        } else if (instrumen === 'Checklist') {
            inner = prefix + '<div id="pai-cl-items">' + checklistItemHtml(0) + '</div>' +
                addBtnHtml('btn-tambah-item', '+ Tambah item');
        }
    }

    container.innerHTML = inner
        ? '<div style="background:var(--color-surface);border-radius:6px;padding:10px">' +
          '<div style="font-size:11px;font-weight:700;color:var(--color-primary);' +
          'text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Isi Penilaian</div>' +
          inner + '</div>'
        : '';
}

function wireBodyInstrumen(container) {
    if (!container) return;

    container.addEventListener('change', e => {
        if (e.target.classList.contains('pai-sw-sel')) {
            const sid = e.target.value;
            if (!sid) return;
            const picker = e.target.closest('.pai-sw-picker');
            if (!picker) return;
            if (picker.querySelector('.pai-sw-chip[data-sid="' + sid + '"]')) { e.target.value = ''; return; }
            const stu = _rosterCache.find(r => r.id === sid);
            if (!stu) return;
            picker.querySelector('.pai-sw-chips')?.insertAdjacentHTML('beforeend', chipSiswaHtml(sid, stu.nama));
            const opt = e.target.querySelector('option[value="' + sid + '"]');
            if (opt) opt.style.display = 'none';
            e.target.value = '';
            return;
        }
        if (e.target.id === 'pai-anekdot-mode') {
            const modePerSiswa = e.target.value === 'per_siswa';
            const rowsDiv = container.querySelector('#pai-anekdot-rows');
            if (!rowsDiv) return;
            const n = rowsDiv.querySelectorAll('.pai-anekdot-row').length || 1;
            rowsDiv.innerHTML = Array.from({ length: n }, (_, i) => anekdotCatatanHtml(i, modePerSiswa)).join('');
        }
    });

    container.addEventListener('click', e => {
        const chip = e.target.closest('.pai-sw-chip');
        if (chip && container.contains(chip)) {
            const sid = chip.dataset.sid;
            const picker = chip.closest('.pai-sw-picker');
            if (picker) {
                const opt = picker.querySelector('.pai-sw-sel option[value="' + sid + '"]');
                if (opt) opt.style.display = '';
            }
            chip.remove();
            return;
        }
        const tgt = e.target.closest('button');
        if (!tgt) return;
        if (tgt.classList.contains('btn-tambah-aspek')) {
            const d = container.querySelector('#pai-rubrik-aspeks');
            if (d) d.insertAdjacentHTML('beforeend', aspekRowHtml(d.querySelectorAll('.pai-aspek-row').length));
            return;
        }
        if (tgt.classList.contains('btn-del-aspek')) { tgt.closest('.pai-aspek-row')?.remove(); return; }
        if (tgt.classList.contains('btn-tambah-item')) {
            const d = container.querySelector('#pai-cl-items');
            if (d) d.insertAdjacentHTML('beforeend', checklistItemHtml(d.querySelectorAll('.pai-item-row').length));
            return;
        }
        if (tgt.classList.contains('btn-del-item')) { tgt.closest('.pai-item-row')?.remove(); return; }
        if (tgt.classList.contains('btn-tambah-obs-aspek')) {
            const d = container.querySelector('#pai-obs-aspeks');
            if (d) d.insertAdjacentHTML('beforeend', observasiAspekHtml(d.querySelectorAll('.pai-obs-aspek').length));
            return;
        }
        if (tgt.classList.contains('btn-del-obs-aspek')) { tgt.closest('.pai-obs-aspek')?.remove(); return; }
        if (tgt.classList.contains('btn-tambah-catatan')) {
            const d = container.querySelector('#pai-anekdot-rows');
            const mode = container.querySelector('#pai-anekdot-mode')?.value;
            if (d) d.insertAdjacentHTML('beforeend', anekdotCatatanHtml(d.querySelectorAll('.pai-anekdot-row').length, !mode || mode === 'per_siswa'));
            return;
        }
        if (tgt.classList.contains('btn-del-catatan')) { tgt.closest('.pai-anekdot-row')?.remove(); return; }
    });
}

function collectBodyInstrumen(container, teknik, instrumen) {
    if (!container || !teknik || !instrumen) return null;
    const data = {};

    function getSiswaOfPicker(pickerEl) {
        return Array.from(pickerEl?.querySelectorAll('.pai-sw-chip') ?? []).map(c => c.dataset.sid).filter(Boolean);
    }

    if (teknik === 'OBSERVASI') {
        if (instrumen === 'Lembar Observasi') {
            data.aspeks = Array.from(container.querySelectorAll('.pai-obs-aspek')).map(a => {
                const pickers = a.querySelectorAll('.pai-sw-picker');
                return {
                    nama:           a.querySelector('.obs-aspek-nama')?.value.trim() || '',
                    indikator:      a.querySelector('.obs-indikator')?.value.trim()  || null,
                    terlihat_jelas: getSiswaOfPicker(pickers[0]),
                    terlihat:       getSiswaOfPicker(pickers[1]),
                    belum_terlihat: getSiswaOfPicker(pickers[2]),
                };
            });
        } else if (instrumen === 'Catatan Anekdot') {
            const mode = container.querySelector('#pai-anekdot-mode')?.value || 'per_siswa';
            data.mode = mode;
            data.catatan = Array.from(container.querySelectorAll('.pai-anekdot-row')).map(r => ({
                siswa: mode === 'per_siswa'
                    ? (r.querySelector('.anekdot-siswa-sel')?.value || null)
                    : getSiswaOfPicker(r.querySelector('.pai-sw-picker')),
                deskripsi:    r.querySelector('.anekdot-deskripsi')?.value.trim()    || '',
                interpretasi: r.querySelector('.anekdot-interpretasi')?.value.trim() || null,
            }));
        } else if (instrumen === 'Checklist') {
            data.items = Array.from(container.querySelectorAll('.pai-item-row')).map(r => ({
                nama:  r.querySelector('.item-nama')?.value.trim() || '',
                siswa: getSiswaOfPicker(r.querySelector('.pai-sw-picker')),
            }));
        }
    } else if (teknik === 'TES') {
        const labels = ['Menjawab dengan baik', 'Menjawab sebagian', 'Belum bisa menjawab'];
        data.deskriptor = Array.from(container.querySelectorAll('.pai-tl-dsk-block')).map((b, i) => ({
            label: labels[i] ?? '',
            siswa: getSiswaOfPicker(b.querySelector('.pai-sw-picker')),
        }));
    } else if (teknik === 'TES_LISAN') {
        data.topik = container.querySelector('#pai-tl-topik')?.value.trim() || null;
        if (instrumen === 'Wawancara') {
            const labels = ['Menjawab dengan baik', 'Menjawab sebagian', 'Belum bisa menjawab'];
            data.deskriptor = Array.from(container.querySelectorAll('.pai-tl-dsk-block')).map((b, i) => ({
                label: labels[i] ?? '',
                siswa: getSiswaOfPicker(b.querySelector('.pai-sw-picker')),
            }));
        } else {
            data.predikat = PREDIKAT_RUBRIK.map((p, i) => ({
                val:      p.val,
                label:    p.lbl,
                deskripsi: container.querySelector('.tl-pred-desk-' + p.val)?.value.trim() || null,
                siswa:    getSiswaOfPicker(Array.from(container.querySelectorAll('.pai-tl-pred-block .pai-sw-picker'))[i]),
            }));
        }
    } else if (['PENUGASAN', 'PROYEK', 'PORTOFOLIO', 'UNJUK_KERJA'].includes(teknik)) {
        data.konteks1 = container.querySelector('#pai-konteks-1')?.value.trim() || null;
        data.konteks2 = container.querySelector('#pai-konteks-2')?.value.trim() || null;
        if (instrumen === 'Rubrik') {
            data.aspeks = Array.from(container.querySelectorAll('.pai-aspek-row')).map(a => ({
                nama: a.querySelector('.aspek-nama')?.value.trim() || '',
                predikat: PREDIKAT_RUBRIK.map((p, i) => ({
                    val:      p.val,
                    label:    p.lbl,
                    deskripsi: a.querySelector('.predikat-desk-' + p.val)?.value.trim() || null,
                    siswa:    getSiswaOfPicker(a.querySelectorAll('.pai-sw-picker')[i]),
                })),
            }));
        } else if (instrumen === 'Checklist') {
            data.items = Array.from(container.querySelectorAll('.pai-item-row')).map(r => ({
                nama:  r.querySelector('.item-nama')?.value.trim() || '',
                siswa: getSiswaOfPicker(r.querySelector('.pai-sw-picker')),
            }));
        }
    }

    return Object.keys(data).length ? data : null;
}

function prefillBodyInstrumen(container, konten, teknik, instrumen) {
    if (!container || !konten || !teknik || !instrumen) return;

    function fillPicker(pickerEl, sids) {
        if (!pickerEl || !Array.isArray(sids)) return;
        const chips = pickerEl.querySelector('.pai-sw-chips');
        const sel   = pickerEl.querySelector('.pai-sw-sel');
        if (!chips) return;
        for (const sid of sids) {
            const stu = _rosterCache.find(r => r.id === sid);
            if (!stu) continue;
            if (chips.querySelector('.pai-sw-chip[data-sid="' + sid + '"]')) continue;
            chips.insertAdjacentHTML('beforeend', chipSiswaHtml(sid, stu.nama));
            if (sel) { const opt = sel.querySelector('option[value="' + sid + '"]'); if (opt) opt.style.display = 'none'; }
        }
    }

    if (teknik === 'OBSERVASI') {
        if (instrumen === 'Lembar Observasi' && Array.isArray(konten.aspeks)) {
            const aspekEls = container.querySelectorAll('.pai-obs-aspek');
            konten.aspeks.forEach((a, i) => {
                const el = aspekEls[i]; if (!el) return;
                const nameIn = el.querySelector('.obs-aspek-nama'); if (nameIn) nameIn.value = a.nama || '';
                const indIn  = el.querySelector('.obs-indikator');  if (indIn)  indIn.value  = a.indikator || '';
                const pickers = el.querySelectorAll('.pai-sw-picker');
                fillPicker(pickers[0], a.terlihat_jelas);
                fillPicker(pickers[1], a.terlihat);
                fillPicker(pickers[2], a.belum_terlihat);
            });
        } else if (instrumen === 'Catatan Anekdot') {
            const modeEl = container.querySelector('#pai-anekdot-mode');
            if (modeEl && konten.mode) modeEl.value = konten.mode;
            const modePerSiswa = (konten.mode || 'per_siswa') === 'per_siswa';
            if (Array.isArray(konten.catatan) && konten.catatan.length > 0) {
                const rowsDiv = container.querySelector('#pai-anekdot-rows');
                if (rowsDiv) {
                    rowsDiv.innerHTML = konten.catatan.map((_, i) => anekdotCatatanHtml(i, modePerSiswa)).join('');
                    konten.catatan.forEach((c, i) => {
                        const row = rowsDiv.querySelectorAll('.pai-anekdot-row')[i]; if (!row) return;
                        const deskEl  = row.querySelector('.anekdot-deskripsi');    if (deskEl)  deskEl.value  = c.deskripsi    || '';
                        const interEl = row.querySelector('.anekdot-interpretasi'); if (interEl) interEl.value = c.interpretasi || '';
                        if (modePerSiswa) { const siswaEl = row.querySelector('.anekdot-siswa-sel'); if (siswaEl && c.siswa) siswaEl.value = c.siswa; }
                        else fillPicker(row.querySelector('.pai-sw-picker'), c.siswa);
                    });
                }
            }
        } else if (instrumen === 'Checklist' && Array.isArray(konten.items)) {
            const itemsDiv = container.querySelector('#pai-cl-items');
            if (itemsDiv) {
                itemsDiv.innerHTML = konten.items.map((_, i) => checklistItemHtml(i)).join('');
                konten.items.forEach((it, i) => {
                    const row = itemsDiv.querySelectorAll('.pai-item-row')[i]; if (!row) return;
                    const namaEl = row.querySelector('.item-nama'); if (namaEl) namaEl.value = it.nama || '';
                    fillPicker(row.querySelector('.pai-sw-picker'), it.siswa);
                });
            }
        }
    } else if (teknik === 'TES' && Array.isArray(konten.deskriptor)) {
        const blocks = container.querySelectorAll('.pai-tl-dsk-block');
        konten.deskriptor.forEach((d, i) => { fillPicker(blocks[i]?.querySelector('.pai-sw-picker'), d.siswa); });
    } else if (teknik === 'TES_LISAN') {
        const topikEl = container.querySelector('#pai-tl-topik');
        if (topikEl && konten.topik) topikEl.value = konten.topik;
        if (instrumen === 'Wawancara' && Array.isArray(konten.deskriptor)) {
            const blocks = container.querySelectorAll('.pai-tl-dsk-block');
            konten.deskriptor.forEach((d, i) => { fillPicker(blocks[i]?.querySelector('.pai-sw-picker'), d.siswa); });
        } else if (Array.isArray(konten.predikat)) {
            const predPickers = Array.from(container.querySelectorAll('.pai-tl-pred-block .pai-sw-picker'));
            konten.predikat.forEach((p, i) => {
                const deskEl = container.querySelector('.tl-pred-desk-' + p.val);
                if (deskEl) deskEl.value = p.deskripsi || '';
                fillPicker(predPickers[i], p.siswa);
            });
        }
    } else if (['PENUGASAN', 'PROYEK', 'PORTOFOLIO', 'UNJUK_KERJA'].includes(teknik)) {
        const k1 = container.querySelector('#pai-konteks-1'); if (k1 && konten.konteks1) k1.value = konten.konteks1;
        const k2 = container.querySelector('#pai-konteks-2'); if (k2 && konten.konteks2) k2.value = konten.konteks2;
        if (instrumen === 'Rubrik' && Array.isArray(konten.aspeks)) {
            const aspeksDiv = container.querySelector('#pai-rubrik-aspeks');
            if (aspeksDiv) {
                aspeksDiv.innerHTML = konten.aspeks.map((_, i) => aspekRowHtml(i)).join('');
                konten.aspeks.forEach((a, i) => {
                    const row = aspeksDiv.querySelectorAll('.pai-aspek-row')[i]; if (!row) return;
                    const namaEl = row.querySelector('.aspek-nama'); if (namaEl) namaEl.value = a.nama || '';
                    const pickers = row.querySelectorAll('.pai-sw-picker');
                    (a.predikat || []).forEach((p, j) => {
                        const deskEl = row.querySelector('.predikat-desk-' + p.val);
                        if (deskEl) deskEl.value = p.deskripsi || '';
                        fillPicker(pickers[j], p.siswa);
                    });
                });
            }
        } else if (instrumen === 'Checklist' && Array.isArray(konten.items)) {
            const itemsDiv = container.querySelector('#pai-cl-items');
            if (itemsDiv) {
                itemsDiv.innerHTML = konten.items.map((_, i) => checklistItemHtml(i)).join('');
                konten.items.forEach((it, i) => {
                    const row = itemsDiv.querySelectorAll('.pai-item-row')[i]; if (!row) return;
                    const namaEl = row.querySelector('.item-nama'); if (namaEl) namaEl.value = it.nama || '';
                    fillPicker(row.querySelector('.pai-sw-picker'), it.siswa);
                });
            }
        }
    }
}

// ── SUMATIF: full-name button list + single-student detail panel ──────────────

function nilaiTengah(pred, rent) {
    const r = rent?.[pred];
    if (!r) return null;
    return Math.round((r[0] + r[1]) / 2);
}

function kktpStatText(nilai, rent) {
    if (nilai == null || !rent) return '';
    // Iterasi SB→BB; return pertama di mana nilai >= batas_bawah (eksklusif atas)
    for (const p of ['SB', 'BSH', 'MB', 'BB']) {
        const r = rent[p];
        if (r && nilai >= r[0]) return p;
    }
    return '';
}

function flushSumActive() {
    if (!_sumActiveSid || !_sumSiswaContainer) return;
    const c = _sumSiswaContainer;
    const isTes = c.dataset.teknik === 'TES' || !c.dataset.teknik;
    if (isTes) {
        const nilaiEl = c.querySelector('#sum-nilai-inp');
        const tlEl    = c.querySelector('#sum-tl-chips');
        const raw = nilaiEl?.value;
        const n = raw !== '' && raw != null ? parseFloat(raw) : null;
        _sumNilai[_sumActiveSid] = { nilai: isNaN(n) ? null : n, tl: tlEl ? _chipVal(tlEl) : null };
    } else {
        const predEl  = c.querySelector('#sum-pred-chips');
        const tlEl    = c.querySelector('#sum-tl-chips');
        const selPred = predEl ? _chipVal(predEl) : null;
        const rent    = _sumCurrentRentang();
        const autoN   = selPred && rent ? nilaiTengah(selPred, rent) : null;
        _sumNilai[_sumActiveSid] = { predikat: selPred, nilai: autoN, tl: tlEl ? _chipVal(tlEl) : null };
    }
}

function _chipVal(el) {
    return el?.querySelector('.sum-chip-active')?.dataset.val || null;
}

function _sumCurrentRentang() {
    const kktpItems = _allKktp || [];
    return kktpItems[0]?.rentang || DEFAULT_RENTANG;
}

let _allKktp = [];  // set by openAsmtModal

function renderSumInput() {
    const c = _sumSiswaContainer;
    if (!c) return;
    const inputEl = c.querySelector('#sum-input-panel');
    if (!inputEl) return;
    if (!_sumActiveSid) { inputEl.style.display = 'none'; return; }
    const stu   = _sumSiswaList.find(r => r.id === _sumActiveSid);
    const vals  = _sumNilai[_sumActiveSid] ?? {};
    const isTes = c.dataset.teknik === 'TES' || !c.dataset.teknik;
    const rent  = _sumCurrentRentang();

    const chipBtnCss = (val, active) =>
        'padding:4px 12px;border-radius:1rem;font-size:12px;cursor:pointer;border:1.5px solid ' +
        (active ? 'var(--color-primary)' : 'var(--color-border)') + ';' +
        'background:' + (active ? 'var(--color-primary)' : 'transparent') + ';' +
        'color:' + (active ? '#fff' : 'var(--color-text)') + ';';

    let valorHtml;
    if (isTes) {
        const kktpStr = kktpStatText(vals.nilai, rent);
        valorHtml =
            '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">' +
            '<input type="number" id="sum-nilai-inp" min="0" max="100" step="0.5" placeholder="Nilai 0–100" ' +
            'value="' + (vals.nilai != null ? String(vals.nilai) : '') + '" ' +
            'style="width:100px;padding:6px 8px;border:1px solid var(--color-border);border-radius:4px;background:var(--color-bg);color:var(--color-text);font-size:13px">' +
            '<span id="sum-kktp-txt" style="font-size:12px;color:var(--color-text-muted)">' + esc(kktpStr) + '</span>' +
            '</div>';
    } else {
        const selPred = vals.predikat ?? null;
        const autoN   = selPred && rent ? nilaiTengah(selPred, rent) : null;
        const kktpStr = autoN != null ? kktpStatText(autoN, rent) : '';
        valorHtml =
            '<div style="margin-bottom:8px">' +
            '<div style="font-size:11px;color:var(--color-text-muted);margin-bottom:4px">Predikat:</div>' +
            '<div id="sum-pred-chips" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px">' +
            PREDIKAT_ORDER.map(p => (
                '<button type="button" class="sum-pred-chip' + (selPred === p ? ' sum-chip-active' : '') + '" data-val="' + p + '" ' +
                'style="' + chipBtnCss(p, selPred === p) + '">' + esc(p) + '</button>'
            )).join('') +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:6px;font-size:12px">' +
            '<span style="color:var(--color-text-muted)">Nilai:</span>' +
            '<strong id="sum-pred-nilai">' + (autoN != null ? autoN : '—') + '</strong>' +
            '<span id="sum-kktp-txt" style="color:var(--color-text-muted)">' + esc(kktpStr) + '</span>' +
            '</div></div>';
    }

    const tlHtml =
        '<div><div style="font-size:11px;color:var(--color-text-muted);margin-bottom:4px">Tindak lanjut:</div>' +
        '<div id="sum-tl-chips" style="display:flex;flex-wrap:wrap;gap:6px">' +
        [['PENGAYAAN','Pengayaan'],['PENGUATAN','Penguatan'],['PENDAMPINGAN','Pendampingan']].map(([v, l]) => (
            '<button type="button" class="sum-tl-chip' + (vals.tl === v ? ' sum-chip-active' : '') + '" data-val="' + v + '" ' +
            'style="' + chipBtnCss(v, vals.tl === v) + '">' + esc(l) + '</button>'
        )).join('') +
        '</div></div>';

    inputEl.innerHTML =
        '<div style="font-size:13px;font-weight:600;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--color-border)">' + esc(stu?.nama ?? '') + '</div>' +
        valorHtml + tlHtml;
    inputEl.style.display = '';

    // Wire nilai input → auto KKTP text
    if (isTes) {
        inputEl.querySelector('#sum-nilai-inp')?.addEventListener('input', function () {
            const n = this.value === '' ? null : parseFloat(this.value);
            const kEl = inputEl.querySelector('#sum-kktp-txt');
            if (kEl) kEl.textContent = kktpStatText(n, rent);
        });
    } else {
        // Wire predikat chips
        inputEl.querySelectorAll('.sum-pred-chip').forEach(btn => {
            btn.addEventListener('click', () => {
                const val = btn.dataset.val;
                const wasActive = btn.classList.contains('sum-chip-active');
                inputEl.querySelectorAll('.sum-pred-chip').forEach(b => {
                    b.classList.remove('sum-chip-active');
                    b.style.cssText = chipBtnCss(b.dataset.val, false);
                });
                if (!wasActive) {
                    btn.classList.add('sum-chip-active');
                    btn.style.cssText = chipBtnCss(val, true);
                    const autoN2 = nilaiTengah(val, rent);
                    const nilaiEl = inputEl.querySelector('#sum-pred-nilai');
                    const kEl     = inputEl.querySelector('#sum-kktp-txt');
                    if (nilaiEl) nilaiEl.textContent = autoN2 != null ? String(autoN2) : '—';
                    if (kEl) kEl.textContent = autoN2 != null ? kktpStatText(autoN2, rent) : '';
                }
            });
        });
    }

    // Wire tindak lanjut chips
    inputEl.querySelectorAll('.sum-tl-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            const val = btn.dataset.val;
            const wasActive = btn.classList.contains('sum-chip-active');
            inputEl.querySelectorAll('.sum-tl-chip').forEach(b => {
                b.classList.remove('sum-chip-active');
                b.style.cssText = chipBtnCss(b.dataset.val, false);
            });
            if (!wasActive) {
                btn.classList.add('sum-chip-active');
                btn.style.cssText = chipBtnCss(val, true);
            }
        });
    });
}

const SUM_PAGE_SIZE = 8;

function renderSumPage(container) {
    const names  = container.querySelector('#sum-names-wrap');
    const nav    = container.querySelector('#sum-nav');
    const dots   = container.querySelector('#sum-dots');
    if (!names) return;
    const total = _sumSiswaList.length;
    const pages = Math.ceil(total / SUM_PAGE_SIZE) || 1;
    _sumPage = Math.max(0, Math.min(_sumPage, pages - 1));
    const slice = _sumSiswaList.slice(_sumPage * SUM_PAGE_SIZE, (_sumPage + 1) * SUM_PAGE_SIZE);

    names.innerHTML = slice.map(s => {
        const isAct  = s.id === _sumActiveSid;
        const hasVal = _sumNilai[s.id]?.nilai != null || _sumNilai[s.id]?.predikat != null;
        return '<button type="button" data-sum-sid="' + esc(s.id) + '" ' +
            'style="padding:4px 12px;border-radius:1rem;font-size:12px;cursor:pointer;' +
            'border:1.5px solid ' + (isAct ? 'var(--color-primary)' : hasVal ? 'rgba(128,128,128,.5)' : 'var(--color-border)') + ';' +
            'background:' + (isAct ? 'var(--color-primary)' : 'transparent') + ';' +
            'color:' + (isAct ? '#fff' : hasVal ? 'var(--color-text)' : 'var(--color-text-muted)') + '">' +
            esc(s.nama) + (hasVal ? ' ✓' : '') + '</button>';
    }).join('');

    names.querySelectorAll('[data-sum-sid]').forEach(btn => {
        btn.addEventListener('click', () => {
            flushSumActive();
            _sumActiveSid = btn.dataset.sumSid;
            renderSumPage(container);
        });
    });

    if (pages > 1) {
        nav.style.display = 'flex';
        const prevBtn = nav.querySelector('#sum-prev');
        const nextBtn = nav.querySelector('#sum-next');
        const pageLbl = nav.querySelector('#sum-page-lbl');
        if (prevBtn) prevBtn.disabled = _sumPage === 0;
        if (nextBtn) nextBtn.disabled = _sumPage === pages - 1;
        if (pageLbl) pageLbl.textContent = 'halaman ' + (_sumPage + 1) + '/' + pages;
    } else {
        nav.style.display = 'none';
    }

    if (dots) {
        dots.innerHTML = pages > 1
            ? Array.from({ length: pages }, (_, i) =>
                '<span style="width:6px;height:6px;border-radius:50%;display:inline-block;' +
                'background:' + (i === _sumPage ? 'var(--color-primary)' : 'var(--color-border)') + '"></span>'
              ).join('')
            : '';
    }

    if (_sumActiveSid && !slice.some(s => s.id === _sumActiveSid)) _sumActiveSid = null;
    renderSumInput();
}

async function openAsmtModal(editAsmt) {
    await ensureUser();
    const roster = _rosterCache;

    // for edit: load existing SUMATIF results
    let existingSumResults = {};
    if (editAsmt?.jenis === 'SUMATIF') {
        const rows = await getAssessmentResults(editAsmt.id);
        rows.forEach(r => { existingSumResults[r.student_id] = r; });
    }

    const initJenis     = editAsmt?.jenis     || 'DIAGNOSTIK_NK';
    const initTeknik    = editAsmt?.teknik    || 'OBSERVASI';
    const initInstrumen = editAsmt?.instrumen || (INSTRUMEN_MAP.OBSERVASI[0]);

    if (!_tpCache.length && ctxOk()) {
        try { _tpCache = await getTps(_kelasId, _subjectId, _year, Number(_semester)); } catch {}
    }

    _allKktp = [];
    for (const tp of _tpCache) {
        try { const k = await getKktps(tp.id); _allKktp.push(...k); } catch {}
    }

    const tpOpts = [{ id: '', kode_tp: '— TP (Opsional) —' }, ..._tpCache].map(t => (
        '<option value="' + esc(t.id) + '"' + (editAsmt?.learning_objective_id === t.id ? ' selected' : '') + '>' + esc(t.kode_tp) + '</option>'
    )).join('');

    const jenisOpts  = JENIS_LIST.map(j => '<option value="' + j + '"' + (initJenis === j ? ' selected' : '') + '>' + (JENIS_LABEL[j] ?? j) + '</option>').join('');
    const teknikOpts = TEKNIK_LIST.map(t => '<option value="' + t + '"' + (initTeknik === t ? ' selected' : '') + '>' + t.replace(/_/g, ' ') + '</option>').join('');
    const instrOpts  = (INSTRUMEN_MAP[initTeknik] || []).map(i => '<option value="' + i + '"' + (initInstrumen === i ? ' selected' : '') + '>' + i + '</option>').join('');

    const SUM_HTML =
        '<div id="sum-names-wrap" class="sum-names-wrap"></div>' +
        '<div id="sum-nav" class="sum-nav" style="display:none">' +
        '<button type="button" id="sum-prev" class="pen-btn pen-btn-sm">‹ Prev</button>' +
        '<span id="sum-page-lbl" style="font-size:12px;flex:1;text-align:center"></span>' +
        '<button type="button" id="sum-next" class="pen-btn pen-btn-sm">Next ›</button>' +
        '</div>' +
        '<div id="sum-dots" class="sum-dots" style="justify-content:center;margin-bottom:6px"></div>' +
        '<div id="sum-input-panel" class="sum-input-panel" style="display:none;border-top:1px solid var(--color-border);padding-top:10px;margin-top:4px"></div>';

    const today = new Date().toISOString().split('T')[0];

    const bodyHtml =
        '<label class="field-label">Tanggal *</label>' +
        '<input type="date" id="pai-tanggal" class="input" required value="' + esc(editAsmt?.tanggal ?? today) + '" style="width:100%;margin-bottom:12px;">' +
        '<label>Tujuan Pembelajaran (opsional)</label>' +
        '<select id="pai-tp-sel">' + tpOpts + '</select>' +
        '<label>Jenis <span style="color:var(--color-danger)">*</span></label>' +
        '<select id="pai-jenis-sel">' + jenisOpts + '</select>' +
        '<label>Teknik <span style="color:var(--color-danger)">*</span></label>' +
        '<select id="pai-teknik-sel">' + teknikOpts + '</select>' +
        '<label>Instrumen <span style="color:var(--color-danger)">*</span></label>' +
        '<select id="pai-instrumen-sel">' + instrOpts + '</select>' +
        '<label>Tujuan / Keterangan</label>' +
        '<textarea id="pai-tujuan" rows="2" maxlength="500" placeholder="Tujuan penilaian ini…">' + esc(editAsmt?.tujuan || '') + '</textarea>' +
        '<hr style="margin:12px 0;border:none;border-top:1px solid var(--color-border)">' +
        '<div id="pai-instrumen-body"' + (initJenis === 'SUMATIF' ? ' style="display:none"' : '') + '></div>' +
        '<div id="pai-siswa-section" style="margin-top:10px">' + (initJenis === 'SUMATIF' ? SUM_HTML : '') + '</div>' +
        '<hr style="margin:12px 0;border:none;border-top:1px solid var(--color-border)">' +
        '<label>Refleksi Guru</label>' +
        '<textarea id="pai-refleksi" rows="2" maxlength="500" placeholder="Refleksi setelah pelaksanaan…">' + esc(editAsmt?.refleksi_guru || '') + '</textarea>' +
        '<div style="display:flex;gap:16px;margin-top:8px">' +
        '<label style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:normal;color:var(--color-text)"><input type="checkbox" id="pai-vis-siswa"' + (editAsmt?.is_visible_siswa ? ' checked' : '') + '> Tampilkan ke Siswa</label>' +
        '<label style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:normal;color:var(--color-text)"><input type="checkbox" id="pai-vis-ortu"' + (editAsmt?.is_visible_ortu ? ' checked' : '') + '> Tampilkan ke Orang Tua</label>' +
        '</div>';

    openModal({ title: editAsmt ? 'Edit Penilaian' : 'Tambah Penilaian', bodyHtml, wide: true,
        onSave: async (_ov, close) => {
            const jenis     = _ov.querySelector('#pai-jenis-sel').value;
            const teknik    = _ov.querySelector('#pai-teknik-sel').value;
            const instrumen = _ov.querySelector('#pai-instrumen-sel').value;
            const tpId      = _ov.querySelector('#pai-tp-sel').value || null;
            const tujuan    = _ov.querySelector('#pai-tujuan').value.trim();
            const refleksi  = _ov.querySelector('#pai-refleksi').value.trim();
            const visS = _ov.querySelector('#pai-vis-siswa').checked;
            const visO = _ov.querySelector('#pai-vis-ortu').checked;

            const tanggal   = _ov.querySelector('#pai-tanggal').value || null;

            const instrBody = _ov.querySelector('#pai-instrumen-body');
            const konten = jenis === 'SUMATIF'
                ? null
                : collectBodyInstrumen(instrBody, teknik, instrumen);

            const payload = {
                jenis, teknik, instrumen, tujuan: tujuan || null,
                konten, refleksi_guru: refleksi || null,
                is_visible_siswa: visS, is_visible_ortu: visO,
                learning_objective_id: tpId,
                tanggal,
            };

            let asmtId;
            if (editAsmt) {
                await updateAssessment(editAsmt.id, payload);
                asmtId = editAsmt.id;
            } else {
                const created = await createAssessment(
                    _schoolId, _kelasId, _subjectId, _year, Number(_semester), _teacherId, payload);
                asmtId = created.id;
            }

            if (jenis === 'SUMATIF') {
                flushSumActive();
                for (const [sid, data] of Object.entries(_sumNilai)) {
                    if (data.nilai != null || data.predikat) {
                        await upsertAssessmentResult(_schoolId, _kelasId, asmtId, sid, {
                            nilai: data.nilai ?? null,
                            status: data.predikat ?? null,
                            tindak_lanjut: data.tl ?? null,
                        });
                    }
                }
            }
            // non-SUMATIF: data siswa tersimpan dalam konten JSONB di assessment (instrumen-centric)

            close();
            await renderPelaksanaan();
        }
    });

    const modal = document.querySelector('.pen-modal');
    if (!modal) return;
    const jenisSel  = modal.querySelector('#pai-jenis-sel');
    const teknikSel = modal.querySelector('#pai-teknik-sel');
    const instrSel  = modal.querySelector('#pai-instrumen-sel');
    const instrBody = modal.querySelector('#pai-instrumen-body');
    const siswaSec  = modal.querySelector('#pai-siswa-section');

    const _isSum = () => jenisSel.value === 'SUMATIF';

    function rebuildInstrBody() {
        if (_isSum()) {
            instrBody.style.display = 'none';
            instrBody.innerHTML = '';
            return;
        }
        instrBody.style.display = '';
        renderBodyInstrumen(teknikSel.value, instrSel.value, instrBody);
        wireBodyInstrumen(instrBody);
        if (editAsmt && editAsmt.teknik === teknikSel.value && editAsmt.instrumen === instrSel.value) {
            prefillBodyInstrumen(instrBody, editAsmt.konten, teknikSel.value, instrSel.value);
        }
    }

    function rebuildSiswaSection() {
        const j   = jenisSel.value;
        const isS = j === 'SUMATIF';
        _sumPage = 0; _sumNilai = {}; _sumSiswaList = roster; _sumActiveSid = null;
        siswaSec.innerHTML = isS ? SUM_HTML : '';
        if (isS) {
            _sumSiswaContainer = siswaSec;
            siswaSec.dataset.teknik = teknikSel.value;
            wireSumNav(siswaSec);
            renderSumPage(siswaSec);
        } else {
            _sumSiswaContainer = null;
        }
        rebuildInstrBody();
    }

    function wireSumNav(container) {
        container.querySelector('#sum-prev')?.addEventListener('click', () => {
            flushSumActive(); _sumPage--; renderSumPage(container);
        });
        container.querySelector('#sum-next')?.addEventListener('click', () => {
            flushSumActive(); _sumPage++; renderSumPage(container);
        });
    }

    teknikSel.addEventListener('change', () => {
        const instrs = INSTRUMEN_MAP[teknikSel.value] || [];
        instrSel.innerHTML = instrs.map(i => '<option value="' + i + '">' + i + '</option>').join('');
        if (_sumSiswaContainer) _sumSiswaContainer.dataset.teknik = teknikSel.value;
        rebuildInstrBody();
    });
    instrSel.addEventListener('change', rebuildInstrBody);
    jenisSel.addEventListener('change', rebuildSiswaSection);

    rebuildInstrBody();

    if (initJenis === 'SUMATIF') {
        _sumSiswaList = roster; _sumPage = 0; _sumActiveSid = null;
        // prefill from existing results
        _sumNilai = {};
        for (const [sid, r] of Object.entries(existingSumResults)) {
            _sumNilai[sid] = { nilai: r.nilai ?? null, predikat: r.status ?? null, tl: r.tindak_lanjut ?? null };
        }
        _sumSiswaContainer = siswaSec;
        siswaSec.dataset.teknik = initTeknik;
        wireSumNav(siswaSec);
        renderSumPage(siswaSec);
    } else {
        _sumSiswaContainer = null;
        _sumNilai = {};
    }
}

function asmtRowHtml(a) {
    const JENIS_SHORT = { DIAGNOSTIK_NK: 'D-NK', DIAGNOSTIK_K: 'D-K', FORMATIF: 'F', SUMATIF: 'S' };
    const jLetter  = JENIS_SHORT[a.jenis] ?? a.jenis?.[0] ?? 'D';
    const badgeCls = 'pen-asmt-badge pen-asmt-badge-' + jLetter;
    return (
        '<div class="pen-asmt-row" data-asmt-id="' + esc(a.id) + '">' +
        '<div class="pen-asmt-head">' +
        '<span class="' + badgeCls + '">' + esc(a.jenis) + '</span>' +
        '<span style="flex:1">' + esc(a.teknik?.replace(/_/g, ' ') || '') + ' — ' + esc(a.instrumen || '') + '</span>' +
        '<div class="pen-item-actions">' +
        '<button class="pen-btn pen-btn-sm" data-action="asmt-edit" data-id="' + esc(a.id) + '">Edit</button>' +
        '<button class="pen-btn pen-btn-sm pen-btn-danger" data-action="asmt-delete" data-id="' + esc(a.id) + '">Hapus</button>' +
        '</div></div>' +
        (a.tujuan ? '<div class="pen-asmt-meta">' + esc(a.tujuan) + '</div>' : '') +
        '</div>'
    );
}

async function renderPelaksanaan() {
    const body = document.getElementById('pen-pelaksanaan-body');
    if (!body) return;
    if (!ctxOk()) {
        body.innerHTML = '<p class="pen-placeholder">Pilih kelas, mapel, tahun, dan semester.</p>';
        return;
    }

    body.innerHTML = '<p class="pen-placeholder">Memuat penilaian…</p>';

    try {
        await ensureUser();  // populates _schoolId before any query
        const [asmts, roster, sGroups] = await Promise.all([
            getAssessments(_schoolId, _kelasId, _subjectId, _year, Number(_semester)),
            getStudentsForClass(_kelasId),
            getStudentGroups(_schoolId, _kelasId),
        ]);
        _asmtCache   = asmts;
        _rosterCache = roster;
        _sGroupsCache = Object.fromEntries(sGroups.map(g => [g.student_id, g.grup]));

        body.innerHTML =
            '<div class="pen-add-row" style="margin-bottom:10px">' +
            '<button class="pen-btn pen-btn-primary" data-action="asmt-add">+ Tambah Penilaian</button>' +
            '</div>' +
            (asmts.length ? asmts.map(asmtRowHtml).join('') : '<p class="pen-placeholder">Belum ada entri penilaian.</p>');
    } catch (err) {
        body.innerHTML = '<p class="pen-placeholder" style="color:var(--color-danger)">Gagal memuat penilaian: ' + esc(err.message) + '</p>';
    }
}

function confirmDeleteAsmt(asmtId, origBtn) {
    origBtn.style.display = 'none';
    const row = origBtn.closest('.pen-asmt-row');
    const bar = document.createElement('div');
    bar.className = 'pen-del-bar';
    bar.innerHTML = '<span style="flex:1;font-size:12px">Hapus penilaian ini beserta semua hasilnya?</span>' +
        '<button class="pen-btn pen-btn-sm pen-btn-danger pen-del-yes">Ya, Hapus</button>' +
        '<button class="pen-btn pen-btn-sm pen-del-no">Tidak</button>';
    row.appendChild(bar);
    bar.querySelector('.pen-del-yes').addEventListener('click', async function () {
        this.disabled = true; this.textContent = 'Menghapus…';
        try { await deleteAssessment(asmtId); await renderPelaksanaan(); }
        catch (err) { bar.remove(); origBtn.style.display = ''; alert('Gagal hapus: ' + err.message); }
    });
    bar.querySelector('.pen-del-no').addEventListener('click', () => { bar.remove(); origBtn.style.display = ''; });
}

// ── Section 3: Rekap Nilai ────────────────────────────────────────────────────

async function renderRecap() {
    const body = document.getElementById('pen-rekap-body');
    if (!body) return;
    if (!ctxOk()) { body.innerHTML = '<p class="pen-placeholder">Pilih kelas, mapel, tahun, dan semester.</p>'; return; }

    _rcPage = 0;  // reset halaman saat rekap dibuka ulang (ganti kelas/mapel/tahun)
    body.innerHTML = '<p class="pen-placeholder">Memuat rekap…</p>';
    await _renderRecapContent(body);
}

function extractLabelSiswa(konten, teknik, instrumen) {
    // Membaca konten JSONB assessment non-SUMATIF (instrumen-centric:
    // tiap kategori memuat array student_id) dan membaliknya jadi
    // peta { student_id: label } — kategori tertinggi yang dicapai siswa.
    const map = {};
    if (!konten) return map;

    const PRIO_PRED = ['SB', 'BSH', 'MB', 'BB'];
    function setByPredikat(sid, val) {
        if (!map[sid] || PRIO_PRED.indexOf(val) < PRIO_PRED.indexOf(map[sid])) map[sid] = val;
    }
    function setFirstWins(sid, label) {
        // dipakai untuk daftar yang sudah urut prioritas tinggi → rendah
        if (!map[sid]) map[sid] = label;
    }

    if (teknik === 'OBSERVASI') {
        if (instrumen === 'Lembar Observasi') {
            const PRIO  = ['terlihat_jelas', 'terlihat', 'belum_terlihat'];
            const LABEL = {
                terlihat_jelas: 'Terlihat Jelas',
                terlihat:       'Terlihat',
                belum_terlihat: 'Belum Terlihat',
            };
            (konten.aspeks || []).forEach(aspek => {
                PRIO.forEach(key => {
                    (aspek[key] || []).forEach(sid => {
                        if (!map[sid] || PRIO.indexOf(key) < PRIO.indexOf(map[sid])) map[sid] = key;
                    });
                });
            });
            Object.keys(map).forEach(sid => { map[sid] = LABEL[map[sid]] || map[sid]; });
        } else if (instrumen === 'Catatan Anekdot') {
            // mode per_siswa: catatan[].siswa = string; per_kejadian: array
            (konten.catatan || []).forEach(c => {
                const sids = Array.isArray(c.siswa) ? c.siswa : [c.siswa];
                sids.filter(Boolean).forEach(sid => { map[sid] = 'Tercatat'; });
            });
        } else if (instrumen === 'Checklist') {
            (konten.items || []).forEach(item => {
                (item.siswa || []).forEach(sid => { map[sid] = 'Tercapai'; });
            });
        }
    } else if (teknik === 'TES' || (teknik === 'TES_LISAN' && instrumen === 'Wawancara')) {
        // deskriptor[] sudah urut: 0 = tertinggi, 2 = terendah
        (konten.deskriptor || []).forEach((d, i) => {
            (d.siswa || []).forEach(sid => setFirstWins(sid, d.label || ('Deskriptor ' + (i + 1))));
        });
    } else if (teknik === 'TES_LISAN') {
        (konten.predikat || []).forEach(p => {
            (p.siswa || []).forEach(sid => setByPredikat(sid, p.val));
        });
    } else if (['PENUGASAN', 'PROYEK', 'PORTOFOLIO', 'UNJUK_KERJA'].includes(teknik)) {
        if (instrumen === 'Rubrik') {
            (konten.aspeks || []).forEach(aspek => {
                (aspek.predikat || []).forEach(p => {
                    (p.siswa || []).forEach(sid => setByPredikat(sid, p.val));
                });
            });
        } else if (instrumen === 'Checklist') {
            (konten.items || []).forEach(item => {
                (item.siswa || []).forEach(sid => { map[sid] = 'Tercapai'; });
            });
        }
    }
    return map;
}

async function _renderRecapContent(body) {
    try {
        await ensureUser();
        // load asmts and roster if not already cached (rekap bisa dibuka tanpa buka pelaksanaan dulu)
        if (!_asmtCache.length || !_rosterCache.length) {
            const [asmts, roster, sGroups] = await Promise.all([
                getAssessments(_schoolId, _kelasId, _subjectId, _year, Number(_semester)),
                getStudentsForClass(_kelasId),
                getStudentGroups(_schoolId, _kelasId),
            ]);
            _asmtCache    = asmts;
            _rosterCache  = roster;
            _sGroupsCache = Object.fromEntries(sGroups.map(g => [g.student_id, g.grup]));
        }
        // Rekap bisa dibuka tanpa lewat Perencanaan, jadi _tpCache mungkin masih kosong.
        // Tanpa ini recapTpId jatuh ke null dan guard simpan salah menuduh 'TP belum ada'.
        if (!_tpCache.length) {
            _tpCache = await getTps(_kelasId, _subjectId, _year, Number(_semester));
        }
        // Rekap sebagai proyektor: tampilkan penilaian sesuai jenis yang dipilih.
        // Nilai akhir + KKTP hanya berlaku untuk SUMATIF.
        const isSumatif = _rcJenis === 'SUMATIF';
        const filtered = _asmtCache.filter(a => a.jenis === _rcJenis
            && (!_rcTeknik   || a.teknik    === _rcTeknik)
            && (!_rcInstrumen || a.instrumen === _rcInstrumen));

        if (!filtered.length) {
            body.innerHTML =
                _rcFilterBar() +
                '<p class="pen-placeholder">Tidak ada penilaian ' + esc(JENIS_LABEL[_rcJenis] ?? _rcJenis) + (_rcTeknik ? ' (' + esc(_rcTeknik) + ')' : '') + ' untuk ditampilkan.</p>';
            _wireRcFilters(body);
            return;
        }

        // Non-SUMATIF: nilai siswa tidak ada di assessment_results — datanya
        // instrumen-centric di kolom konten JSONB. Tampilkan label kategori,
        // tanpa nilai akhir, tanpa KKTP, tanpa tombol Simpan Rekap.
        if (!isSumatif) {
            const labelMaps = {};
            filtered.forEach(a => {
                labelMaps[a.id] = extractLabelSiswa(a.konten, a.teknik, a.instrumen);
            });

            let nsTable =
                '<table class="rc-table"><thead><tr>' +
                '<th>Nama Siswa</th>' +
                filtered.map(a =>
                    '<th>' + esc(a.teknik?.replace(/_/g, ' ') || '') +
                    ' — ' + esc(a.instrumen || '') + '</th>'
                ).join('') +
                '</tr></thead><tbody>';

            for (const s of _rosterCache) {
                nsTable += '<tr><td>' + esc(s.nama) + '</td>' +
                    filtered.map(a => {
                        const lbl = labelMaps[a.id]?.[s.id];
                        return '<td>' + (lbl ? esc(lbl) : '—') + '</td>';
                    }).join('') +
                    '</tr>';
            }
            nsTable += '</tbody></table>';

            body.innerHTML = _rcFilterBar() + '<div style="overflow-x:auto">' + nsTable + '</div>';
            _wireRcFilters(body);
            return;
        }

        // load all results
        const allResults = {};
        await Promise.all(filtered.map(async a => {
            const rows = await getAssessmentResults(a.id);
            allResults[a.id] = Object.fromEntries(rows.map(r => [r.student_id, r]));
        }));

        const roster = _rosterCache;
        const hasSiswa = roster.length > 0;

        // compute final values
        const hasilSiswa = {};
        for (const s of roster) {
            const nilais = filtered.map(a => allResults[a.id]?.[s.id]?.nilai ?? null);
            let nilai = null;
            if (!isSumatif) {
                nilai = null;   // jenis non-SUMATIF tidak dihitung nilai akhirnya
            } else if (_rcMetode === 'rata') {
                const valid = nilais.filter(n => n != null);
                nilai = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
            } else if (_rcMetode === 'bobot') {
                let sum = 0, totalBobot = 0;
                filtered.forEach((a, i) => {
                    const b = parseFloat(_rcBobots[a.id] || 0);
                    if (nilais[i] != null && b > 0) { sum += nilais[i] * b; totalBobot += b; }
                });
                nilai = totalBobot > 0 ? sum / totalBobot : null;
            } else if (_rcMetode === 'terbaik') {
                const valid = nilais.filter(n => n != null);
                nilai = valid.length ? Math.max(...valid) : null;
            }
            hasilSiswa[s.id] = { nilai, nilais };
        }

        // pick TP for kktp check
        const linkedTpId = _asmtCache.find(a => a.jenis === 'SUMATIF' && a.learning_objective_id)?.learning_objective_id;
        const kktpForTp  = (isSumatif && linkedTpId) ? (await getKktps(linkedTpId)) : [];
        // TP yang dipakai sebagai anchor rekap. grade_recap.learning_objective_id NOT NULL,
        // jadi tanpa TP sama sekali rekap tidak bisa disimpan.
        const recapTpId  = linkedTpId || _tpCache[0]?.id || null;

        // Kembalikan label predikat (SB/BSH/MB/BB) sesuai rentang KKTP, atau null
        // bila nilai kosong / KKTP belum ada / nilai di luar semua rentang.
        function kktpPredikat(nilai) {
            if (nilai == null || !kktpForTp.length) return null;
            const rentang = kktpForTp[0]?.rentang;
            if (!rentang) return null;
            // Iterasi SB→BB; return pertama di mana nilai >= batas_bawah (eksklusif atas)
            for (const pred of ['SB', 'BSH', 'MB', 'BB']) {
                const range = rentang[pred];
                if (!range) continue;
                if (nilai >= range[0]) return pred;
            }
            return null;
        }

        // Paginasi: hitung slice halaman aktif; upsert simpan tetap pakai roster penuh
        const totalHal = Math.ceil(roster.length / RC_SISWA_PER_HAL);
        if (_rcPage >= totalHal) _rcPage = Math.max(0, totalHal - 1);
        const rosterHal = roster.slice(_rcPage * RC_SISWA_PER_HAL, (_rcPage + 1) * RC_SISWA_PER_HAL);

        let tableHtml =
            '<table class="rc-table"><thead><tr>' +
            '<th>Nama Siswa</th>' +
            filtered.map(a => '<th>' + esc(a.teknik?.replace(/_/g,'') || '') + ' ' + esc(a.instrumen || '') + '</th>').join('') +
            (isSumatif ? '<th>Nilai Akhir</th><th>KKTP</th>' : '') +
            (isSumatif && _rcMetode === 'bobot' ? '<th>Bobot (%)</th>' : '') +
            '</tr></thead><tbody>';

        for (const s of rosterHal) {  // hanya siswa di halaman aktif
            const h    = hasilSiswa[s.id] || {};
            const nak  = h.nilai != null ? h.nilai.toFixed(1) : '—';
            const ktTxt = kktpPredikat(h.nilai) ?? '—';
            tableHtml += '<tr>' +
                '<td>' + esc(s.nama) + '</td>' +
                (h.nilais || filtered.map(() => null)).map(n => '<td>' + (n != null ? n.toFixed(1) : '—') + '</td>').join('') +
                (isSumatif ? '<td><strong>' + nak + '</strong></td><td>' + ktTxt + '</td>' : '') +
                (isSumatif && _rcMetode === 'bobot' ? '<td></td>' : '') +
                '</tr>';
        }
        tableHtml += '</tbody></table>';

        const navHtml = totalHal > 1
            ? '<div class="rc-nav">' +
              '<button class="pen-btn pen-btn-sm" data-action="rc-prev"' + (_rcPage === 0 ? ' disabled' : '') + '>‹ Prev</button>' +
              '<span class="rc-nav-info">Halaman ' + (_rcPage + 1) + ' dari ' + totalHal + ' (' + roster.length + ' siswa)</span>' +
              '<button class="pen-btn pen-btn-sm" data-action="rc-next"' + (_rcPage >= totalHal - 1 ? ' disabled' : '') + '>Next ›</button>' +
              '</div>'
            : '';

        // bobot row
        let bobotHtml = '';
        if (isSumatif && _rcMetode === 'bobot') {
            bobotHtml = '<div style="margin:8px 0;font-size:12px"><strong>Set bobot tiap sumatif (total harus 100%):</strong><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">' +
                filtered.map(a => (
                    '<label style="display:flex;align-items:center;gap:4px;font-size:12px;font-weight:normal">' +
                    esc(a.instrumen || a.teknik) +
                    '<input type="number" class="rc-bobot-input" data-aid="' + esc(a.id) + '" min="0" max="100" value="' + esc(String(_rcBobots[a.id] || 0)) + '">' +
                    '</label>'
                )).join('') +
                '</div></div>';
        }

        body.innerHTML =
            _rcFilterBar() + bobotHtml +
            (isSumatif
                ? '<div style="display:flex;justify-content:flex-end;margin-bottom:8px">' +
                  '<button class="pen-btn pen-btn-primary" data-action="rc-simpan">Simpan Rekap</button>' +
                  '</div>'
                : '') +
            '<div style="overflow-x:auto">' + tableHtml + '</div>' +
            navHtml;

        _wireRcFilters(body);

        body.querySelector('[data-action="rc-prev"]')?.addEventListener('click', () => { _rcPage--; _renderRecapContent(body); });
        body.querySelector('[data-action="rc-next"]')?.addEventListener('click', () => { _rcPage++; _renderRecapContent(body); });

        body.querySelectorAll('.rc-bobot-input').forEach(inp => {
            inp.addEventListener('change', () => { _rcBobots[inp.dataset.aid] = parseFloat(inp.value) || 0; _renderRecapContent(body); });
        });

        body.querySelector('[data-action="rc-simpan"]')?.addEventListener('click', async () => {
            if (_nilaiSedangDisimpan) return;
            _nilaiSedangDisimpan = true;
            const btn = body.querySelector('[data-action="rc-simpan"]');
            btn.disabled = true; btn.textContent = 'Menyimpan…';
            try {
                if (!recapTpId) {
                    throw new Error('Rekap butuh Tujuan Pembelajaran. Buat TP dulu di section Perencanaan, lalu tautkan ke penilaian Sumatif.');
                }
                const rows = [];
                for (const s of roster) {  // iterate semua siswa, bukan hanya halaman aktif
                    const h = hasilSiswa[s.id] || {};
                    if (h.nilai == null) continue;
                    // Tercapai bila predikat BSH ke atas; MB dan BB = belum tercapai;
                    // null bila KKTP belum ada sehingga tidak bisa dinilai.
                    const pred = kktpPredikat(h.nilai);
                    rows.push({ studentId: s.id, payload: {
                        nilai_akhir: h.nilai,
                        kktp_tercapai: pred != null ? (pred === 'BSH' || pred === 'SB') : null,
                        deskripsi_capaian: null,
                    } });
                }
                await upsertGradeRecapBatch(_schoolId, _kelasId, recapTpId,
                    Number(_semester), _year, rows);
                toast('Rekap berhasil disimpan');
            } catch (err) {
                toast('Gagal simpan: ' + (err.message || 'Terjadi kesalahan'), false);
            } finally {
                _nilaiSedangDisimpan = false;
                btn.disabled = false; btn.textContent = 'Simpan Rekap';
            }
        });
    } catch (err) {
        body.innerHTML = _rcFilterBar() + '<p class="pen-placeholder" style="color:var(--color-danger)">Gagal memuat rekap: ' + esc(err.message) + '</p>';
        _wireRcFilters(body);
    }
}

function _rcFilterBar() {
    const jenisOpts = JENIS_LIST.map(v =>
        '<option value="' + v + '"' + (_rcJenis === v ? ' selected' : '') + '>' + esc(JENIS_LABEL[v] ?? v) + '</option>').join('');
    const metodeOpts = [['rata','Rata-rata'],['bobot','Bobot'],['terbaik','Nilai Terbaik']].map(([v, l]) =>
        '<option value="' + v + '"' + (_rcMetode === v ? ' selected' : '') + '>' + l + '</option>').join('');
    const teknikOpts = ['', ...TEKNIK_LIST].map(v =>
        '<option value="' + v + '"' + (_rcTeknik === v ? ' selected' : '') + '>' + (v || 'Semua Teknik') + '</option>').join('');
    return (
        '<div class="rc-filter-bar" style="justify-content:space-between">' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
        '<select id="rc-jenis">' + jenisOpts + '</select>' +
        // Metode hanya relevan untuk SUMATIF — jenis lain tidak dihitung nilai akhirnya
        (_rcJenis === 'SUMATIF' ? '<select id="rc-metode">' + metodeOpts + '</select>' : '') +
        '<select id="rc-teknik">' + teknikOpts + '</select>' +
        '</div>' +
        '<button class="pen-btn" data-action="asmt-download-excel">⬇ Unduh Excel</button>' +
        '</div>'
    );
}

function _wireRcFilters(body) {
    body.querySelector('#rc-jenis')?.addEventListener('change', e => {
        _rcJenis     = e.target.value;
        _rcMetode    = 'rata';
        _rcTeknik    = '';
        _rcInstrumen = '';
        _rcPage      = 0;
        _renderRecapContent(body);
    });
    body.querySelector('#rc-metode')?.addEventListener('change', e => { _rcMetode = e.target.value; _rcPage = 0; _renderRecapContent(body); });
    body.querySelector('#rc-teknik')?.addEventListener('change', e => { _rcTeknik = e.target.value; _rcInstrumen = ''; _rcPage = 0; _renderRecapContent(body); });
}

// ── Event delegation ──────────────────────────────────────────────────────────

async function handleClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const act = btn.dataset.action;

    if (act === 'cp-elemen-add')    { openCpElemenModal(null, null, null); return; }
    if (act === 'cp-elemen-edit')   { openCpElemenModal(btn.dataset.elementId, btn.dataset.nama, btn.dataset.deskripsi); return; }
    if (act === 'cp-elemen-delete') {
        const eid = btn.dataset.elementId;
        btn.disabled = true;
        try { await deleteCpElemen(eid); await refreshCpElemenList(); }
        catch (err) { btn.disabled = false; alert('Gagal hapus elemen: ' + err.message); }
        return;
    }
    if (act === 'tp-add') { openTpModal(null); return; }
    if (act === 'tp-edit') {
        const tp = _tpCache.find(t => t.id === btn.dataset.id);
        if (tp) openTpModal(tp);
        return;
    }
    if (act === 'tp-delete') {
        const tp = _tpCache.find(t => t.id === btn.dataset.id);
        if (tp) confirmDeleteTp(tp, btn);
        return;
    }
    if (act === 'tp-desc-toggle') {
        const id = btn.dataset.id;
        const short = document.getElementById('pen-tp-short-' + id);
        const full  = document.getElementById('pen-tp-full-' + id);
        if (!short || !full) return;
        const expanded = full.style.display !== 'none';
        short.style.display = expanded ? '' : 'none';
        full.style.display  = expanded ? 'none' : '';
        btn.textContent     = expanded ? 'Selengkapnya' : 'Ringkas';
        return;
    }
    if (act === 'pen-toggle') {
        const bodyId = btn.dataset.body;
        const tpId   = btn.dataset.tpId;
        const body   = document.getElementById(bodyId);
        if (!body) return;
        const nowOpen = body.style.display !== 'none';
        body.style.display = nowOpen ? 'none' : '';
        btn.textContent    = nowOpen ? '▶' : '▼';
        if (!nowOpen && tpId) await loadAndRenderKktps(tpId);
        return;
    }
    if (act === 'kktp-add') { openKktpModal(btn.dataset.tpId, null); return; }
    if (act === 'kktp-edit') {
        const tpRow  = btn.closest('.pen-tp-row');
        const tpId   = tpRow?.dataset.tpId;
        const kktpId = btn.dataset.id;
        const all    = await getKktps(tpId);
        const kktp   = all.find(k => k.id === kktpId);
        if (tpId && kktp) openKktpModal(tpId, kktp);
        return;
    }
    if (act === 'kktp-delete') {
        const tpRow  = btn.closest('.pen-tp-row');
        const tpId   = tpRow?.dataset.tpId;
        if (tpId) confirmDeleteKktp(tpId, btn.dataset.id, btn);
        return;
    }
    if (act === 'asmt-add') { await openAsmtModal(null); return; }
    if (act === 'asmt-edit') {
        const a = _asmtCache.find(x => x.id === btn.dataset.id);
        if (a) await openAsmtModal(a);
        return;
    }
    if (act === 'asmt-delete') { confirmDeleteAsmt(btn.dataset.id, btn); return; }
    if (act === 'asmt-download-excel') { await downloadPenilaianExcel(); return; }
}

// ── Download Excel ────────────────────────────────────────────────────────────

async function downloadPenilaianExcel() {
    if (!ctxOk()) { alert('Pilih kelas, mapel, tahun, dan semester terlebih dahulu.'); return; }
    if (typeof XLSX === 'undefined') { alert('Library Excel belum dimuat. Muat ulang halaman.'); return; }

    const namaKelas  = document.getElementById('penilaian-kelas-select')?.selectedOptions[0]?.textContent?.trim() || _kelasId;
    const namaMapel  = document.getElementById('penilaian-mapel-select')?.selectedOptions[0]?.textContent?.trim() || _subjectId;

    try {
        await ensureUser();

        // ── Fetch data ─────────────────────────────────────────────────────────

        const [asmts, roster] = await Promise.all([
            getAssessments(_schoolId, _kelasId, _subjectId, _year, Number(_semester)),
            getStudentsForClass(_kelasId),
        ]);

        const asmtIds = asmts.map(a => a.id);

        // Nilai numerik (SUMATIF / DIAGNOSTIK_K)
        let resultsRows = [];
        if (asmtIds.length) {
            const { data, error } = await supabase
                .from('assessment_results')
                .select('assessment_id, student_id, nilai, status, tindak_lanjut')
                .in('assessment_id', asmtIds)
                .eq('school_id', _schoolId);
            if (error) throw error;
            resultsRows = data || [];
        }

        // Rekap nilai akhir per TP per siswa
        const { data: gradeRecapRows, error: grErr } = await supabase
            .from('grade_recap')
            .select('student_id, learning_objective_id, nilai_akhir, kktp_tercapai, deskripsi_capaian')
            .eq('class_id', _kelasId)
            .eq('school_id', _schoolId)
            .eq('academic_year', _year)
            .eq('semester', Number(_semester));
        if (grErr) throw grErr;

        // TP cache (sudah ada di _tpCache, tapi pastikan terisi)
        let tpCache = _tpCache;
        if (!tpCache.length && _kelasId && _subjectId) {
            try { tpCache = await getTps(_kelasId, _subjectId, _year, Number(_semester)); } catch {}
        }

        // Indeks helper: assessment_id → student_id → baris hasil
        const resultsByAsmt = {};
        resultsRows.forEach(r => {
            if (!resultsByAsmt[r.assessment_id]) resultsByAsmt[r.assessment_id] = {};
            resultsByAsmt[r.assessment_id][r.student_id] = r;
        });
        const tpById = Object.fromEntries(tpCache.map(t => [t.id, t]));

        // ── Sheet 1: Rekap Penilaian ───────────────────────────────────────────

        const s1Header = ['Tanggal', 'Jenis', 'Teknik', 'Instrumen', 'TP', 'Keterangan', 'Aspek', 'Indikator', 'Nama Siswa', 'NIS', 'Nilai / Hasil', 'Status/Predikat', 'Tindak Lanjut', 'Refleksi Guru'];
        const s1Rows   = [];

        const jenisLabel = {
            DIAGNOSTIK_NK : 'Diagnostik Non-Kognitif',
            DIAGNOSTIK_K  : 'Diagnostik Kognitif',
            FORMATIF      : 'Formatif',
            SUMATIF       : 'Sumatif',
        };

        for (const asmt of asmts) {
            const tglStr   = asmt.tanggal || '';
            const jenis    = jenisLabel[asmt.jenis] || asmt.jenis;
            const teknik   = asmt.teknik  || '';
            const instrumen = asmt.instrumen || '';
            const tp       = tpById[asmt.learning_objective_id];
            const tpStr    = tp ? (tp.kode_tp + ' – ' + tp.deskripsi_tp) : '';
            const tujuan   = asmt.tujuan  || '';
            const konten   = asmt.konten;

            // Cek format konten JSONB
            const hasNilaiAngka = !!(resultsByAsmt[asmt.id] && Object.keys(resultsByAsmt[asmt.id]).length);
            const hasAspeks     = konten?.aspeks?.length;

            if (hasNilaiAngka) {
                // Format SUMATIF / DIAGNOSTIK_K: nilai numerik di assessment_results
                for (const siswa of roster) {
                    const r = resultsByAsmt[asmt.id]?.[siswa.id];
                    s1Rows.push([
                        tglStr, jenis, teknik, instrumen, tpStr, tujuan,
                        '', '',
                        siswa.nama || siswa.full_name || '',
                        siswa.nis || '',
                        r?.nilai ?? '',
                        r?.status ?? '',
                        r?.tindak_lanjut ?? '',
                        '',
                    ]);
                }
            } else if (hasAspeks) {
                // Format FORMATIF: konten.aspeks[].predikat[].siswa[]
                // Format DIAGNOSTIK_NK: konten.aspeks[].terlihat_jelas/terlihat/belum_terlihat[]
                const firstAspek = konten.aspeks[0];
                const isObservasi = Array.isArray(firstAspek?.terlihat_jelas) || Array.isArray(firstAspek?.terlihat) || Array.isArray(firstAspek?.belum_terlihat);

                if (isObservasi) {
                    // DIAGNOSTIK_NK — satu baris per siswa per aspek
                    const rosterIdx = Object.fromEntries(roster.map(s => [s.id, s]));
                    konten.aspeks.forEach((aspek, ai) => {
                        const aspekNama = aspek.nama      || ('Aspek ' + (ai + 1));
                        const indikator = aspek.indikator || '';
                        const mapHasil  = {};
                        (aspek.terlihat_jelas || []).forEach(sid => { mapHasil[sid] = 'Terlihat Jelas'; });
                        (aspek.terlihat       || []).forEach(sid => { mapHasil[sid] = 'Terlihat'; });
                        (aspek.belum_terlihat || []).forEach(sid => { mapHasil[sid] = 'Belum Terlihat'; });
                        for (const [sid, hasil] of Object.entries(mapHasil)) {
                            const siswa = rosterIdx[sid];
                            if (!siswa) continue;
                            s1Rows.push([
                                tglStr, jenis, teknik, instrumen, tpStr, tujuan,
                                aspekNama, indikator,
                                siswa.nama || siswa.full_name || '',
                                siswa.nis || '',
                                '', hasil, '',
                                konten?.refleksi || '',
                            ]);
                        }
                    });
                } else {
                    // FORMATIF — satu baris per siswa per aspek
                    const rosterIdx = Object.fromEntries(roster.map(s => [s.id, s]));
                    konten.aspeks.forEach((aspek, ai) => {
                        const aspekNama = aspek.nama      || ('Aspek ' + (ai + 1));
                        const indikator = aspek.indikator || '';
                        const mapHasil  = {};
                        (aspek.predikat || []).forEach(p => {
                            (p.siswa || []).forEach(sid => { mapHasil[sid] = p.label || p.val; });
                        });
                        for (const [sid, hasil] of Object.entries(mapHasil)) {
                            const siswa = rosterIdx[sid];
                            if (!siswa) continue;
                            s1Rows.push([
                                tglStr, jenis, teknik, instrumen, tpStr, tujuan,
                                aspekNama, indikator,
                                siswa.nama || siswa.full_name || '',
                                siswa.nis || '',
                                '', hasil, '',
                                konten?.refleksi || '',
                            ]);
                        }
                    });
                }
            } else {
                // Assessment ada tapi belum ada data → satu baris kosong per siswa
                for (const siswa of roster) {
                    s1Rows.push([
                        tglStr, jenis, teknik, instrumen, tpStr, tujuan,
                        '', '',
                        siswa.nama || siswa.full_name || '',
                        siswa.nis || '',
                        '', '', '',
                        '',
                    ]);
                }
            }
        }

        // ── Sheet 2: e-Rapor ──────────────────────────────────────────────────

        const s2Header = ['NO', 'NIS', 'NAMA PESERTA DIDIK', 'NILAI AKHIR', 'KETERCAPAIAN KOMPETENSI'];
        const s2Rows   = [];

        // Kelompokkan grade_recap per siswa (ambil rata-rata atau semua baris per siswa)
        // Format: satu baris per siswa, ambil nilai akhir tertinggi (jika banyak TP)
        // atau buat satu baris per TP jika ada banyak TP
        const recapBySiswa = {};
        (gradeRecapRows || []).forEach(r => {
            if (!recapBySiswa[r.student_id]) recapBySiswa[r.student_id] = [];
            recapBySiswa[r.student_id].push(r);
        });

        const sortedRoster = [...roster].sort((a, b) =>
            (a.nama || a.full_name || '').localeCompare(b.nama || b.full_name || '', 'id')
        );

        let no = 1;
        for (const siswa of sortedRoster) {
            const recaps = recapBySiswa[siswa.id];
            if (recaps && recaps.length) {
                // Satu baris per TP
                for (const r of recaps) {
                    const nilaiAkhir = r.nilai_akhir ?? '';
                    const ketercapaian = r.kktp_tercapai === true ? 1 : r.kktp_tercapai === false ? 0 : '';
                    s2Rows.push([no, siswa.nis || '', siswa.nama || siswa.full_name || '', nilaiAkhir, ketercapaian]);
                    no++;
                }
            } else {
                // Siswa belum ada rekap → baris kosong
                s2Rows.push([no, siswa.nis || '', siswa.nama || siswa.full_name || '', '', '']);
                no++;
            }
        }

        // ── Build workbook ────────────────────────────────────────────────────

        const wb = XLSX.utils.book_new();

        const ws1 = XLSX.utils.aoa_to_sheet([s1Header, ...s1Rows]);
        ws1['!cols'] = s1Header.map((h, i) => ({ wch: i < 6 ? 18 : i < 8 ? 22 : 16 }));
        XLSX.utils.book_append_sheet(wb, ws1, 'Rekap Penilaian');

        const ws2 = XLSX.utils.aoa_to_sheet([s2Header, ...s2Rows]);
        ws2['!cols'] = [{ wch: 5 }, { wch: 14 }, { wch: 28 }, { wch: 14 }, { wch: 24 }];
        XLSX.utils.book_append_sheet(wb, ws2, 'e-Rapor');

        const filename = (namaMapel + '_' + namaKelas + '_Penilaian.xlsx')
            .replace(/[^a-zA-Z0-9_\-\.]/g, '_');

        XLSX.writeFile(wb, filename);
        toast('File Excel berhasil diunduh: ' + filename);

    } catch (err) {
        alert('Gagal mengunduh Excel: ' + err.message);
    }
}

// ── Collapse helpers ──────────────────────────────────────────────────────────

function initCollapse() {
    [
        { headId: 'pen-perencanaan-header', bodyId: 'pen-perencanaan-body' },
        { headId: 'pen-pelaksanaan-header', bodyId: 'pen-pelaksanaan-body' },
        { headId: 'pen-rekap-header',       bodyId: 'pen-rekap-body' },
    ].forEach(cfg => {
        const h = document.getElementById(cfg.headId);
        const b = document.getElementById(cfg.bodyId);
        if (!h || !b) return;
        const chevron = h.querySelector('.pen-chevron');
        b.style.display = 'none';
        h.addEventListener('click', () => {
            const open = b.style.display !== 'none';
            b.style.display = open ? 'none' : '';
            if (chevron) chevron.style.transform = open ? '' : 'rotate(180deg)';
            if (!open) {
                if (cfg.bodyId === 'pen-perencanaan-body') renderPerencanaan();
                if (cfg.bodyId === 'pen-pelaksanaan-body') renderPelaksanaan();
                if (cfg.bodyId === 'pen-rekap-body')       renderRecap();
            }
        });
    });
}

// ── renderAll ─────────────────────────────────────────────────────────────────

async function renderAll() {
    const container = document.getElementById('penilaian-placeholder');
    if (!container) return;

    // penilaian-placeholder punya class section-card dari dashboard.html
    // yang membungkus semua section jadi satu kotak — hapus agar tiap section terpisah
    container.classList.remove('section-card');

    container.innerHTML =
        '<div class="pen-section"><div class="pen-section-header" id="pen-perencanaan-header">' +
        '<span>Perencanaan</span><span class="pen-chevron">▼</span></div>' +
        '<div class="pen-section-body" id="pen-perencanaan-body"></div></div>' +

        '<div class="pen-section"><div class="pen-section-header" id="pen-pelaksanaan-header">' +
        '<span>Pelaksanaan</span><span class="pen-chevron">▼</span></div>' +
        '<div class="pen-section-body" id="pen-pelaksanaan-body"></div></div>' +

        '<div class="pen-section"><div class="pen-section-header" id="pen-rekap-header">' +
        '<span>Rekap Penilaian</span><span class="pen-chevron">▼</span></div>' +
        '<div class="pen-section-body" id="pen-rekap-body"></div></div>';

    if (!_delegInit) {
        container.addEventListener('click', e => {
            handleClick(e).catch(err => console.error('[penilaian]', err));
        });
        _delegInit = true;
    }

    initCollapse();
}

// ═══════════════════════════════════════════════════════
// TAB PENILAIAN — logika sub-tab di dalam tab Jurnal
// ═══════════════════════════════════════════════════════

let _penilaianInit = false;
let _penilaianCtx  = { kelasId: null, subjectId: null, year: null, semester: null, programCode: null, gradeLevel: null };


async function initPenilaianTab() {
    if (_penilaianInit) return;
    _penilaianInit = true;

    // ── Switching sub-tab jurnal (Catatan ↔ Penilaian) ──
    document.querySelectorAll('.jurnal-sub-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const sub = btn.dataset.jurnalSub;
            document.querySelectorAll('.jurnal-sub-btn').forEach(b => {
                const active = b.dataset.jurnalSub === sub;
                b.style.fontWeight   = active ? '600' : '400';
                b.style.borderBottom = active
                    ? '2px solid var(--color-primary)'
                    : '2px solid transparent';
                b.style.color = active
                    ? 'var(--color-primary)'
                    : 'var(--color-text-muted)';
            });
            document.getElementById('jurnal-sub-catatan').style.display =
                sub === 'catatan' ? '' : 'none';
            document.getElementById('jurnal-sub-penilaian').style.display =
                sub === 'penilaian' ? '' : 'none';
        });
    });

    // ── Context selectors ──
    const selKelas = document.getElementById('penilaian-kelas-select');
    const selMapel = document.getElementById('penilaian-mapel-select');
    const selYear  = document.getElementById('penilaian-year-select');
    const selSem   = document.getElementById('penilaian-semester-select');

    // Populate tahun ajaran (tahun lalu, tahun ini, tahun depan)
    const yr = new Date().getFullYear();
    [yr - 1, yr, yr + 1].forEach(y => {
        const opt = document.createElement('option');
        opt.value = `${y}/${y + 1}`;
        opt.textContent = `${y}/${y + 1}`;
        if (y === yr) opt.selected = true;
        selYear.appendChild(opt);
    });
    _penilaianCtx.year     = selYear.value;
    _penilaianCtx.semester = parseInt(selSem.value);

    // Populate kelas dari teaching assignments guru
    await loadPenilaianKelas(selKelas);

    selKelas.addEventListener('change', async () => {
        _penilaianCtx.kelasId = selKelas.value || null;
        const selOpt = selKelas.options[selKelas.selectedIndex];
        _penilaianCtx.gradeLevel  = selOpt?.dataset.gradeLevel  ? Number(selOpt.dataset.gradeLevel)  : null;
        _penilaianCtx.programCode = selOpt?.dataset.programCode || null;
        await loadPenilaianMapel(selMapel, selKelas.value);
        _penilaianCtx.subjectId = null;
        await onPenilaianContextChange();
    });
    selMapel.addEventListener('change', async () => {
        _penilaianCtx.subjectId = selMapel.value || null;
        await onPenilaianContextChange();
    });
    selYear.addEventListener('change', async () => {
        _penilaianCtx.year = selYear.value || null;
        await onPenilaianContextChange();
    });
    selSem.addEventListener('change', async () => {
        _penilaianCtx.semester = parseInt(selSem.value) || null;
        await onPenilaianContextChange();
    });

    // Render accordion segera saat tab dibuka, meski konteks belum lengkap
    await onPenilaianContextChange();
}

async function loadPenilaianKelas(selEl) {
    selEl.innerHTML = '<option value="">— Pilih Kelas —</option>';
    try {
        await ensureUser();
        const { data, error } = await supabase
            .from('teaching_assignments')
            .select('class_id, classes(name, grade_level, program_id, programs(code))')
            .eq('school_id', _schoolId)
            .eq('user_id', _teacherId)
            .eq('is_active', true)
            .order('class_id');
        if (error) throw error;
        const seen = new Set();
        (data || []).forEach(row => {
            if (seen.has(row.class_id)) return;
            seen.add(row.class_id);
            const opt = document.createElement('option');
            opt.value = row.class_id;
            opt.textContent = row.classes?.name || row.class_id;
            opt.dataset.gradeLevel  = row.classes?.grade_level  ?? '';
            opt.dataset.programCode = row.classes?.programs?.code ?? '';
            selEl.appendChild(opt);
        });
    } catch (e) {
        console.error('loadPenilaianKelas:', e);
    }
}

async function loadPenilaianMapel(selEl, kelasId) {
    selEl.innerHTML = '<option value="">— Pilih Mapel —</option>';
    if (!kelasId) return;
    try {
        await ensureUser();
        const { data, error } = await supabase
            .from('teaching_assignments')
            .select('subject_id, subjects(name)')
            .eq('school_id', _schoolId)
            .eq('class_id', kelasId)
            .eq('user_id', _teacherId)
            .eq('is_active', true);
        if (error) throw error;
        const seen = new Set();
        (data || []).forEach(row => {
            if (seen.has(row.subject_id)) return;
            seen.add(row.subject_id);
            const opt = document.createElement('option');
            opt.value = row.subject_id;
            opt.textContent = row.subjects?.name || row.subject_id;
            selEl.appendChild(opt);
        });
    } catch (e) {
        console.error('loadPenilaianMapel:', e);
    }
}

async function onPenilaianContextChange() {
    if (window.initPenilaianPanel) {
        window.initPenilaianPanel(
            _penilaianCtx.kelasId,
            _penilaianCtx.subjectId,
            _penilaianCtx.year,
            _penilaianCtx.semester,
            _penilaianCtx.programCode,
            _penilaianCtx.gradeLevel
        );
    }
}

export { initPenilaianTab };

// ── Entry point ───────────────────────────────────────────────────────────────

window.initPenilaianPanel = function (kelasId, subjectId, year, semester, programCode, gradeLevel) {
    _kelasId      = kelasId      || null;
    _subjectId    = subjectId    || null;
    _year         = year         || null;
    _semester     = semester     || null;
    _programCode  = programCode  || null;
    _gradeLevel   = gradeLevel != null ? Number(gradeLevel) : null;
    _userReady    = false;   // re-fetch user on next action (school may vary)
    _tpCache      = [];
    _asmtCache    = [];
    _rosterCache  = [];
    _rcSemester   = null;
    _rcYear       = null;
    _cpId         = null;

    injectStyles();
    renderAll();
};
