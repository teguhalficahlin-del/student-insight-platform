// TODO(CAT-2-B): duplikasi dari shared/branding.js — konsolidasikan ke shared/config.js
// saat shared module direfactor. Jika SUPABASE_URL/ANON berubah, update di sini juga.
const SUPABASE_URL  = 'https://xovvuuwexoweoqyltepq.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhvdnZ1dXdleG93ZW9xeWx0ZXBxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMDk0NzUsImV4cCI6MjA5Nzc4NTQ3NX0.mFwmVfSqYM7ITURtLC143BsurK6Yr31WFViJe5PFGN8';

const saKey = sessionStorage.getItem('sa_key');
if (!saKey) window.location.replace('index.html');

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
    sessionStorage.removeItem('sa_key');
    window.location.replace('index.html');
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
    </div>`;
}

// ── Load daftar sekolah ───────────────────────────────────────
async function loadSchools() {
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
            const colorSwatch = s.primary_color
                ? `<span class="color-swatch" style="background:${esc(s.primary_color)}"></span>${esc(s.primary_color)}`
                : '—';
            return `
            <div class="school-item">
              <button class="school-summary" type="button">
                <span class="school-summary-left">
                  ${s.primary_color ? `<span class="color-dot" style="background:${esc(s.primary_color)}"></span>` : ''}
                  <span class="school-summary-name">${esc(s.name)}</span>
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
                  <div class="meta-row"><dt>Login Admin</dt><dd><code class="slug-code">${esc(s.admin_identifier)}</code></dd></div>
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
                      ${!s.admin_identifier ? 'disabled title="Tidak ada akun admin"' : ''}>
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

        // Accordion toggle
        listEl.addEventListener('click', e => {
            const summary = e.target.closest('.school-summary');
            if (summary) {
                const item = summary.closest('.school-item');
                const isOpen = item.classList.contains('open');
                // tutup semua lain
                listEl.querySelectorAll('.school-item.open').forEach(el => el.classList.remove('open'));
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
                });
            }
            const delBtn = e.target.closest('.delete-school-btn');
            if (delBtn) confirmDeleteSchool(delBtn.dataset.schoolId, delBtn.dataset.schoolName);

            const toggleBtn = e.target.closest('.toggle-status-btn');
            if (toggleBtn) toggleSchoolStatus(toggleBtn);
        });
    } catch (err) {
        hintEl.textContent = `Gagal memuat: ${err.message}`;
    }
}

// ── Form daftar sekolah baru ──────────────────────────────────
document.getElementById('provision-form').addEventListener('submit', async (e) => {
    e.preventDefault();
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
async function confirmDeleteSchool(schoolId, schoolName) {
    const konfirmasi = prompt(
        `⚠️ HAPUS PERMANEN: ${schoolName}\n\n` +
        `Semua data sekolah ini (guru, siswa, absensi, observasi) akan dihapus selamanya.\n\n` +
        `Ketik nama sekolah persis untuk konfirmasi:\n${schoolName}`
    );
    if (konfirmasi !== schoolName) {
        if (konfirmasi !== null) alert('Nama tidak cocok. Penghapusan dibatalkan.');
        return;
    }

    try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/delete-school`, {
            method: 'DELETE',
            headers: {
                'Content-Type':    'application/json',
                'x-superadmin-key': saKey,
            },
            body: JSON.stringify({ school_id: schoolId }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? json?.message ?? 'Gagal menghapus');
        alert(`Sekolah "${schoolName}" berhasil dihapus.`);
        loadSchools();
    } catch (err) {
        alert(`Error: ${err.message}`);
    }
}

async function toggleSchoolStatus(btn) {
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
        loadSchools();
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

loadSchools();

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
        maintStatus.textContent = err.message;
    }
}

maintBtn.addEventListener('click', async () => {
    const next = !maintActive;
    if (next && !confirm('Nyalakan banner pemeliharaan di SEMUA portal sekarang?')) return;
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

loadMaintenance();

// ── Monitoring Penyimpanan Database ──────────────────────────
async function loadStorage() {
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

loadStorage();
