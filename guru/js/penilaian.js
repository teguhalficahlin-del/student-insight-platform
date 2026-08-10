import { getTps, createTp, updateTp, deleteTp, getCurrentUserRow, getCpForSubject,
         getKktps, createKktp, updateKktp, deleteKktp } from './api.js';

let _kelasId        = null;
let _subjectId      = null;
let _year           = null;
let _semester       = null;
let _programCode    = null;
let _gradeLevel     = null;
let _tpsCache       = [];
let _kktpsCache     = {};
let _userInfo       = null;
let _delegationInit = false;

function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function getUserInfo() {
    if (_userInfo) return _userInfo;
    _userInfo = await getCurrentUserRow();
    return _userInfo;
}

// ── Styles ────────────────────────────────────────────────────────────────────

function injectStyles() {
    if (document.getElementById('pen-styles')) return;
    const s = document.createElement('style');
    s.id = 'pen-styles';
    s.textContent = `
.pen-section{border:1px solid var(--color-border);border-radius:var(--radius);overflow:hidden;margin-bottom:12px;}
.pen-section-header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--color-surface);cursor:pointer;user-select:none;font-weight:600;color:var(--color-text);}
.pen-section-header:hover{background:var(--color-bg);}
.pen-chevron{transition:transform .2s;color:var(--color-text-muted);}
.pen-section-body{padding:12px 16px;border-top:1px solid var(--color-border);}
.pen-tp-row{display:flex;align-items:flex-start;gap:12px;padding:10px 0;border-bottom:1px solid var(--color-border);width:100%;box-sizing:border-box;}
.pen-tp-row:last-of-type{border-bottom:none;}
.pen-tp-text{flex:1;min-width:0;}
.pen-tp-kode{font-weight:600;font-size:13px;color:var(--color-text);margin-bottom:2px;}
.pen-tp-desc{font-size:13px;color:var(--color-text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.pen-tp-actions{display:flex;gap:6px;flex-shrink:0;align-self:flex-start;}
.pen-btn{padding:4px 10px;border-radius:var(--radius);border:1px solid var(--color-border);background:var(--color-surface);color:var(--color-text);font-size:12px;cursor:pointer;white-space:nowrap;line-height:1.5;}
.pen-btn:hover{border-color:var(--color-primary);color:var(--color-primary);}
.pen-btn-danger{border-color:var(--color-danger);color:var(--color-danger);}
.pen-btn-danger:hover{background:var(--color-danger-bg);}
.pen-add-btn{display:block;width:100%;box-sizing:border-box;text-align:center;padding:8px;margin-top:10px;border-radius:var(--radius);border:1px dashed var(--color-border);background:none;color:var(--color-text-muted);font-size:13px;cursor:pointer;}
.pen-add-btn:hover{border-color:var(--color-primary);color:var(--color-primary);}
.pen-add-btn-tp{background:#1D9E75;color:#fff;border:none;font-weight:500;}
.pen-add-btn-tp:hover{background:#178a65;color:#fff;border:none;}
.pen-del-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 0 4px;border-top:1px solid var(--color-border);margin-top:6px;}
.pen-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:900;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;}
.pen-modal-box{background:var(--color-surface);border-radius:var(--radius-lg);width:100%;max-width:480px;display:flex;flex-direction:column;max-height:90vh;border:1px solid var(--color-border);}
.pen-modal-header{padding:16px 20px 0;font-weight:600;font-size:15px;color:var(--color-text);}
.pen-modal-body{padding:14px 20px;flex:1;overflow-y:auto;}
.pen-modal-body label{display:block;font-size:12px;font-weight:600;color:var(--color-text-muted);margin:12px 0 4px;text-transform:uppercase;letter-spacing:.04em;}
.pen-modal-body label:first-child{margin-top:0;}
.pen-modal-body input,.pen-modal-body textarea{width:100%;box-sizing:border-box;background:var(--color-bg);border:1px solid var(--color-border);border-radius:var(--radius);color:var(--color-text);font-size:14px;padding:8px 10px;font-family:inherit;}
.pen-modal-body input:focus,.pen-modal-body textarea:focus{outline:none;border-color:var(--color-primary);}
.pen-modal-err{font-size:12px;color:var(--color-danger);min-height:1.2rem;padding:2px 20px 0;}
.pen-modal-footer{padding:10px 20px 16px;display:flex;justify-content:flex-end;gap:8px;border-top:1px solid var(--color-border);}
.pen-cp-block{margin-bottom:14px;border:1px solid var(--color-border);border-radius:var(--radius);overflow:hidden;}
.pen-cp-header{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--color-surface);cursor:pointer;user-select:none;}
.pen-cp-header:hover{background:var(--color-bg);}
.pen-cp-title{font-weight:600;font-size:13px;color:var(--color-text);}
.pen-cp-badge{font-size:11px;padding:2px 7px;border-radius:999px;background:var(--color-bg);border:1px solid var(--color-border);color:var(--color-text-muted);flex-shrink:0;}
.pen-cp-body{padding:12px 14px;border-top:1px solid var(--color-border);display:none;}
.pen-cp-umum{font-size:13px;color:var(--color-text-muted);margin-bottom:10px;line-height:1.5;}
.pen-cp-elemen{padding:8px 10px;margin-bottom:6px;border-left:3px solid var(--color-primary);background:var(--color-bg);border-radius:0 var(--radius) var(--radius) 0;}
.pen-cp-elemen:last-child{margin-bottom:0;}
.pen-cp-elemen-nama{font-weight:600;font-size:12px;color:var(--color-text);margin-bottom:3px;}
.pen-cp-elemen-desc{font-size:12px;color:var(--color-text-muted);line-height:1.5;}
.pen-sec{margin-bottom:16px;}
.pen-sec-label{font-weight:600;font-size:13px;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;}
.pen-tp-left{flex:1;min-width:0;}
.pen-tp-toggle{background:none;border:none;cursor:pointer;padding:2px 4px;font-size:11px;color:var(--color-text-muted);flex-shrink:0;line-height:1.6;transition:transform .15s;}
.pen-tp-headline{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.pen-tp-title{font-weight:600;font-size:13px;color:var(--color-text);}
.pen-tp-count{font-size:11px;padding:1px 6px;border-radius:999px;background:var(--color-bg);border:1px solid var(--color-border);color:var(--color-text-muted);}
.pen-item-actions{display:flex;gap:6px;flex-shrink:0;align-self:flex-start;}
.pen-tp-item-body{padding:6px 0 4px;}
.pen-kktp-list{margin-top:8px;padding-top:8px;border-top:1px solid var(--color-border);width:100%;display:grid;grid-template-columns:auto 1fr auto auto auto;align-items:center;gap:4px 8px;}
.pen-kktp-row{display:contents;}
.pen-kktp-bullet{color:var(--color-text-muted);}
.pen-kktp-predikat{font-weight:600;color:var(--color-text);min-width:0;}
.pen-kktp-range{color:var(--color-text-muted);white-space:nowrap;}
.pen-tp-desc-short,.pen-tp-desc-full{font-size:13px;color:var(--color-text-muted);line-height:1.5;margin:0;}
.pen-tp-more{background:none;border:none;padding:0;font-size:12px;color:var(--color-primary);cursor:pointer;margin-top:2px;display:block;}
.pen-placeholder{font-size:13px;color:var(--color-text-muted);margin:0;}
`;
    document.head.appendChild(s);
}

