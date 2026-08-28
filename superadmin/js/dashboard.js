const SUPABASE_URL  = 'https://xovvuuwexoweoqyltepq.supabase.co';

import { getSuperadminKey, setSuperadminKey } from './auth.js';

function getSaKey() {
    const k = getSuperadminKey();
    if (!k) {
        // Key hilang (refresh) — kembali ke login view
        document.getElementById('dashboard-view').style.display = 'none';
        document.getElementById('login-view').style.display = '';
        return null;
    }
    return k;
}

// ── Tab navigation ────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.querySelector(`.tab-panel[data-panel="${btn.dataset.tab}"]`).classList.add('active');
    });
});

// ── Toggle form daftarkan sekolah ─────────────────────────────
const provisionCard = document.getElementById('provision-card');
document.getElementById('toggle-provision-btn').addEventListener('click', () => {
    const open = provisionCard.style.display !== 'none';
    provisionCard.style.display = open ? 'none' : '';
    document.getElementById('toggle-provision-btn').textContent = open ? '+ Daftarkan Baru' : '✕ Tutup Form';
    if (!open) provisionCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});
document.getElementById('cancel-provision-btn').addEventListener('click', () => {
    provisionCard.style.display = 'none';
    document.getElementById('toggle-provision-btn').textContent = '+ Daftarkan Baru';
});

