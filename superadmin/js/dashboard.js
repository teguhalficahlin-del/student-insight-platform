const SUPABASE_URL  = 'https://xovvuuwexoweoqyltepq.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhvdnZ1dXdleG93ZW9xeWx0ZXBxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMDk0NzUsImV4cCI6MjA5Nzc4NTQ3NX0.mFwmVfSqYM7ITURtLC143BsurK6Yr31WFViJe5PFGN8';

const saKey = sessionStorage.getItem('sa_key');
if (!saKey) window.location.href = 'index.html';

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
    window.location.href = 'index.html';
});

// ── Load daftar sekolah ───────────────────────────────────────
async function loadSchools() {
    const hintEl  = document.getElementById('schools-hint');
    const tableEl = document.getElementById('schools-table');
    const tbody   = document.getElementById('schools-body');

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
        tableEl.style.display = '';
        const BASE = location.origin + location.pathname.replace(/superadmin\/.*$/, '');
        tbody.innerHTML = data.map(s => {
            const adminUrl = s.slug ? `${BASE}admin/?school=${esc(s.slug)}` : null;
            const slugCell = adminUrl
                ? `<div style="display:flex;flex-direction:column;gap:4px">
                     <code style="font-size:12px;color:var(--color-warning)">?school=${esc(s.slug)}</code>
                     <div style="display:flex;gap:6px">
                       <button class="btn btn-sm btn-secondary copy-url-btn" data-url="${adminUrl}" style="padding:2px 8px;font-size:11px">Salin Link</button>
                       <a href="${adminUrl}" target="_blank" class="btn btn-sm btn-secondary" style="padding:2px 8px;font-size:11px">Buka ↗</a>
                     </div>
                   </div>`
                : '—';
            return `<tr>
            <td>${esc(s.name)}</td>
            <td class="col-hide-mobile" data-label="NPSN">${esc(s.npsn)}</td>
            <td data-label="Link Login">${slugCell}</td>
            <td class="col-hide-mobile" data-label="Warna">${s.primary_color ? `<span style="display:inline-flex;align-items:center;gap:6px"><span style="width:14px;height:14px;border-radius:3px;background:${esc(s.primary_color)};display:inline-block"></span>${esc(s.primary_color)}</span>` : '—'}</td>
            <td class="col-hide-mobile" data-label="Telepon">${esc(s.phone)}</td>
            <td data-label="Status"><span class="badge ${s.is_active ? 'badge-active' : 'badge-inactive'}">${s.is_active ? 'Aktif' : 'Nonaktif'}</span></td>
            <td class="col-hide-mobile" data-label="Terdaftar">${fmt(s.created_at)}</td>
            <td data-label="aksi" style="display:flex;flex-direction:column;gap:6px;padding:10px 8px">
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
            </td>
        </tr>`;
        }).join('');

        // Event delegation
        tbody.addEventListener('click', e => {
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