// ── Modal helper ──────────────────────────────────────────────────────────────

function openModal({ title, bodyHtml, onSave, saveLabel = 'Simpan' }) {
    document.getElementById('pen-modal')?.remove();

    const overlay = document.createElement('div');
    overlay.id        = 'pen-modal';
    overlay.className = 'pen-modal-overlay';
    overlay.innerHTML =
        '<div class="pen-modal-box">' +
            '<div class="pen-modal-header">' + esc(title) + '</div>' +
            '<div class="pen-modal-body">' + bodyHtml + '</div>' +
            '<div class="pen-modal-err" id="pen-modal-err"></div>' +
            '<div class="pen-modal-footer">' +
                '<button type="button" class="pen-btn pen-modal-cancel">Batal</button>' +
                '<button type="button" class="pen-btn pen-modal-save">' + esc(saveLabel) + '</button>' +
            '</div>' +
        '</div>';

    function close() {
        overlay.remove();
        document.removeEventListener('keydown', onEsc);
    }
    function onEsc(e) { if (e.key === 'Escape') close(); }

    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    overlay.querySelector('.pen-modal-cancel').addEventListener('click', close);
    document.addEventListener('keydown', onEsc);

    const saveBtn = overlay.querySelector('.pen-modal-save');
    saveBtn.addEventListener('click', async function () {
        const errEl = overlay.querySelector('#pen-modal-err');
        errEl.textContent = '';
        saveBtn.disabled    = true;
        saveBtn.textContent = 'Menyimpan…';
        try {
            await onSave(overlay, close);
        } catch (err) {
            errEl.textContent   = 'Gagal: ' + (err.message || 'Error tidak diketahui.');
            saveBtn.disabled    = false;
            saveBtn.textContent = saveLabel;
        }
    });

    document.body.appendChild(overlay);
    overlay.querySelector('input, textarea')?.focus();
}