// ── Sinkron color picker ↔ hex input ─────────────────────────
function syncColor(pickerId, hexId) {
    const picker = document.getElementById(pickerId);
    const hex    = document.getElementById(hexId);
    if (!picker || !hex) return;
    picker.addEventListener('input', () => { hex.value = picker.value; });
    hex.addEventListener('input', () => {
        if (/^#[0-9a-fA-F]{6}$/.test(hex.value)) picker.value = hex.value;
    });
}
syncColor('f-primary-color', 'f-primary-color-hex');
syncColor('f-secondary-color', 'f-secondary-color-hex');

function esc(s) {
    const el = document.createElement('span');
    el.textContent = s ?? '—';
    return el.innerHTML;
}
function fmt(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('id-ID', { day:'numeric', month:'short', year:'numeric' });
}

// ── Logout ────────────────────────────────────────────────────
document.getElementById('logout-btn').addEventListener('click', () => {
    setSuperadminKey(null);
    document.getElementById('dashboard-view').style.display = 'none';
    document.getElementById('login-view').style.display = '';
});

// ── Health badges per sekolah ─────────────────────────────────
function renderHealthBadges(h) {
    if (!h) return '';

    function jabatanBadge(label, count) {
        if (count === 0) return `<span class="hbadge hbadge-missing">✗ ${label}</span>`;
        if (count === 1) return `<span class="hbadge hbadge-ok">✓ ${label}</span>`;
        return `<span class="hbadge hbadge-dup">⚠ ${label} (${count}×!)</span>`;
    }

    const provRatio = h.student_count > 0
        ? Math.round((h.provisioned_count / h.student_count) * 100)
        : null;

    return `
    <div class="health-panel">
      <div class="health-row health-jabatan">
        ${jabatanBadge('Kepsek', h.kepsek_count)}
        ${jabatanBadge('Waka Kur.', h.waka_kurikulum_count)}
        ${jabatanBadge('Waka Kes.', h.waka_kesiswaan_count)}
        ${jabatanBadge('Waka Humas', h.waka_humas_count)}
      </div>
      <div class="health-row health-counts">
        <span class="hstat"><strong>${h.staff_count}</strong> staf</span>
        <span class="hstat"><strong>${h.student_count}</strong> siswa</span>
        ${provRatio !== null
            ? `<span class="hstat ${provRatio < 100 ? 'hstat-warn' : ''}"><strong>${h.provisioned_count}</strong>/${h.student_count} punya akun (${provRatio}%)</span>`
            : ''}
      </div>
      ${(h.guru_count != null) ? `
      <div class="health-row" style="gap:12px;flex-wrap:wrap;font-size:12px;color:var(--color-text-muted,#64748b);border-top:1px solid var(--color-border,#e2e8f0);padding-top:6px;margin-top:4px">
        <span>👩‍🏫 <strong>${h.guru_count}</strong> guru/staf</span>
        <span>🎓 <strong>${h.siswa_count}</strong> siswa</span>
        <span>👪 <strong>${h.ortu_count}</strong> ortu</span>
        <span>🏭 <strong>${h.dudi_count}</strong> DUDI</span>
        <span>📊 <strong>${h.stakeholder_count}</strong> stakeholder</span>
      </div>` : ''}
    </div>`;
}

// ── Load daftar sekolah ───────────────────────────────────────
async function loadSchools() {
    const saKey = getSaKey(); if (!saKey) return;
    const hintEl  = document.getElementById('schools-hint');

    try {
        // Superadmin key-based (bukan Supabase auth) → baca daftar sekolah
        // lewat edge function service-role yang digerbang X-Superadmin-Key,
        // karena RLS schools kini butuh auth.uid() (tak ada untuk anon).
        const res = await fetch(`${SUPABASE_URL}/functions/v1/list-schools`, {
            headers: { 'x-superadmin-key': saKey },
        });
        const data = await res.json();

        if (res.status === 401) { hintEl.textContent = 'Sesi superadmin tidak valid. Masuk ulang.'; return; }
        if (!Array.isArray(data) || data.length === 0) {
            hintEl.textContent = data?.error ? `Gagal memuat: ${data.error}` : 'Belum ada sekolah terdaftar.';
            return;
        }

        hintEl.style.display = 'none';
        const listEl = document.getElementById('schools-list');
        const BASE = location.origin + location.pathname.replace(/superadmin\/.*$/, '');

        listEl.innerHTML = data.map(s => {
            const adminUrl = s.slug ? `${BASE}admin/?school=${esc(s.slug)}` : null;
            // SUP-08: primary_color masuk ke atribut style — validasi format hex
            // agar nilai seperti 'red; width:100vw' tidak bisa menyuntik CSS.
            const hexOk = /^#[0-9a-fA-F]{6}$/.test(s.primary_color ?? '');
            const swatchColor = hexOk ? s.primary_color : '#cccccc';
            const colorSwatch = s.primary_color
                ? `<span class="color-swatch" style="background:${swatchColor}"></span>${esc(s.primary_color)}`
                : '—';
            return `
            <div class="school-item">
              <button class="school-summary" type="button">
                <span class="school-summary-left">
                  ${s.primary_color ? `<span class="color-dot" style="background:${swatchColor}"></span>` : ''}
                  <span class="school-summary-name">${esc(s.name)}</span>
                  <span class="school-summary-meta" style="font-size:11px;color:#94a3b8;margin-top:2px;display:flex;gap:16px">
                      <span>${esc(s.admin_name || '—')}</span>
                      <span style="color:#60a5fa">${s.admin_login_identifier ? esc(s.admin_login_identifier) : '—'}</span>
                  </span>
                </span>
                <span class="school-summary-right">
                  <span class="badge ${s.is_active ? 'badge-active' : 'badge-inactive'}">${s.is_active ? 'Aktif' : 'Nonaktif'}</span>
                  <span class="chevron">›</span>
                </span>
              </button>
              <div class="school-detail">
                <dl class="school-meta">
                  ${s.npsn ? `<div class="meta-row"><dt>NPSN</dt><dd>${esc(s.npsn)}</dd></div>` : ''}
                  <div class="meta-row"><dt>Admin</dt><dd>${esc(s.admin_name)}</dd></div>
                  <div class="meta-row"><dt>Login Admin</dt><dd>${s.admin_login_identifier ? esc(s.admin_login_identifier) : '—'}</dd></div>
                  ${adminUrl ? `<div class="meta-row"><dt>Link Login</dt><dd>
                    <code class="slug-code">?school=${esc(s.slug)}</code>
                    <div class="meta-actions">
                      <button class="btn btn-sm btn-secondary copy-url-btn" data-url="${adminUrl}">Salin Link</button>
                      <a href="${adminUrl}" target="_blank" class="btn btn-sm btn-secondary">Buka ↗</a>
                    </div>
                  </dd></div>` : ''}
                  ${s.phone ? `<div class="meta-row"><dt>Telepon</dt><dd>${esc(s.phone)}</dd></div>` : ''}
                  <div class="meta-row"><dt>Warna</dt><dd style="display:flex;align-items:center;gap:6px">${colorSwatch}</dd></div>
                  <div class="meta-row"><dt>Terdaftar</dt><dd>${fmt(s.created_at)}</dd></div>
                </dl>
                ${renderHealthBadges(s.health)}
                <div class="school-actions">
                  <button class="btn btn-sm btn-secondary reset-pw-btn"
                      data-school-id="${esc(s.school_id)}"
                      data-school-name="${esc(s.name)}"
                      ${!s.has_admin_account ? 'disabled title="Tidak ada akun admin"' : ''}>
                      Reset Password
                  </button>
                  ${s.is_active
                      ? `<button class="btn btn-sm toggle-status-btn"
                              data-school-id="${esc(s.school_id)}"
                              data-school-name="${esc(s.name)}"
                              data-active="true"
                              style="background:#b45309;color:#fff;border-color:#b45309">
                              Nonaktifkan
                         </button>`
                      : `<button class="btn btn-sm toggle-status-btn"
                              data-school-id="${esc(s.school_id)}"
                              data-school-name="${esc(s.name)}"
                              data-active="false"
                              style="background:#15803d;color:#fff;border-color:#15803d">
                              Aktifkan
                         </button>
                         <button class="btn btn-sm delete-school-btn"
                              data-school-id="${esc(s.school_id)}"
                              data-school-name="${esc(s.name)}"
                              style="background:#dc2626;color:#fff;border-color:#dc2626">
                              Hapus Permanen
                         </button>`
                  }
                </div>
              </div>
            </div>`;
        }).join('');

    } catch (err) {
        hintEl.textContent = `Gagal memuat: ${err.message}`;
    }
}

// SUP-10: delegasi klik daftar sekolah didaftarkan SEKALI di module level.
// Sebelumnya listener ini berada di dalam loadSchools(), sehingga tiap refresh
// (provision / hapus / toggle status) menambahkan satu handler baru dan satu
// klik memicu N aksi. #schools-list ada statis di index.html
// (#dashboard-view, sejak SUP-03 SPA migration).
const schoolsListEl = document.getElementById('schools-list');
schoolsListEl?.addEventListener('click', e => {
    // Accordion toggle
    const summary = e.target.closest('.school-summary');
    if (summary) {
        const item = summary.closest('.school-item');
        const isOpen = item.classList.contains('open');
        // tutup semua lain
        schoolsListEl.querySelectorAll('.school-item.open').forEach(el => el.classList.remove('open'));
        if (!isOpen) item.classList.add('open');
        return;
    }
    const resetBtn = e.target.closest('.reset-pw-btn');
    if (resetBtn && !resetBtn.disabled) {
        openResetModal(resetBtn.dataset.schoolId, resetBtn.dataset.schoolName);
    }
    const copyBtn = e.target.closest('.copy-url-btn');
    if (copyBtn) {
        navigator.clipboard.writeText(copyBtn.dataset.url).then(() => {
            const orig = copyBtn.textContent;
            copyBtn.textContent = 'Tersalin!';
            setTimeout(() => { copyBtn.textContent = orig; }, 1500);
        }).catch(() => {
            // SUP-09: clipboard API gagal (izin ditolak / bukan HTTPS) — beri jalan keluar.
            alert('Gagal menyalin otomatis. Salin manual:\n' + copyBtn.dataset.url);
        });
    }
    const delBtn = e.target.closest('.delete-school-btn');
    if (delBtn) confirmDeleteSchool(delBtn.dataset.schoolId, delBtn.dataset.schoolName);

    const toggleBtn = e.target.closest('.toggle-status-btn');
    if (toggleBtn) toggleSchoolStatus(toggleBtn);
});

// ── Form daftar sekolah baru ──────────────────────────────────
document.getElementById('provision-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const saKey = getSaKey(); if (!saKey) return;
    const btn       = document.getElementById('provision-btn');
    const resultEl  = document.getElementById('provision-result');
    const credBox   = document.getElementById('cred-box');

    resultEl.style.display = 'none';
    credBox.style.display  = 'none';
    btn.disabled = true; btn.textContent = 'Mendaftarkan…';

    const payload = {
        school_name:      document.getElementById('f-school-name').value.trim(),
        npsn:             document.getElementById('f-npsn').value.trim(),
        phone:            document.getElementById('f-phone').value.trim(),
        address:          document.getElementById('f-address').value.trim(),
        admin_name:       document.getElementById('f-admin-name').value.trim(),
        admin_identifier: document.getElementById('f-admin-id').value.trim(),
        slug:             document.getElementById('f-slug').value.trim() || null,
        logo_url:         document.getElementById('f-logo-url').value.trim() || null,
        primary_color:    document.getElementById('f-primary-color-hex').value.trim() || null,
        secondary_color:  document.getElementById('f-secondary-color-hex').value.trim() || null,
    };

    // SUP-05: slug ikut ke URL tenant (?school=<slug>). Format yang salah baru
    // ketahuan setelah sekolah terlanjur dibuat, jadi disaring di sini sebelum
    // request terkirim. Slug kosong dibiarkan — server yang men-generate.
    if (payload.slug) {
        const slugRe = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;
        const valid = slugRe.test(payload.slug)
            && payload.slug.length >= 3
            && payload.slug.length <= 50;
        if (!valid) {
            resultEl.textContent = '✗ Slug tidak valid. Gunakan huruf kecil, angka, '
                + 'dan tanda strip (-). Minimal 3 karakter, tidak boleh diawali '
                + 'atau diakhiri strip.';
            resultEl.className     = 'alert alert-danger';
            resultEl.style.display = 'block';
            btn.disabled = false;
            btn.textContent = 'Daftarkan Sekolah';
            return;
        }
    }

    try {
        const res  = await fetch(`${SUPABASE_URL}/functions/v1/provision-school`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'x-superadmin-key': saKey },
            body:    JSON.stringify(payload),
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);

        // Tampilkan kredensial
        document.getElementById('cred-school').textContent     = data.school_name;
        document.getElementById('cred-identifier').textContent = data.admin_identifier;
        document.getElementById('cred-password').textContent   = data.admin_password;
        credBox.style.display = 'block';

        resultEl.textContent    = `✓ Sekolah "${data.school_name}" berhasil didaftarkan.`;
        resultEl.className      = 'alert alert-success';
        resultEl.style.display  = 'block';

        e.target.reset();
        // SUP-19: form.reset() tidak selalu mengembalikan input[type=color] ke
        // nilai atribut value-nya. Set ulang manual, berikut hex input pasangannya.
        const DEF_PRIMARY = '#1a56db', DEF_SECONDARY = '#1e40af';
        const pcPicker = document.getElementById('f-primary-color');
        const pcHex    = document.getElementById('f-primary-color-hex');
        const scPicker = document.getElementById('f-secondary-color');
        const scHex    = document.getElementById('f-secondary-color-hex');
        if (pcPicker) pcPicker.value = DEF_PRIMARY;
        if (pcHex)    pcHex.value    = DEF_PRIMARY;
        if (scPicker) scPicker.value = DEF_SECONDARY;
        if (scHex)    scHex.value    = DEF_SECONDARY;
        await loadSchools();
    } catch (err) {
        resultEl.textContent   = `✗ ${err.message}`;
        resultEl.className     = 'alert alert-danger';
        resultEl.style.display = 'block';
    } finally {
        btn.disabled = false; btn.textContent = 'Daftarkan Sekolah';
    }
});

