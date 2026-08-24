import {
    getCurrentUserRow, getCpForSubject,
    getTps, createTp, updateTp, deleteTp,
    getKktps, createKktp, updateKktp, deleteKktp,
    getStudentsForClass,
    getAssessments, createAssessment, updateAssessment, deleteAssessment,
    getAssessmentResults, upsertAssessmentResult,
    getStudentGroups, upsertStudentGroup,
    upsertGradeRecap, getGradeRecap,
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
let _rcTeknik   = '';
let _rcInstrumen = '';
let _rcMetode   = 'rata';   // 'rata' | 'bobot' | 'terbaik'
let _rcBobots   = {};       // { asmt_id: number }
let _rcLastSumatifIds = [];
let _rcHasil    = null;

let _delegInit  = false;
let _userReady  = false;

// ── Constants ─────────────────────────────────────────────────────────────────

const PREDIKAT_RUBRIK = [
    { val: 'SB',  lbl: 'Sangat Berkembang' },
    { val: 'BSH', lbl: 'Berkembang Sesuai Harapan' },
    { val: 'MB',  lbl: 'Mulai Berkembang' },
    { val: 'BB',  lbl: 'Belum Berkembang' },
];

const DEFAULT_RENTANG = { BB: [0, 54], MB: [55, 69], BSH: [70, 84], SB: [85, 100] };

const JENIS_LIST   = ['DIAGNOSTIK', 'FORMATIF', 'SUMATIF'];
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

const STATUS_GRUP = { PAHAM: 'A', BELUM_PAHAM: 'B', PERLU_PERHATIAN: 'C' };

// ── Utility ───────────────────────────────────────────────────────────────────

function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
.sum-chip-wrap { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px }
.sum-chip { padding:5px 10px; border:1px solid var(--color-border); border-radius:16px;
  font-size:12px; cursor:pointer; background:var(--color-surface) }
.sum-chip.active { background:var(--color-primary); color:#fff; border-color:var(--color-primary) }
.sum-pager { display:flex; gap:6px; justify-content:center; margin:8px 0 }
.sum-input-row { display:flex; align-items:center; gap:8px; padding:6px 0;
  border-bottom:1px solid var(--color-border); font-size:13px }
.sum-input-row:last-child { border-bottom:none }
.sum-input-row input { width:80px; text-align:center }
/* instrumen body */
.pai-instrumen-block { margin-bottom:12px }
.pai-row { display:flex; gap:6px; align-items:center; margin-bottom:4px; font-size:12px }
.pai-row input, .pai-row select { flex:1 }
.pai-row-add { background:none; border:none; color:var(--color-primary); cursor:pointer; font-size:12px; padding:0 }
/* rekap */
.rc-filter-bar { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px; align-items:center }
.rc-filter-bar select, .rc-filter-bar input { padding:6px 8px; border:1px solid var(--color-border);
  border-radius:5px; font-size:12px; background:var(--color-bg); color:var(--color-text) }
.rc-table { width:100%; border-collapse:collapse; font-size:12px }
.rc-table th,.rc-table td { padding:7px 10px; border:1px solid var(--color-border); text-align:left }
.rc-table th { background:var(--color-surface); font-weight:600 }
.rc-bobot-input { width:50px; text-align:center; padding:3px; border:1px solid var(--color-border); border-radius:3px }
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
            const saveBtn = overlay.querySelector('[data-action="modal-save"]');
            saveBtn.disabled = true; saveBtn.textContent = 'Menyimpan…';
            let errEl = overlay.querySelector('.pen-modal-err');
            if (!errEl) { errEl = document.createElement('p'); errEl.className = 'pen-modal-err'; overlay.querySelector('.pen-modal-footer').prepend(errEl); }
            errEl.textContent = '';
            Promise.resolve().then(() => onSave(overlay, closeModal)).catch(err => {
                errEl.textContent = err.message || 'Terjadi kesalahan.';
                saveBtn.disabled = false; saveBtn.textContent = 'Simpan';
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
        '<div class="pen-add-row"><button class="pen-btn pen-btn-sm" data-action="kktp-add" data-tp-id="' + esc(tp.id) + '">+ Tambah KKTP</button></div>' +
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

function confirmDeleteTp(tp, origBtn) {
    origBtn.style.display = 'none';
    const row = origBtn.closest('.pen-tp-row');
    const bar = document.createElement('div');
    bar.className = 'pen-del-bar';
    bar.innerHTML = '<span style="flex:1;font-size:12px">Hapus "' + esc(tp.kode_tp) + '"? Semua KKTP-nya juga akan terhapus.</span>' +
        '<button class="pen-btn pen-btn-sm pen-btn-danger pen-del-yes">Ya, Hapus</button>' +
        '<button class="pen-btn pen-btn-sm pen-del-no">Tidak</button>';
    row.appendChild(bar);
    bar.querySelector('.pen-del-yes').addEventListener('click', async function () {
        this.disabled = true; this.textContent = 'Menghapus…';
        try { await deleteTp(tp.id); await renderPerencanaan(); }
        catch (err) { bar.remove(); origBtn.style.display = ''; alert('Gagal hapus: ' + err.message); }
    });
    bar.querySelector('.pen-del-no').addEventListener('click', () => { bar.remove(); origBtn.style.display = ''; });
}

async function renderPerencanaan() {
    const body = document.getElementById('pen-perencanaan-body');
    if (!body) return;
    const hasCtx = ctxOk();

    body.innerHTML =
        '<div class="pen-sec"><div class="pen-sec-label">Capaian Pembelajaran</div>' +
        '<div id="pen-cp-body"><p class="pen-placeholder">Memuat CP…</p></div></div>' +
        '<div class="pen-sec"><div class="pen-sec-label" id="pen-tp-label">Tujuan Pembelajaran</div>' +
        '<div id="pen-tp-body">' +
        (hasCtx ? '<p class="pen-placeholder">Memuat TP…</p>' : '<p class="pen-placeholder">Pilih kelas, mapel, tahun, dan semester.</p>') +
        '</div>' +
        (hasCtx ? '<div class="pen-add-row"><button class="pen-btn" data-action="tp-add">+ Tambah TP</button></div>' : '') +
        '</div>';

    if (_subjectId) {
        renderCp().then(html => { const el = document.getElementById('pen-cp-body'); if (el) el.innerHTML = html; });
    } else {
        document.getElementById('pen-cp-body').innerHTML = '<p class="pen-placeholder">Pilih mapel untuk melihat CP.</p>';
    }

    if (!hasCtx) return;

    let tps;
    try { tps = await getTps(_kelasId, _subjectId, _year, Number(_semester)); }
    catch (err) {
        const el = document.getElementById('pen-tp-body');
        if (el) el.innerHTML = '<p class="pen-placeholder" style="color:var(--color-danger)">Gagal memuat TP: ' + esc(err.message) + '</p>';
        return;
    }
    _tpCache = tps;
    const tpLabel = document.getElementById('pen-tp-label');
    if (tpLabel) tpLabel.textContent = 'Tujuan Pembelajaran (' + tps.length + ')';
    const tpBody = document.getElementById('pen-tp-body');
    if (!tpBody) return;
    if (!tps.length) {
        tpBody.innerHTML = '<p class="pen-placeholder">Belum ada TP. Klik "+ Tambah TP" untuk mulai.</p>';
        return;
    }
    tpBody.innerHTML = tps.map(tpRowHtml).join('');
    tps.forEach(tp => loadAndRenderKktps(tp.id));
}

// ── Section 2: Pelaksanaan ────────────────────────────────────────────────────

// instrumen body builders
function instrumenFieldHtml(teknik, instrumen) {
    const instrFmt = (instrumen || '').replace(/\s/g, '_').toUpperCase();
    switch (teknik) {
        case 'OBSERVASI':
            if (instrumen === 'Lembar Observasi' || instrumen === 'Checklist') {
                return '<div class="pai-instrumen-block">' +
                    '<div class="pai-row"><input type="text" class="pai-aspek" placeholder="Aspek observasi" maxlength="200"><button type="button" class="pai-row-add" data-act="aspek-add">+ Aspek</button></div>' +
                    '</div>';
            }
            if (instrumen === 'Catatan Anekdot') {
                return '<div class="pai-instrumen-block"><div class="pai-row"><textarea class="pai-catatan-template" rows="3" placeholder="Template catatan anekdot…" maxlength="500"></textarea></div></div>';
            }
            return '';
        case 'TES':
            return '<div class="pai-instrumen-block">' +
                '<label style="font-size:12px;font-weight:600">Soal</label>' +
                '<div id="pai-soal-list"><div class="pai-row"><input type="text" class="pai-soal" placeholder="Soal 1" maxlength="500"><button type="button" class="pai-row-add" data-act="soal-add">+ Soal</button></div></div>' +
                '</div>';
        case 'PENUGASAN':
        case 'PROYEK':
        case 'PORTOFOLIO':
        case 'UNJUK_KERJA':
            if (instrumen === 'Rubrik') {
                return '<div class="pai-instrumen-block">' +
                    '<label style="font-size:12px;font-weight:600">Kriteria Rubrik</label>' +
                    '<div id="pai-rubrik-list"><div class="pai-row"><input type="text" class="pai-kriteria" placeholder="Kriteria 1" maxlength="200"><select class="pai-bobot"><option value="1">Bobot 1</option><option value="2">Bobot 2</option><option value="3">Bobot 3</option></select><button type="button" class="pai-row-add" data-act="rubrik-add">+ Kriteria</button></div></div>' +
                    '</div>';
            }
            if (instrumen === 'Checklist') {
                return '<div class="pai-instrumen-block">' +
                    '<label style="font-size:12px;font-weight:600">Item Checklist</label>' +
                    '<div id="pai-checklist-list"><div class="pai-row"><input type="text" class="pai-item" placeholder="Item 1" maxlength="200"><button type="button" class="pai-row-add" data-act="checklist-add">+ Item</button></div></div>' +
                    '</div>';
            }
            return '';
        case 'TES_LISAN':
            return '<div class="pai-instrumen-block">' +
                '<label style="font-size:12px;font-weight:600">Pertanyaan</label>' +
                '<div id="pai-lisan-list"><div class="pai-row"><input type="text" class="pai-pertanyaan" placeholder="Pertanyaan 1" maxlength="500"><button type="button" class="pai-row-add" data-act="lisan-add">+ Pertanyaan</button></div></div>' +
                '</div>';
        default: return '';
    }
}

function wireInstrumenBody(container) {
    container.addEventListener('click', e => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const act = btn.dataset.act;
        const addRow = (listId, inputClass, placeholder) => {
            const list = container.querySelector('#' + listId);
            if (!list) return;
            const row = document.createElement('div'); row.className = 'pai-row';
            row.innerHTML = '<input type="text" class="' + inputClass + '" placeholder="' + placeholder + '" maxlength="' + (listId === 'pai-soal-list' ? '500' : '200') + '">';
            list.appendChild(row);
            row.querySelector('input')?.focus();
        };
        if (act === 'aspek-add') { const b = container.querySelector('.pai-instrumen-block'); if (!b) return; const row = document.createElement('div'); row.className = 'pai-row'; row.innerHTML = '<input type="text" class="pai-aspek" placeholder="Aspek observasi" maxlength="200">'; b.insertBefore(row, btn.closest('.pai-row')); row.querySelector('input')?.focus(); }
        if (act === 'soal-add')      addRow('pai-soal-list',     'pai-soal',      'Soal');
        if (act === 'rubrik-add')    { const list = container.querySelector('#pai-rubrik-list'); if (!list) return; const row = document.createElement('div'); row.className = 'pai-row'; row.innerHTML = '<input type="text" class="pai-kriteria" placeholder="Kriteria" maxlength="200"><select class="pai-bobot"><option value="1">Bobot 1</option><option value="2">Bobot 2</option><option value="3">Bobot 3</option></select>'; list.appendChild(row); row.querySelector('input')?.focus(); }
        if (act === 'checklist-add') addRow('pai-checklist-list', 'pai-item',      'Item');
        if (act === 'lisan-add')     addRow('pai-lisan-list',     'pai-pertanyaan','Pertanyaan');
    });
}

function collectInstrumenBody(container, teknik, instrumen) {
    switch (teknik) {
        case 'OBSERVASI':
            if (instrumen === 'Catatan Anekdot') return { template: container.querySelector('.pai-catatan-template')?.value.trim() || '' };
            return { aspek: [...container.querySelectorAll('.pai-aspek')].map(i => i.value.trim()).filter(Boolean) };
        case 'TES':
            return { soal: [...container.querySelectorAll('.pai-soal')].map(i => i.value.trim()).filter(Boolean) };
        case 'PENUGASAN': case 'PROYEK': case 'PORTOFOLIO': case 'UNJUK_KERJA':
            if (instrumen === 'Rubrik') return { kriteria: [...container.querySelectorAll('.pai-kriteria')].map((i, idx) => ({ teks: i.value.trim(), bobot: parseInt(container.querySelectorAll('.pai-bobot')[idx]?.value || '1', 10) })).filter(k => k.teks) };
            return { item: [...container.querySelectorAll('.pai-item')].map(i => i.value.trim()).filter(Boolean) };
        case 'TES_LISAN':
            return { pertanyaan: [...container.querySelectorAll('.pai-pertanyaan')].map(i => i.value.trim()).filter(Boolean) };
        default: return {};
    }
}

function prefillInstrumenBody(container, teknik, instrumen, konten) {
    if (!konten) return;
    switch (teknik) {
        case 'OBSERVASI':
            if (instrumen === 'Catatan Anekdot') { const t = container.querySelector('.pai-catatan-template'); if (t) t.value = konten.template || ''; return; }
            (konten.aspek || []).forEach((a, i) => {
                let inp = container.querySelectorAll('.pai-aspek')[i];
                if (!inp) { const b = container.querySelector('.pai-instrumen-block'); if (!b) return; const row = document.createElement('div'); row.className = 'pai-row'; row.innerHTML = '<input type="text" class="pai-aspek" placeholder="Aspek" maxlength="200">'; b.insertBefore(row, b.querySelector('[data-act]')?.closest('.pai-row')); inp = row.querySelector('input'); }
                if (inp) inp.value = a;
            });
            return;
        case 'TES':
            (konten.soal || []).forEach((s, i) => {
                let inp = container.querySelectorAll('.pai-soal')[i];
                if (!inp) { const list = container.querySelector('#pai-soal-list'); if (!list) return; const row = document.createElement('div'); row.className = 'pai-row'; row.innerHTML = '<input type="text" class="pai-soal" placeholder="Soal" maxlength="500">'; list.appendChild(row); inp = row.querySelector('input'); }
                if (inp) inp.value = s;
            });
            return;
        case 'PENUGASAN': case 'PROYEK': case 'PORTOFOLIO': case 'UNJUK_KERJA':
            if (instrumen === 'Rubrik') {
                (konten.kriteria || []).forEach((k, i) => {
                    let inp = container.querySelectorAll('.pai-kriteria')[i];
                    let sel = container.querySelectorAll('.pai-bobot')[i];
                    if (!inp) { const list = container.querySelector('#pai-rubrik-list'); if (!list) return; const row = document.createElement('div'); row.className = 'pai-row'; row.innerHTML = '<input type="text" class="pai-kriteria" placeholder="Kriteria" maxlength="200"><select class="pai-bobot"><option value="1">Bobot 1</option><option value="2">Bobot 2</option><option value="3">Bobot 3</option></select>'; list.appendChild(row); inp = row.querySelector('.pai-kriteria'); sel = row.querySelector('.pai-bobot'); }
                    if (inp) inp.value = k.teks || '';
                    if (sel) sel.value = String(k.bobot || 1);
                });
                return;
            }
            (konten.item || []).forEach((it, i) => {
                let inp = container.querySelectorAll('.pai-item')[i];
                if (!inp) { const list = container.querySelector('#pai-checklist-list'); if (!list) return; const row = document.createElement('div'); row.className = 'pai-row'; row.innerHTML = '<input type="text" class="pai-item" placeholder="Item" maxlength="200">'; list.appendChild(row); inp = row.querySelector('input'); }
                if (inp) inp.value = it;
            });
            return;
        case 'TES_LISAN':
            (konten.pertanyaan || []).forEach((p, i) => {
                let inp = container.querySelectorAll('.pai-pertanyaan')[i];
                if (!inp) { const list = container.querySelector('#pai-lisan-list'); if (!list) return; const row = document.createElement('div'); row.className = 'pai-row'; row.innerHTML = '<input type="text" class="pai-pertanyaan" placeholder="Pertanyaan" maxlength="500">'; list.appendChild(row); inp = row.querySelector('input'); }
                if (inp) inp.value = p;
            });
            return;
    }
}

// per-student row in modal (diagnostik / formatif only — sumatif uses chip pagination)
function studentRowHtml(siswa, result, jenis, kktpItems) {
    const res = result || {};
    const sid = siswa.id;

    const statusOpts = ['', 'PAHAM', 'BELUM_PAHAM', 'PERLU_PERHATIAN'].map(v => (
        '<option value="' + v + '"' + (res.status === v ? ' selected' : '') + '>' +
        (v ? v.replace(/_/g, ' ') : '— Status —') + '</option>'
    )).join('');

    const kktpOpts = [{ id: '', keterangan: '— KKTP —' }, ...kktpItems].map(k => (
        '<option value="' + esc(k.id) + '">' + esc(k.keterangan || k.id) + '</option>'
    )).join('');

    return (
        '<div class="pai-srow" data-sid="' + esc(sid) + '">' +
        '<div class="pai-srow-name">' + esc(siswa.nama) + '</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">' +
        '<select class="pai-status" data-sid="' + esc(sid) + '" style="font-size:11px">' + statusOpts + '</select>' +
        (kktpItems.length ? '<select class="pai-kktp" data-sid="' + esc(sid) + '" style="font-size:11px">' + kktpOpts + '</select>' : '') +
        '<input type="text" class="pai-umpan" data-sid="' + esc(sid) + '" placeholder="Umpan balik" value="' + esc(res.umpan_balik || '') + '" style="flex:1;min-width:120px;font-size:11px">' +
        '<input type="text" class="pai-tindak" data-sid="' + esc(sid) + '" placeholder="Tindak lanjut" value="' + esc(res.tindak_lanjut || '') + '" style="flex:1;min-width:120px;font-size:11px">' +
        '</div>' +
        '</div>'
    );
}

// sumatif pagination
const SUM_PER_PAGE = 5;
let _sumPage = 0;
let _sumNilai = {};   // sid → number
let _sumSiswaList = [];

function renderSumPage(container) {
    const chips = container.querySelector('.sum-chip-wrap');
    const inputArea = container.querySelector('#sum-input-area');
    if (!chips || !inputArea) return;
    chips.innerHTML = _sumSiswaList.map((s, i) => (
        '<span class="sum-chip' + (Math.floor(i / SUM_PER_PAGE) === _sumPage ? ' active' : '') + '" data-page="' + Math.floor(i / SUM_PER_PAGE) + '">' + esc(s.nama.split(' ')[0]) + '</span>'
    )).join('');
    chips.querySelectorAll('.sum-chip').forEach(chip => {
        chip.addEventListener('click', () => { _sumPage = parseInt(chip.dataset.page); renderSumPage(container); });
    });
    const start = _sumPage * SUM_PER_PAGE;
    const page  = _sumSiswaList.slice(start, start + SUM_PER_PAGE);
    inputArea.innerHTML = page.map(s => (
        '<div class="sum-input-row">' +
        '<span style="flex:1">' + esc(s.nama) + '</span>' +
        '<input type="number" class="pai-nilai-sum" data-sid="' + esc(s.id) + '" min="0" max="100" step="0.5" placeholder="0–100" value="' + esc(String(_sumNilai[s.id] ?? '')) + '">' +
        '</div>'
    )).join('');
    inputArea.querySelectorAll('.pai-nilai-sum').forEach(inp => {
        inp.addEventListener('input', () => { _sumNilai[inp.dataset.sid] = parseFloat(inp.value) || null; });
    });
}

async function openAsmtModal(editAsmt) {
    await ensureUser();
    const roster = _rosterCache;

    // for edit: load existing results
    let existingResults = {};
    if (editAsmt) {
        const rows = await getAssessmentResults(editAsmt.id);
        rows.forEach(r => { existingResults[r.student_id] = r; });
    }

    // initial jenis/teknik/instrumen
    const initJenis    = editAsmt?.jenis    || 'DIAGNOSTIK';
    const initTeknik   = editAsmt?.teknik   || 'OBSERVASI';
    const initInstrumen = editAsmt?.instrumen || (INSTRUMEN_MAP.OBSERVASI[0]);

    // load TPs if not cached (user might open pelaksanaan without opening perencanaan first)
    if (!_tpCache.length && ctxOk()) {
        try { _tpCache = await getTps(_kelasId, _subjectId, _year, Number(_semester)); } catch {}
    }

    // collect all kktp for any TP
    const allKktp = [];
    for (const tp of _tpCache) {
        try { const k = await getKktps(tp.id); allKktp.push(...k); } catch {}
    }

    const tpOpts = [{ id: '', kode_tp: '— TP (Opsional) —' }, ..._tpCache].map(t => (
        '<option value="' + esc(t.id) + '"' + (editAsmt?.learning_objective_id === t.id ? ' selected' : '') + '>' + esc(t.kode_tp) + '</option>'
    )).join('');

    const jenisOpts = JENIS_LIST.map(j => '<option value="' + j + '"' + (initJenis === j ? ' selected' : '') + '>' + j + '</option>').join('');
    const teknikOpts = TEKNIK_LIST.map(t => '<option value="' + t + '"' + (initTeknik === t ? ' selected' : '') + '>' + t.replace(/_/g, ' ') + '</option>').join('');
    const instrOpts  = (INSTRUMEN_MAP[initTeknik] || []).map(i => '<option value="' + i + '"' + (initInstrumen === i ? ' selected' : '') + '>' + i + '</option>').join('');

    const isSumatif = initJenis === 'SUMATIF';

    const bodyHtml =
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
        '<div id="pai-instrumen-body"></div>' +
        '<hr style="margin:12px 0;border:none;border-top:1px solid var(--color-border)">' +
        '<div id="pai-siswa-section">' +
        (isSumatif
            ? '<div class="sum-chip-wrap"></div><div id="sum-input-area"></div>'
            : roster.map(s => studentRowHtml(s, existingResults[s.id], initJenis, allKktp)).join('')) +
        '</div>' +
        '<hr style="margin:12px 0;border:none;border-top:1px solid var(--color-border)">' +
        '<label>Refleksi Guru</label>' +
        '<textarea id="pai-refleksi" rows="2" maxlength="500" placeholder="Refleksi setelah pelaksanaan…">' + esc(editAsmt?.refleksi_guru || '') + '</textarea>' +
        '<div style="display:flex;gap:16px;margin-top:8px">' +
        '<label style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:normal;color:var(--color-text)"><input type="checkbox" id="pai-vis-siswa"' + (editAsmt?.is_visible_siswa ? ' checked' : '') + '> Tampilkan ke Siswa</label>' +
        '<label style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:normal;color:var(--color-text)"><input type="checkbox" id="pai-vis-ortu"' + (editAsmt?.is_visible_ortu ? ' checked' : '') + '> Tampilkan ke Orang Tua</label>' +
        '</div>';

    openModal({ title: editAsmt ? 'Edit Penilaian' : 'Tambah Penilaian', bodyHtml, wide: true,
        onSave: async (_ov, close) => {
            const jenis    = _ov.querySelector('#pai-jenis-sel').value;
            const teknik   = _ov.querySelector('#pai-teknik-sel').value;
            const instrumen = _ov.querySelector('#pai-instrumen-sel').value;
            const tpId     = _ov.querySelector('#pai-tp-sel').value || null;
            const tujuan   = _ov.querySelector('#pai-tujuan').value.trim();
            const refleksi = _ov.querySelector('#pai-refleksi').value.trim();
            const visS = _ov.querySelector('#pai-vis-siswa').checked;
            const visO = _ov.querySelector('#pai-vis-ortu').checked;

            const instrBody = _ov.querySelector('#pai-instrumen-body');
            const konten = collectInstrumenBody(instrBody, teknik, instrumen);

            const payload = {
                jenis, teknik, instrumen, tujuan: tujuan || null,
                konten, refleksi_guru: refleksi || null,
                is_visible_siswa: visS, is_visible_ortu: visO,
                learning_objective_id: tpId,
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

            // save results
            if (jenis === 'SUMATIF') {
                for (const [sid, nilai] of Object.entries(_sumNilai)) {
                    if (nilai != null) await upsertAssessmentResult(_schoolId, _kelasId, asmtId, sid, { nilai });
                }
            } else {
                const srows = _ov.querySelectorAll('.pai-srow');
                for (const row of srows) {
                    const sid = row.dataset.sid; if (!sid) continue;
                    const status     = row.querySelector('.pai-status')?.value || null;
                    const umpan      = row.querySelector('.pai-umpan')?.value.trim() || null;
                    const tindak     = row.querySelector('.pai-tindak')?.value.trim() || null;
                    const kktpSel    = row.querySelector('.pai-kktp');
                    const kktpId     = kktpSel?.value || null;
                    if (!status && !umpan && !tindak) continue;
                    const grup = status ? STATUS_GRUP[status] || null : null;
                    await upsertAssessmentResult(_schoolId, _kelasId, asmtId, sid, { status, umpan_balik: umpan, tindak_lanjut: tindak, grup_diferensiasi: grup });
                    if (grup) await upsertStudentGroup(_schoolId, _kelasId, sid, grup);
                }
            }

            close();
            await renderPelaksanaan();
        }
    });

    // wire teknik/instrumen cascades
    const modal = document.querySelector('.pen-modal');
    if (!modal) return;
    const jenisSel   = modal.querySelector('#pai-jenis-sel');
    const teknikSel  = modal.querySelector('#pai-teknik-sel');
    const instrSel   = modal.querySelector('#pai-instrumen-sel');
    const instrBody  = modal.querySelector('#pai-instrumen-body');
    const siswaSec   = modal.querySelector('#pai-siswa-section');

    function rebuildInstrBody() {
        instrBody.innerHTML = instrumenFieldHtml(teknikSel.value, instrSel.value);
        wireInstrumenBody(instrBody);
        if (editAsmt && editAsmt.teknik === teknikSel.value && editAsmt.instrumen === instrSel.value) {
            prefillInstrumenBody(instrBody, teknikSel.value, instrSel.value, editAsmt.konten);
        }
    }

    function rebuildSiswaSection() {
        const j = jenisSel.value;
        const isS = j === 'SUMATIF';
        _sumPage = 0; _sumNilai = {}; _sumSiswaList = roster;
        siswaSec.innerHTML = isS
            ? '<div class="sum-chip-wrap"></div><div id="sum-input-area"></div>'
            : roster.map(s => studentRowHtml(s, existingResults[s.id] || {}, j, allKktp)).join('');
        if (isS) renderSumPage(siswaSec);
    }

    teknikSel.addEventListener('change', () => {
        const instrs = INSTRUMEN_MAP[teknikSel.value] || [];
        instrSel.innerHTML = instrs.map(i => '<option value="' + i + '">' + i + '</option>').join('');
        rebuildInstrBody();
    });
    instrSel.addEventListener('change', rebuildInstrBody);
    jenisSel.addEventListener('change', rebuildSiswaSection);

    rebuildInstrBody();
    if (initJenis === 'SUMATIF') { _sumSiswaList = roster; _sumPage = 0; _sumNilai = {}; renderSumPage(siswaSec); }
}

function asmtRowHtml(a) {
    const jLetter  = a.jenis?.[0] || 'D';
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

    body.innerHTML = '<p class="pen-placeholder">Memuat rekap…</p>';
    await _renderRecapContent(body);
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
        const sumatifs = _asmtCache.filter(a => a.jenis === 'SUMATIF'
            && (!_rcTeknik   || a.teknik    === _rcTeknik)
            && (!_rcInstrumen || a.instrumen === _rcInstrumen));

        if (!sumatifs.length) {
            body.innerHTML =
                _rcFilterBar() +
                '<p class="pen-placeholder">Tidak ada penilaian Sumatif' + (_rcTeknik ? ' (' + _rcTeknik + ')' : '') + ' untuk ditampilkan.</p>';
            _wireRcFilters(body);
            return;
        }

        // load all results
        const allResults = {};
        await Promise.all(sumatifs.map(async a => {
            const rows = await getAssessmentResults(a.id);
            allResults[a.id] = Object.fromEntries(rows.map(r => [r.student_id, r]));
        }));

        const roster = _rosterCache;
        const hasSiswa = roster.length > 0;

        // compute final values
        const hasilSiswa = {};
        for (const s of roster) {
            const nilais = sumatifs.map(a => allResults[a.id]?.[s.id]?.nilai ?? null);
            let nilai = null;
            if (_rcMetode === 'rata') {
                const valid = nilais.filter(n => n != null);
                nilai = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
            } else if (_rcMetode === 'bobot') {
                let sum = 0, totalBobot = 0;
                sumatifs.forEach((a, i) => {
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
        const kktpForTp  = linkedTpId ? (await getKktps(linkedTpId)) : [];

        function kktpTercapai(nilai) {
            if (nilai == null || !kktpForTp.length) return null;
            const bsh = kktpForTp[0]?.rentang?.BSH;
            if (!bsh) return null;
            return nilai >= bsh[0];
        }

        let tableHtml =
            '<table class="rc-table"><thead><tr>' +
            '<th>Nama Siswa</th>' +
            sumatifs.map(a => '<th>' + esc(a.teknik?.replace(/_/g,'') || '') + ' ' + esc(a.instrumen || '') + '</th>').join('') +
            '<th>Nilai Akhir</th><th>KKTP</th>' +
            (_rcMetode === 'bobot' ? '<th>Bobot (%)</th>' : '') +
            '</tr></thead><tbody>';

        for (const s of roster) {
            const h    = hasilSiswa[s.id] || {};
            const nak  = h.nilai != null ? h.nilai.toFixed(1) : '—';
            const kt   = kktpTercapai(h.nilai);
            const ktTxt = kt == null ? '—' : (kt ? '✓' : '✗');
            tableHtml += '<tr>' +
                '<td>' + esc(s.nama) + '</td>' +
                (h.nilais || sumatifs.map(() => null)).map(n => '<td>' + (n != null ? n.toFixed(1) : '—') + '</td>').join('') +
                '<td><strong>' + nak + '</strong></td>' +
                '<td>' + ktTxt + '</td>' +
                (_rcMetode === 'bobot' ? '<td></td>' : '') +
                '</tr>';
        }
        tableHtml += '</tbody></table>';

        // bobot row
        let bobotHtml = '';
        if (_rcMetode === 'bobot') {
            bobotHtml = '<div style="margin:8px 0;font-size:12px"><strong>Set bobot tiap sumatif (total harus 100%):</strong><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">' +
                sumatifs.map(a => (
                    '<label style="display:flex;align-items:center;gap:4px;font-size:12px;font-weight:normal">' +
                    esc(a.instrumen || a.teknik) +
                    '<input type="number" class="rc-bobot-input" data-aid="' + esc(a.id) + '" min="0" max="100" value="' + esc(String(_rcBobots[a.id] || 0)) + '">' +
                    '</label>'
                )).join('') +
                '</div></div>';
        }

        body.innerHTML =
            _rcFilterBar() + bobotHtml +
            '<div style="display:flex;justify-content:flex-end;margin-bottom:8px">' +
            '<button class="pen-btn pen-btn-primary" data-action="rc-simpan">Simpan Rekap</button>' +
            '</div>' +
            '<div style="overflow-x:auto">' + tableHtml + '</div>';

        _wireRcFilters(body);

        body.querySelectorAll('.rc-bobot-input').forEach(inp => {
            inp.addEventListener('change', () => { _rcBobots[inp.dataset.aid] = parseFloat(inp.value) || 0; _renderRecapContent(body); });
        });

        body.querySelector('[data-action="rc-simpan"]')?.addEventListener('click', async () => {
            const btn = body.querySelector('[data-action="rc-simpan"]');
            btn.disabled = true; btn.textContent = 'Menyimpan…';
            try {
                for (const s of roster) {
                    const h = hasilSiswa[s.id] || {};
                    if (h.nilai == null) continue;
                    const kt = kktpTercapai(h.nilai);
                    await upsertGradeRecap(_schoolId, _kelasId, s.id,
                        linkedTpId || _tpCache[0]?.id,
                        Number(_semester), _year,
                        { nilai_akhir: h.nilai, kktp_tercapai: kt, deskripsi_capaian: null });
                }
                btn.textContent = 'Tersimpan ✓';
                setTimeout(() => { btn.disabled = false; btn.textContent = 'Simpan Rekap'; }, 2000);
            } catch (err) {
                btn.disabled = false; btn.textContent = 'Simpan Rekap';
                alert('Gagal simpan: ' + err.message);
            }
        });
    } catch (err) {
        body.innerHTML = _rcFilterBar() + '<p class="pen-placeholder" style="color:var(--color-danger)">Gagal memuat rekap: ' + esc(err.message) + '</p>';
        _wireRcFilters(body);
    }
}

function _rcFilterBar() {
    const metodeOpts = [['rata','Rata-rata'],['bobot','Bobot'],['terbaik','Nilai Terbaik']].map(([v, l]) =>
        '<option value="' + v + '"' + (_rcMetode === v ? ' selected' : '') + '>' + l + '</option>').join('');
    const teknikOpts = ['', ...TEKNIK_LIST].map(v =>
        '<option value="' + v + '"' + (_rcTeknik === v ? ' selected' : '') + '>' + (v || 'Semua Teknik') + '</option>').join('');
    return (
        '<div class="rc-filter-bar">' +
        '<select id="rc-metode">' + metodeOpts + '</select>' +
        '<select id="rc-teknik">' + teknikOpts + '</select>' +
        '</div>'
    );
}

function _wireRcFilters(body) {
    body.querySelector('#rc-metode')?.addEventListener('change', e => { _rcMetode = e.target.value; _renderRecapContent(body); });
    body.querySelector('#rc-teknik')?.addEventListener('change', e => { _rcTeknik = e.target.value; _rcInstrumen = ''; _renderRecapContent(body); });
}

// ── Event delegation ──────────────────────────────────────────────────────────

async function handleClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const act = btn.dataset.action;

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
        '<span>Rekap Nilai Semester</span><span class="pen-chevron">▼</span></div>' +
        '<div class="pen-section-body" id="pen-rekap-body"></div></div>';

    if (!_delegInit) {
        container.addEventListener('click', e => {
            handleClick(e).catch(err => console.error('[penilaian]', err));
        });
        _delegInit = true;
    }

    initCollapse();
}

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

    injectStyles();
    renderAll();
};