// ── Modal TP ──────────────────────────────────────────────────────────────────

function openTpModal(tp) {
    openModal({
        title: tp ? 'Edit Tujuan Pembelajaran' : 'Tambah Tujuan Pembelajaran',
        bodyHtml:
            '<label>Kode TP <span style="color:var(--color-danger)">*</span></label>' +
            '<input type="text" id="pen-tp-kode" maxlength="30" placeholder="Contoh: TP 1" value="' + esc(tp?.kode_tp || '') + '">' +
            '<label>Deskripsi TP <span style="color:var(--color-danger)">*</span></label>' +
            '<textarea id="pen-tp-desc" rows="4" maxlength="2000" placeholder="Deskripsi tujuan pembelajaran…">' + esc(tp?.deskripsi_tp || '') + '</textarea>' +
            '<label>Urutan <span style="color:var(--color-danger)">*</span></label>' +
            '<input type="number" id="pen-tp-urutan" min="1" step="1" placeholder="1" value="' + esc(String(tp?.urutan ?? '')) + '">',
        onSave: async function (overlay, close) {
            const kode   = overlay.querySelector('#pen-tp-kode').value.trim();
            const desc   = overlay.querySelector('#pen-tp-desc').value.trim();
            const urutan = parseInt(overlay.querySelector('#pen-tp-urutan').value, 10);

            if (!kode)              throw new Error('Kode TP tidak boleh kosong.');
            if (!desc)              throw new Error('Deskripsi TP tidak boleh kosong.');
            if (!urutan || urutan < 1) throw new Error('Urutan harus angka ≥ 1.');

            if (tp) {
                await updateTp(tp.id, { kode_tp: kode, deskripsi_tp: desc, urutan });
            } else {
                const user = await getUserInfo();
                if (!user) throw new Error('Sesi tidak ditemukan, coba muat ulang halaman.');
                await createTp({
                    school_id:    user.school_id,
                    teacher_id:   user.user_id,
                    class_id:     _kelasId,
                    subject_id:   _subjectId,
                    academic_year: _year,
                    semester:     Number(_semester),
                    kode_tp:      kode,
                    deskripsi_tp: desc,
                    urutan,
                });
            }
            close();
            await renderPerencanaan();
        },
    });
}

// ── Inline delete confirm ─────────────────────────────────────────────────────