// ── Hapus sekolah ────────────────────────────────────────────
function confirmDeleteSchool(schoolId, schoolName) {
    openDeleteModal(schoolId, schoolName);
}

async function toggleSchoolStatus(btn) {
    const saKey = getSaKey(); if (!saKey) return;
    const schoolId   = btn.dataset.schoolId;
    const schoolName = btn.dataset.schoolName;
    const isActive   = btn.dataset.active === 'true';
    const aksi       = isActive ? 'nonaktifkan' : 'aktifkan kembali';

    if (!confirm(`${isActive ? 'Nonaktifkan' : 'Aktifkan'} sekolah "${schoolName}"?\n\n${isActive ? 'Semua pengguna sekolah ini tidak bisa login sampai diaktifkan kembali.' : 'Semua pengguna bisa login kembali.'}`)) return;

    btn.disabled = true;
    try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/update-school-status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'x-superadmin-key': saKey },
            body: JSON.stringify({ school_id: schoolId, is_active: !isActive }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? 'Gagal');
        await loadSchools();
        // SUP-13: beri konfirmasi sukses — sebelumnya daftar refresh diam-diam.
        const hintEl = document.getElementById('schools-hint');
        if (hintEl) {
            hintEl.textContent = `✓ Sekolah "${schoolName}" berhasil di${isActive ? 'nonaktifkan' : 'aktifkan'}.`;
            hintEl.style.display = 'block';
        }
    } catch (err) {
        alert(`Gagal ${aksi}: ${err.message}`);
        btn.disabled = false;
    }
}

