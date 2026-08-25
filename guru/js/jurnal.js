/**
 * @file guru/js/jurnal.js
 * Sub-tab Catatan Jurnal — dipindah dari dashboard.js.
 */

import { getLoginUrl } from '../../shared/branding.js';
import {
    getCurrentUserRow,
    getJournalEntries, insertJournalEntry, deleteJournalEntry, updateJournalEntry,
} from './api.js';
import { initPenilaianTab } from './penilaian.js';

// ── Utility (salinan dari dashboard.js — modul ini mandiri) ───────────────────

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
    remove(key) {
        try { localStorage.removeItem(`smkhr:${key}`); } catch {}
    },
};

function esc(s) {
    const el = document.createElement('span');
    el.textContent = s ?? '';
    return el.innerHTML;
}

function fe(err, ctx = 'muat') {
    console.error('[guru]', err);
    const m = String(err?.message ?? '').toLowerCase();
    if (m.includes('jwt') || m.includes('expired')) {
        // GRU-06: sesi sudah tidak valid — alihkan ke login, jangan hanya
        // menampilkan pesan. Guard fe._redirecting mencegah banyak request
        // yang gagal berbarengan menjadwalkan redirect berkali-kali.
        if (!fe._redirecting) {
            fe._redirecting = true;
            // Auto-reset setelah 10 detik — jika redirect gagal (mis. diblokir
            // ekstensi browser), error JWT berikutnya tetap bisa memicu redirect
            // alih-alih terjebak selamanya oleh guard ini.
            setTimeout(() => { fe._redirecting = false; }, 10000);
            setTimeout(() => window.location.replace(getLoginUrl()), 1500);
        }
        return 'Sesi habis. Mengalihkan ke halaman login…';
    }
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

function localDateStr(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ── Sesi pengguna ─────────────────────────────────────────────────────────────

let _userId    = null;
let _userReady = false;

async function ensureUser() {
    if (_userReady) return;
    const u = await getCurrentUserRow();
    if (!u) throw new Error('Sesi tidak ditemukan. Muat ulang halaman.');
    _userId    = u.user_id;
    _userReady = true;
}

// ─── TAB JURNAL MENGAJAR ─────────────────────────────────────

let _jurnalTabInit = false;
async function initJurnalTab() {
    if (_jurnalTabInit) return;
    _jurnalTabInit = true;

    await ensureUser();

    // Tanggal default hari ini, tersembunyi
    const dateEl = document.getElementById('journal-date');
    const today  = localDateStr();
    dateEl.value = today;
    dateEl.max   = today;
    const minDate = new Date();
    minDate.setFullYear(minDate.getFullYear() - 1);
    dateEl.min = minDate.toISOString().slice(0, 10);

    const contentEl  = document.getElementById('journal-content');
    const charCount  = document.getElementById('journal-char-count');
    const submitBtn  = document.getElementById('journal-submit-btn');
    const dateErrEl  = document.getElementById('journal-date-err');

    contentEl.addEventListener('input', () => {
        const len = contentEl.value.length;
        charCount.textContent = `${len} / 5000`;
        charCount.style.color = len >= 5000
            ? 'var(--color-danger)'
            : len >= 4500
                ? 'var(--color-warning, orange)'
                : 'var(--color-text-muted)';
    });

    const validateDate = () => {
        const val = dateEl.value;
        if (!val || val < dateEl.min || val > dateEl.max) {
            if (dateErrEl) { dateErrEl.textContent = 'Tanggal tidak valid'; dateErrEl.style.display = 'block'; }
            submitBtn.disabled = true;
        } else {
            if (dateErrEl) dateErrEl.style.display = 'none';
            submitBtn.disabled = false;
        }
    };
    dateEl.addEventListener('change', validateDate);

    document.getElementById('journal-date-toggle').addEventListener('click', () => {
        const row = document.getElementById('journal-date-row');
        const visible = row.style.display !== 'none';
        row.style.display = visible ? 'none' : 'block';
    });

    await loadJurnalList();

    document.getElementById('journal-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn     = submitBtn;
        const msgEl   = document.getElementById('journal-form-msg');
        const content = contentEl.value.trim();
        const date    = dateEl.value;

        if (!content) return;
        if (!date || date < dateEl.min || date > dateEl.max) return;

        btn.disabled = true;
        btn.textContent = 'Menyimpan…';
        msgEl.style.display = 'none';

        try {
            const r = await insertJournalEntry(_userId, date, content);
            if (r.status === 'error') throw new Error(r.error);
            contentEl.value = '';
            charCount.textContent = '0 / 5000';
            charCount.style.color = 'var(--color-text-muted)';
            msgEl.textContent = r.status === 'queued'
                ? '⏳ Catatan disimpan lokal — akan dikirim saat online.'
                : 'Catatan berhasil disimpan.';
            msgEl.style.display = 'block';
            if (r.status === 'queued') {
                const cacheKey = `jurnal-${_userId}`;
                const cached   = LC.get(cacheKey) ?? [];
                const newEntry = { journal_id: r.journal_id, entry_date: date, content, created_at: new Date().toISOString() };
                LC.set(cacheKey, [newEntry, ...cached]);
                renderJurnalEntries([newEntry, ...cached], document.getElementById('journal-list'));
            }
            if (r.status === 'synced') await loadJurnalList();
        } catch (err) {
            msgEl.textContent = fe(err, 's');
            msgEl.style.display = 'block';
        } finally {
            btn.disabled = false;
            btn.textContent = 'Simpan';
        }
    });

    // Inisialisasi logika sub-tab Penilaian (pasang event listener switching)
    await initPenilaianTab();
}

function renderJurnalEntries(entries, listEl) {
    if (!entries.length) {
        listEl.innerHTML = '<p class="hint">Belum ada catatan.</p>';
        return;
    }
    listEl.innerHTML = entries.map(e => `
        <div class="section-card" style="margin-bottom:8px" data-entry-id="${esc(e.journal_id)}" data-entry-date="${esc(e.entry_date)}">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;flex-wrap:wrap;gap:6px">
                <strong>${fmt(e.entry_date)}</strong>
                <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
                    <div class="jrn-del-confirm" style="display:none;align-items:center;gap:8px">
                        <span style="font-size:13px;color:var(--color-text-muted)">Hapus catatan ini?</span>
                        <button class="btn btn-danger btn-sm jrn-del-yes">Ya, Hapus</button>
                        <button class="btn btn-secondary btn-sm jrn-del-no">Batal</button>
                    </div>
                    <button class="btn btn-secondary btn-sm jrn-edit-btn" data-id="${esc(e.journal_id)}">Edit</button>
                    <button class="btn btn-secondary btn-sm jrn-del-ask" data-delete="${esc(e.journal_id)}">Hapus</button>
                </div>
            </div>
            <p class="jrn-content-view" style="white-space:pre-wrap;margin:0">${esc(e.content)}</p>
            <div class="jrn-edit-area" style="display:none">
                <textarea class="input jrn-edit-ta" rows="4" style="width:100%;margin-bottom:6px">${esc(e.content)}</textarea>
                <div style="display:flex;gap:6px">
                    <button class="btn btn-primary btn-sm jrn-edit-save">Simpan</button>
                    <button class="btn btn-secondary btn-sm jrn-edit-cancel">Batal</button>
                </div>
                <p class="jrn-edit-err" style="display:none;font-size:13px;color:var(--color-danger);margin:4px 0 0"></p>
            </div>
            <p class="jrn-del-err" style="display:none;font-size:13px;color:var(--color-danger);margin:4px 0 0"></p>
        </div>
    `).join('');

    listEl.querySelectorAll('[data-entry-id]').forEach(card => {
        const id        = card.dataset.entryId;
        const entryDate = card.dataset.entryDate;
        const askBtn    = card.querySelector('.jrn-del-ask');
        const confirmEl = card.querySelector('.jrn-del-confirm');
        const yesBtn    = card.querySelector('.jrn-del-yes');
        const noBtn     = card.querySelector('.jrn-del-no');
        const errEl     = card.querySelector('.jrn-del-err');
        const editBtn   = card.querySelector('.jrn-edit-btn');
        const editArea  = card.querySelector('.jrn-edit-area');
        const editTa    = card.querySelector('.jrn-edit-ta');
        const editSave  = card.querySelector('.jrn-edit-save');
        const editCancel= card.querySelector('.jrn-edit-cancel');
        const editErr   = card.querySelector('.jrn-edit-err');
        const contentP  = card.querySelector('.jrn-content-view');

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
                const timeout = setTimeout(() => {
                    yesBtn.disabled = false; yesBtn.textContent = 'Ya, Hapus';
                    errEl.textContent = 'Koneksi terputus. Coba lagi.';
                    errEl.style.display = 'block';
                }, 10000);
                try {
                    const r = await deleteJournalEntry(askBtn.dataset.delete);
                    clearTimeout(timeout);
                    if (r?.status === 'queued') {
                        errEl.textContent = 'Penghapusan dijadwalkan dan akan diproses saat koneksi tersedia.';
                        errEl.style.display = 'block';
                        confirmEl.style.display = 'none';
                        askBtn.style.display = 'inline-flex';
                        yesBtn.disabled = false; yesBtn.textContent = 'Ya, Hapus';
                    } else {
                        await loadJurnalList();
                    }
                } catch (err) {
                    clearTimeout(timeout);
                    errEl.textContent = fe(err, 'h');
                    errEl.style.display = 'block';
                    yesBtn.disabled = false; yesBtn.textContent = 'Ya, Hapus';
                }
            });

            editBtn.addEventListener('click', () => {
                editArea.style.display  = 'block';
                contentP.style.display  = 'none';
                editBtn.style.display   = 'none';
                askBtn.style.display    = 'none';
                editErr.style.display   = 'none';
            });
            editCancel.addEventListener('click', () => {
                editArea.style.display  = 'none';
                contentP.style.display  = '';
                editBtn.style.display   = '';
                askBtn.style.display    = '';
            });
            editSave.addEventListener('click', async () => {
                const newContent = editTa.value.trim();
                if (!newContent) return;
                editSave.disabled = true; editSave.textContent = 'Menyimpan…';
                try {
                    const r = await updateJournalEntry(id, entryDate, newContent, _userId);
                    if (r.status === 'error') throw new Error(r.error);
                    LC.clear(`jurnal-${_userId}`);
                    if (r.status === 'queued') {
                        editErr.textContent = '⏳ Tersimpan di perangkat — akan dikirim saat online.';
                        editErr.style.color = 'var(--color-warning,#b45309)';
                        editErr.style.display = 'block';
                        editSave.disabled = false; editSave.textContent = 'Simpan';
                    } else {
                        await loadJurnalList();
                    }
                } catch (err) {
                    editErr.textContent = fe(err, 's');
                    editErr.style.color = 'var(--color-danger)';
                    editErr.style.display = 'block';
                    editSave.disabled = false; editSave.textContent = 'Simpan';
                }
            });
        });
}