function confirmDeleteTp(origBtn, tp) {
    origBtn.style.display = 'none';

    const row = origBtn.closest('.pen-tp-row');
    const bar = document.createElement('div');
    bar.className = 'pen-del-bar';
    bar.innerHTML =
        '<span style="flex:1;min-width:0;font-size:12px;color:var(--color-text-muted)">Hapus "' + esc(tp.kode_tp) + '"?</span>' +
        '<button type="button" class="pen-btn pen-btn-danger pen-del-yes">Ya, Hapus</button>' +
        '<button type="button" class="pen-btn pen-del-no">Tidak</button>';

    row.appendChild(bar);

    bar.querySelector('.pen-del-yes').addEventListener('click', async function () {
        const yesBtn = this;
        yesBtn.disabled    = true;
        yesBtn.textContent = 'Menghapus…';
        try {
            await deleteTp(tp.id);
            await renderPerencanaan();
        } catch (err) {
            bar.remove();
            origBtn.style.display = '';
            alert('Gagal hapus: ' + (err.message || 'Error tidak diketahui.'));
        }
    });

    bar.querySelector('.pen-del-no').addEventListener('click', function () {
        bar.remove();
        origBtn.style.display = '';
    });
}

// ── KKTP helpers ─────────────────────────────────────────────────────────────

async function loadAndRenderKktps(tpId) {
    try {
        const kktps = await getKktps(tpId);
        _kktpsCache[tpId] = kktps;
        renderKktpList(tpId, kktps);
    } catch (err) {
        const listEl = document.getElementById('pen-kktp-list-' + tpId);
        if (listEl) listEl.innerHTML = '<p class="pen-placeholder" style="color:var(--color-danger)">Gagal memuat KKTP: ' + esc(err.message) + '</p>';
    }
}

function renderKktpList(tpId, kktps) {
    const listEl = document.getElementById('pen-kktp-list-' + tpId);
    if (!listEl) return;

    let html = '';
    kktps.forEach(function (k) {
        html +=
            '<div class="pen-kktp-row">' +
                '<span class="pen-kktp-bullet">•</span>' +
                '<span class="pen-kktp-predikat">' + esc(k.predikat) + '</span>' +
                '<span class="pen-kktp-range">' + esc(String(k.batas_bawah)) + '–' + esc(String(k.batas_atas)) + '</span>' +
                '<button class="pen-btn" data-action="kktp-edit" data-id="' + esc(k.id) + '" data-tp-id="' + esc(tpId) + '">Edit</button>' +
                '<button class="pen-btn pen-btn-danger" data-action="kktp-delete" data-id="' + esc(k.id) + '" data-tp-id="' + esc(tpId) + '">Hapus</button>' +
            '</div>';
    });
    if (kktps.length === 0) {
        html = '<p class="pen-placeholder">Belum ada KKTP.</p>';
    }
    html += '<button class="pen-add-btn" style="grid-column:1/-1" data-action="kktp-add" data-tp-id="' + esc(tpId) + '">＋ Tambah KKTP</button>';
    listEl.innerHTML = html;

    const badge = document.getElementById('pen-tp-count-' + tpId);
    if (badge) badge.textContent = kktps.length + ' KKTP';
}