// ── Modal reset password admin sekolah ───────────────────────
const resetModal       = document.getElementById('reset-modal');
const resetModalSchool = document.getElementById('reset-modal-school');
const resetConfirmView = document.getElementById('reset-confirm-view');
const resetResultView  = document.getElementById('reset-result-view');
const resetError       = document.getElementById('reset-error');

let _resetSchoolId = null;

function openResetModal(schoolId, schoolName) {
    _resetSchoolId = schoolId;
    resetModalSchool.textContent = schoolName;
    resetConfirmView.style.display = '';
    resetResultView.style.display  = 'none';
    resetError.style.display       = 'none';
    resetModal.style.display       = 'flex';
}

function closeResetModal() {
    resetModal.style.display = 'none';
    _resetSchoolId = null;
}

document.getElementById('reset-cancel-btn').addEventListener('click', closeResetModal);
document.getElementById('reset-close-btn').addEventListener('click', closeResetModal);
resetModal.addEventListener('click', e => { if (e.target === resetModal) closeResetModal(); });

document.getElementById('reset-confirm-btn').addEventListener('click', async () => {
    const saKey = getSaKey(); if (!saKey) return;
    const btn = document.getElementById('reset-confirm-btn');
    resetError.style.display = 'none';
    btn.disabled = true; btn.textContent = 'Mereset…';

    try {
        const res  = await fetch(`${SUPABASE_URL}/functions/v1/reset-admin-password`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'x-superadmin-key': saKey },
            body:    JSON.stringify({ school_id: _resetSchoolId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);

        document.getElementById('reset-cred-identifier').textContent = data.admin_identifier;
        document.getElementById('reset-cred-password').textContent   = data.admin_password;
        resetConfirmView.style.display = 'none';
        resetResultView.style.display  = '';
    } catch (err) {
        resetError.textContent   = `✗ ${err.message}`;
        resetError.style.display = 'block';
    } finally {
        btn.disabled = false; btn.textContent = 'Ya, Reset Sekarang';
    }
});

// ── Modal hapus sekolah permanen ─────────────────────────────
const deleteModal        = document.getElementById('delete-modal');
const deleteModalSchool  = document.getElementById('delete-modal-school');
const deleteConfirmInput = document.getElementById('delete-confirm-input');
const deleteConfirmBtn   = document.getElementById('delete-confirm-btn');
const deleteError        = document.getElementById('delete-error');

let _deleteSchoolId   = null;
let _deleteSchoolName = null;
let _deleteResumeFrom = null;

function openDeleteModal(schoolId, schoolName) {
    _deleteSchoolId   = schoolId;
    _deleteSchoolName = schoolName;
    _deleteResumeFrom = null;
    deleteModalSchool.textContent = schoolName;
    deleteConfirmInput.value      = '';
    deleteConfirmBtn.disabled     = true;
    deleteError.style.display     = 'none';
    deleteModal.style.display     = 'flex';
    deleteConfirmInput.focus();
}

function closeDeleteModal() {
    deleteModal.style.display = 'none';
    _deleteSchoolId   = null;
    _deleteSchoolName = null;
    _deleteResumeFrom = null;
    deleteConfirmInput.value  = '';
    deleteConfirmBtn.disabled = true;
}

deleteConfirmInput.addEventListener('input', () => {
    deleteConfirmBtn.disabled =
        deleteConfirmInput.value !== _deleteSchoolName;
});

document.getElementById('delete-cancel-btn')
    .addEventListener('click', closeDeleteModal);
deleteModal.addEventListener('click', e => {
    if (e.target === deleteModal) closeDeleteModal();
});

deleteConfirmBtn.addEventListener('click', async () => {
    const saKey = getSaKey(); if (!saKey) return;
    deleteError.style.display = 'none';
    deleteConfirmBtn.disabled = true;
    deleteConfirmBtn.textContent = 'Menghapus…';
    const namaSekolah = _deleteSchoolName;
    try {
        const res = await fetch(
            `${SUPABASE_URL}/functions/v1/delete-school`, {
            method: 'DELETE',
            headers: {
                'Content-Type':     'application/json',
                'x-superadmin-key': saKey,
            },
            body: JSON.stringify({
                school_id: _deleteSchoolId,
                ...(_deleteResumeFrom && { resume_from: _deleteResumeFrom }),
            }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(
            json?.error ?? json?.message ?? 'Gagal menghapus');

        if (json.status === 'partial' || json.status === 'timeout') {
            if (!json.resume_from) throw new Error('Server tidak mengirim checkpoint lanjutan');
            _deleteResumeFrom = json.resume_from;
            const lanjut = confirm(
                `Proses selesai sebagian (${json.deleted} dari ${json.total}). Lanjutkan?`
            );
            deleteConfirmBtn.disabled = false;
            deleteConfirmBtn.textContent = 'Lanjutkan Penghapusan';
            if (lanjut) deleteConfirmBtn.click();
            return;
        }

        if (json.status !== 'complete') {
            throw new Error(`Status penghapusan tidak dikenal: ${json.status ?? 'kosong'}`);
        }
        closeDeleteModal();
        await loadSchools();
        const hintEl = document.getElementById('schools-hint');
        if (hintEl) {
            hintEl.textContent = `✓ Sekolah "${namaSekolah}" berhasil dihapus.`;
            hintEl.style.display = 'block';
        }
    } catch (err) {
        deleteError.textContent = `✗ ${err.message}`;
        deleteError.style.display = 'block';
        deleteConfirmBtn.disabled = false;
        deleteConfirmBtn.textContent = 'Hapus Permanen';
    }
});

// ── Pemeliharaan Sistem (banner global) ──────────────────────
const maintBtn     = document.getElementById('maint-toggle-btn');
const maintMsgEl   = document.getElementById('maint-message');
const maintBanner  = document.getElementById('maint-status-banner');
const maintResult  = document.getElementById('maint-result');
let   maintActive  = false;

function renderMaintState() {
    maintBtn.textContent = maintActive ? '🔴 Matikan Pemeliharaan' : '🟢 Nyalakan Pemeliharaan';
    maintBtn.className   = 'btn btn-block ' + (maintActive ? 'btn-danger' : 'btn-primary');
    maintBanner.style.display = '';
    maintBanner.className = 'status-banner ' + (maintActive ? 'active' : 'inactive');
    maintBanner.textContent = maintActive ? '● Banner pemeliharaan AKTIF di semua portal' : '○ Banner tidak aktif';
}

async function loadMaintenance() {
    const saKey = getSaKey(); if (!saKey) return;
    try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/set-maintenance`, {
            headers: { 'x-superadmin-key': saKey },
        });
        if (!res.ok) throw new Error('Gagal memuat status');
        const data = await res.json();
        maintActive = !!data.active;
        if (data.message) maintMsgEl.value = data.message;
        renderMaintState();
    } catch (err) {
        maintBtn.textContent = 'Coba lagi';
        maintResult.textContent = err.message;
    }
}

maintBtn.addEventListener('click', async () => {
    const saKey = getSaKey(); if (!saKey) return;
    const next = !maintActive;
    const konfirmMsg = next
        ? 'Nyalakan banner pemeliharaan di SEMUA portal sekarang?'
        : 'Matikan banner pemeliharaan? Semua portal akan kembali normal.';
    if (!confirm(konfirmMsg)) return;
    maintBtn.disabled = true;
    maintResult.style.display = 'none';
    try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/set-maintenance`, {
            method:  'PATCH',
            headers: { 'x-superadmin-key': saKey, 'Content-Type': 'application/json' },
            body:    JSON.stringify({ active: next, message: maintMsgEl.value }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Gagal menyimpan');
        maintActive = next;
        renderMaintState();
        maintResult.className = 'alert alert-success';
        maintResult.textContent = next
            ? 'Banner pemeliharaan dinyalakan. Semua portal akan menampilkannya.'
            : 'Banner pemeliharaan dimatikan.';
        maintResult.style.display = 'block';
    } catch (err) {
        maintResult.className = 'alert alert-danger';
        maintResult.textContent = err.message;
        maintResult.style.display = 'block';
    } finally {
        maintBtn.disabled = false;
    }
});

// ── Monitoring Penyimpanan Database ──────────────────────────
async function loadStorage() {
    const saKey = getSaKey(); if (!saKey) return;
    const summary = document.getElementById('storage-summary');
    const table   = document.getElementById('storage-table');
    const body    = document.getElementById('storage-body');
    try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/platform-stats`, {
            headers: { 'x-superadmin-key': saKey },
        });
        if (!res.ok) throw new Error('Gagal memuat statistik penyimpanan');
        const data = await res.json();

        const mb = (data.db_size_bytes ?? 0) / (1024 * 1024);
        let color = '#16a34a', note = 'Aman';
        if (mb >= 500)      { color = '#dc2626'; note = 'Melewati kuota Free (±500 MB) — cek paket / bersihkan data'; }
        else if (mb >= 400) { color = '#b45309'; note = 'Mendekati kuota Free (±500 MB)'; }

        summary.innerHTML =
            `Ukuran database: <strong style="color:${color};font-size:16px">${esc(data.db_size_pretty)}</strong> ` +
            `<span style="color:${color}">— ${esc(note)}</span>`;

        body.innerHTML = (data.tables ?? []).map(t => `
            <tr>
                <td>${esc(t.name)}</td>
                <td style="text-align:right;white-space:nowrap">${esc(t.size_pretty)}</td>
                <td style="text-align:right">${t.est_rows < 0 ? '—' : Number(t.est_rows).toLocaleString('id-ID')}</td>
            </tr>`).join('');
        table.style.display = '';
    } catch (err) {
        summary.textContent = err.message;
    }
}

// Inisialisasi data dipicu oleh event dari auth.js setelah login sukses
document.addEventListener('superadmin-ready', () => {
    loadSchools();
    loadMaintenance();
    loadStorage();
});