async function loadJurnalList() {
    await ensureUser();

    const listEl   = document.getElementById('journal-list');
    const cacheKey = `jurnal-${_userId}`;

    const removeStaleBanner = () => {
        const b = document.getElementById('journal-stale-banner');
        if (b) b.remove();
    };

    // Tampilkan cache dulu
    const cached = LC.get(cacheKey);
    if (cached) {
        renderJurnalEntries(cached, listEl);
    } else {
        listEl.innerHTML = '<p class="hint">Memuat…</p>';
    }

    try {
        const entries = await getJournalEntries(_userId);
        LC.set(cacheKey, entries);
        removeStaleBanner();
        renderJurnalEntries(entries, listEl);
    } catch (err) {
        if (cached) {
            // Ada cache tapi fetch gagal — tampilkan banner stale
            const existing = document.getElementById('journal-stale-banner');
            if (!existing) {
                const banner = document.createElement('div');
                banner.id = 'journal-stale-banner';
                banner.style.cssText = 'font-size:0.8rem;color:var(--color-text-muted);padding:4px 0;margin-bottom:8px';
                banner.textContent = '⚠ Menampilkan data terakhir tersimpan. Periksa koneksi internet Anda.';
                listEl.insertAdjacentElement('beforebegin', banner);
            }
        } else {
            listEl.innerHTML = `<p class="hint">Gagal memuat data. ${esc(fe(err))}</p>`;
        }
    }
}

export { initJurnalTab };