function openKktpModal(kktpId, tpId) {
    const existing = kktpId && _kktpsCache[tpId]
        ? _kktpsCache[tpId].find(function (k) { return k.id === kktpId; })
        : null;

    openModal({
        title: kktpId ? 'Edit KKTP' : 'Tambah KKTP',
        bodyHtml:
            '<label>Predikat <span style="color:var(--color-danger)">*</span></label>' +
            '<input type="text" id="pen-kktp-predikat" maxlength="50" placeholder="Contoh: Sangat Baik" value="' + esc(existing?.predikat || '') + '">' +
            '<label>Batas Bawah (0–100) <span style="color:var(--color-danger)">*</span></label>' +
            '<input type="number" id="pen-kktp-bawah" min="0" max="100" step="0.01" placeholder="0" value="' + esc(existing != null ? String(existing.batas_bawah) : '') + '">' +
            '<label>Batas Atas (0–100) <span style="color:var(--color-danger)">*</span></label>' +
            '<input type="number" id="pen-kktp-atas" min="0" max="100" step="0.01" placeholder="100" value="' + esc(existing != null ? String(existing.batas_atas) : '') + '">' +
            '<label>Keterangan</label>' +
            '<textarea id="pen-kktp-ket" rows="3" maxlength="500" placeholder="Opsional…">' + esc(existing?.keterangan || '') + '</textarea>',
        onSave: async function (overlay, close) {
            const predikat = overlay.querySelector('#pen-kktp-predikat').value.trim();
            const bawah    = parseFloat(overlay.querySelector('#pen-kktp-bawah').value);
            const atas     = parseFloat(overlay.querySelector('#pen-kktp-atas').value);
            const ket      = overlay.querySelector('#pen-kktp-ket').value.trim();

            if (!predikat)               throw new Error('Predikat tidak boleh kosong.');
            if (isNaN(bawah) || bawah < 0 || bawah > 100) throw new Error('Batas bawah harus angka antara 0 dan 100.');
            if (isNaN(atas)  || atas  < 0 || atas  > 100) throw new Error('Batas atas harus angka antara 0 dan 100.');
            if (bawah >= atas) throw new Error('Batas bawah harus lebih kecil dari batas atas.');

            if (kktpId) {
                const row = await updateKktp(kktpId, { predikat, batas_bawah: bawah, batas_atas: atas, keterangan: ket || null });
                _kktpsCache[tpId] = (_kktpsCache[tpId] || []).map(function (k) { return k.id === kktpId ? row : k; });
            } else {
                const user = await getUserInfo();
                if (!user) throw new Error('Sesi tidak ditemukan, coba muat ulang halaman.');
                const row = await createKktp({
                    learning_objective_id: tpId,
                    school_id:             user.school_id,
                    predikat,
                    batas_bawah:           bawah,
                    batas_atas:            atas,
                    keterangan:            ket || null,
                });
                _kktpsCache[tpId] = (_kktpsCache[tpId] || []).concat(row);
            }
            renderKktpList(tpId, _kktpsCache[tpId]);
            close();
        },
    });
}

function confirmDeleteKktp(origBtn) {
    const kktpId = origBtn.dataset.id;
    const tpId   = origBtn.dataset.tpId;
    origBtn.style.display = 'none';

    const row = origBtn.closest('.pen-kktp-row');
    const bar = document.createElement('div');
    bar.className = 'pen-del-bar';
    bar.style.gridColumn = '1/-1';
    bar.innerHTML =
        '<span style="flex:1;min-width:0;font-size:12px;color:var(--color-text-muted)">Hapus KKTP ini?</span>' +
        '<button type="button" class="pen-btn pen-btn-danger pen-del-yes">Ya, Hapus</button>' +
        '<button type="button" class="pen-btn pen-del-no">Tidak</button>';

    row.insertAdjacentElement('afterend', bar);

    bar.querySelector('.pen-del-yes').addEventListener('click', async function () {
        const yesBtn = this;
        yesBtn.disabled    = true;
        yesBtn.textContent = 'Menghapus…';
        try {
            await deleteKktp(kktpId);
            _kktpsCache[tpId] = (_kktpsCache[tpId] || []).filter(function (k) { return k.id !== kktpId; });
            renderKktpList(tpId, _kktpsCache[tpId]);
        } catch (err) {
            bar.remove();
            origBtn.style.display = '';
            alert('Gagal hapus: ' + (err.message || 'Error tidak diketahui.'));
        }
    });

    bar.querySelector('.pen-del-no').addEventListener('click', function () {
        bar.remove();
        origBtn.style.display = '';
    });
}

// ── Event delegation ──────────────────────────────────────────────────────────

function handleClick(e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    switch (btn.dataset.action) {
        case 'tp-add':
            openTpModal(null);
            break;
        case 'tp-edit': {
            const tp = _tpsCache.find(function (t) { return t.id === btn.dataset.id; });
            if (tp) openTpModal(tp);
            break;
        }
        case 'tp-delete': {
            const tp = _tpsCache.find(function (t) { return t.id === btn.dataset.id; });
            if (tp) confirmDeleteTp(btn, tp);
            break;
        }
        case 'pen-toggle': {
            const bodyEl = document.getElementById(btn.dataset.body);
            if (!bodyEl) break;
            const isOpen = bodyEl.style.display !== 'none';
            bodyEl.style.display = isOpen ? 'none' : '';
            const chevron = btn.querySelector('.pen-chevron');
            if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
            if (btn.classList.contains('pen-tp-toggle')) {
                btn.textContent = isOpen ? '▶' : '▼';
                if (!isOpen) {
                    const tpId = btn.dataset.tpId;
                    if (tpId && _kktpsCache[tpId] === undefined) {
                        loadAndRenderKktps(tpId);
                    }
                }
            }
            break;
        }
        case 'kktp-add':
            openKktpModal(null, btn.dataset.tpId);
            break;
        case 'kktp-edit':
            openKktpModal(btn.dataset.id, btn.dataset.tpId);
            break;
        case 'kktp-delete':
            confirmDeleteKktp(btn);
            break;
        case 'tp-desc-toggle': {
            const shortEl = document.getElementById('pen-tp-short-' + btn.dataset.id);
            const fullEl  = document.getElementById('pen-tp-full-'  + btn.dataset.id);
            if (!shortEl || !fullEl) break;
            const expanded = fullEl.style.display !== 'none';
            shortEl.style.display = expanded ? '' : 'none';
            fullEl.style.display  = expanded ? 'none' : '';
            btn.textContent       = expanded ? 'Selengkapnya' : 'Ringkas';
            break;
        }
    }
}

function initDelegation() {
    if (_delegationInit) return;
    const container = document.getElementById('penilaian-placeholder');
    if (!container) return;
    container.addEventListener('click', handleClick);
    _delegationInit = true;
}

// ── Collapse ──────────────────────────────────────────────────────────────────

function initCollapse() {
    [
        { headerId: 'pen-perencanaan-header', bodyId: 'pen-perencanaan-body', open: false },
        { headerId: 'pen-pelaksanaan-header', bodyId: 'pen-pelaksanaan-body', open: false },
    ].forEach(function (cfg) {
        const header  = document.getElementById(cfg.headerId);
        const body    = document.getElementById(cfg.bodyId);
        const chevron = header ? header.querySelector('.pen-chevron') : null;
        if (!header || !body) return;

        body.style.display = cfg.open ? '' : 'none';
        if (chevron) chevron.style.transform = cfg.open ? 'rotate(180deg)' : '';

        header.addEventListener('click', function () {
            const isOpen = body.style.display !== 'none';
            body.style.display = isOpen ? 'none' : '';
            if (chevron) chevron.style.transform = isOpen ? '' : 'rotate(180deg)';
        });
    });
}

// ── Render CP (read-only) ─────────────────────────────────────────────────────

async function renderCp() {
    let cp;
    try {
        cp = await getCpForSubject(_subjectId, _programCode, _gradeLevel);
    } catch (err) {
        return '<p class="hint" style="color:var(--color-danger);margin-bottom:10px">Gagal memuat CP: ' + esc(err.message) + '</p>';
    }

    if (!cp || !cp.found) {
        return '<p class="hint" style="margin-bottom:10px">CP nasional belum tersedia untuk mapel ini.</p>';
    }

    const badge = cp.confidence === 'HIGH' ? 'Cocok' : cp.confidence === 'MEDIUM' ? 'Perkiraan' : 'Rendah';
    let eHtml = '';
    (cp.elemen || []).forEach(function (e) {
        eHtml +=
            '<div class="pen-cp-elemen">' +
                '<div class="pen-cp-elemen-nama">' + esc(e.nama_elemen) + '</div>' +
                '<div class="pen-cp-elemen-desc">' + esc(e.deskripsi_cp) + '</div>' +
            '</div>';
    });

    return (
        '<div class="pen-cp-block">' +
            '<div class="pen-cp-header" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display===\'none\'?\'block\':\'none\'">' +
                '<span class="pen-cp-title">Capaian Pembelajaran — ' + esc(cp.core_subject_name) + '</span>' +
                '<span class="pen-cp-badge">' + esc(badge) + '</span>' +
            '</div>' +
            '<div class="pen-cp-body">' +
                (cp.cp_umum ? '<p class="pen-cp-umum">' + esc(cp.cp_umum) + '</p>' : '') +
                eHtml +
            '</div>' +
        '</div>'
    );
}

// ── Render Perencanaan ────────────────────────────────────────────────────────

async function renderPerencanaan() {
    const body = document.getElementById('pen-perencanaan-body');
    if (!body) return;

    const PLACEHOLDER_CONTEXT = '<p class="pen-placeholder">Pilih kelas, mapel, tahun, dan semester untuk melihat data.</p>';
    const PLACEHOLDER_MAPEL   = '<p class="pen-placeholder">Pilih mapel untuk melihat CP.</p>';
    const cpBodyId  = 'pen-cp-body';
    const tpBodyId  = 'pen-tp-body';
    const tpLabelId = 'pen-tp-label';
    const contextOk = _kelasId && _subjectId && _year && _semester;

    body.innerHTML =
        '<div class="pen-sec">' +
            '<div class="pen-sec-label">Capaian Pembelajaran</div>' +
            '<div id="' + cpBodyId + '">' +
                (!_subjectId ? PLACEHOLDER_MAPEL : '<p class="pen-placeholder">Memuat CP…</p>') +
            '</div>' +
        '</div>' +
        '<div class="pen-sec">' +
            '<div class="pen-sec-label" id="' + tpLabelId + '">Tujuan Pembelajaran</div>' +
            '<div id="' + tpBodyId + '">' +
                (!contextOk ? PLACEHOLDER_CONTEXT : '<p class="pen-placeholder">Memuat TP…</p>') +
            '</div>' +
        '</div>';

    if (!_subjectId) return;

    // Fetch CP — hanya butuh _subjectId
    try {
        const cpHtml = await renderCp();
        const cpEl = document.getElementById(cpBodyId);
        if (cpEl) cpEl.innerHTML = cpHtml;
    } catch (err) {
        const cpEl = document.getElementById(cpBodyId);
        if (cpEl) cpEl.innerHTML = '<p class="pen-placeholder" style="color:var(--color-danger)">Gagal memuat CP: ' + esc(err.message) + '</p>';
    }

    if (!contextOk) return;

    // Fetch TP — butuh semua 4 konteks
    let tps;
    try {
        tps = await getTps(_kelasId, _subjectId, _year, Number(_semester));
    } catch (err) {
        const tpEl = document.getElementById(tpBodyId);
        if (tpEl) tpEl.innerHTML = '<p class="pen-placeholder" style="color:var(--color-danger)">Gagal memuat TP: ' + esc(err.message) + '</p>';
        return;
    }

    _tpsCache = tps;

    const tpLabel = document.getElementById(tpLabelId);
    if (tpLabel) tpLabel.textContent = 'Tujuan Pembelajaran (' + tps.length + ')';

    let tpHtml = '';
    tps.forEach(function (tp) {
        const long       = tp.deskripsi_tp.length > 120;
        const short      = long ? tp.deskripsi_tp.slice(0, 120) + '…' : tp.deskripsi_tp;
        const itemBodyId = 'pen-tp-item-body-' + tp.id;
        tpHtml +=
            '<div class="pen-tp-row" data-tp-id="' + esc(tp.id) + '">' +
                '<div class="pen-tp-left">' +
                    '<div class="pen-tp-headline">' +
                        '<button class="pen-tp-toggle" data-action="pen-toggle" data-body="' + itemBodyId + '" data-tp-id="' + esc(tp.id) + '">▶</button>' +
                        '<span class="pen-tp-title">' + esc(tp.kode_tp) + '</span>' +
                        '<span class="pen-tp-count" id="pen-tp-count-' + esc(tp.id) + '">0 KKTP</span>' +
                    '</div>' +
                    '<div class="pen-tp-item-body" id="' + itemBodyId + '" style="display:none">' +
                        '<p class="pen-tp-desc-short" id="pen-tp-short-' + esc(tp.id) + '">' + esc(short) + '</p>' +
                        (long
                            ? '<p class="pen-tp-desc-full" id="pen-tp-full-' + esc(tp.id) + '" style="display:none">' + esc(tp.deskripsi_tp) + '</p>' +
                              '<button class="pen-tp-more" data-action="tp-desc-toggle" data-id="' + esc(tp.id) + '">Selengkapnya</button>'
                            : '') +
                        '<div class="pen-kktp-list" id="pen-kktp-list-' + esc(tp.id) + '">' +
                            '<p class="pen-placeholder">Belum ada KKTP.</p>' +
                            '<button class="pen-add-btn" data-action="kktp-add" data-tp-id="' + esc(tp.id) + '">＋ Tambah KKTP</button>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
                '<div class="pen-item-actions">' +
                    '<button class="pen-btn" data-action="tp-edit" data-id="' + esc(tp.id) + '">Edit</button>' +
                    '<button class="pen-btn pen-btn-danger" data-action="tp-delete" data-id="' + esc(tp.id) + '">Hapus</button>' +
                '</div>' +
            '</div>';
    });

    if (tps.length === 0) {
        tpHtml = '<p class="pen-placeholder">Belum ada TP untuk mapel dan kelas ini.</p>';
    }
    tpHtml += '<button class="pen-add-btn pen-add-btn-tp" data-action="tp-add">＋ Tambah Tujuan Pembelajaran</button>';

    const tpEl = document.getElementById(tpBodyId);
    if (tpEl) tpEl.innerHTML = tpHtml;
}

// ── Render Pelaksanaan (placeholder — sprint berikutnya) ──────────────────────

function renderPelaksanaan() {
    const body = document.getElementById('pen-pelaksanaan-body');
    if (!body) return;
    if (!_kelasId || !_subjectId || !_year || !_semester) {
        body.innerHTML = '<p class="hint">Pilih kelas, mapel, tahun, dan semester untuk melihat data.</p>';
        return;
    }
    body.innerHTML = '<p class="hint">Belum ada entri penilaian.</p>';
}

// ── renderAll ─────────────────────────────────────────────────────────────────

async function renderAll() {
    const container = document.getElementById('penilaian-placeholder');
    if (!container) return;

    container.innerHTML =
        '<div class="pen-section">' +
            '<div class="pen-section-header" id="pen-perencanaan-header">' +
                '<span>Perencanaan</span>' +
                '<span class="pen-chevron">▼</span>' +
            '</div>' +
            '<div class="pen-section-body" id="pen-perencanaan-body" style="display:none"></div>' +
        '</div>' +
        '<div class="pen-section">' +
            '<div class="pen-section-header" id="pen-pelaksanaan-header">' +
                '<span>Pelaksanaan</span>' +
                '<span class="pen-chevron">▼</span>' +
            '</div>' +
            '<div class="pen-section-body" id="pen-pelaksanaan-body" style="display:none"></div>' +
        '</div>';

    initCollapse();
    initDelegation();
    await renderPerencanaan();
    renderPelaksanaan();
}

// ── Entry point ───────────────────────────────────────────────────────────────

window.initPenilaianPanel = function (kelasId, subjectId, year, semester, programCode, gradeLevel) {
    _kelasId     = kelasId     || null;
    _subjectId   = subjectId   || null;
    _year        = year        || null;
    _semester    = semester    || null;
    _programCode = programCode || null;
    _gradeLevel  = gradeLevel  != null ? Number(gradeLevel) : null;
    injectStyles();
    renderAll();
};
