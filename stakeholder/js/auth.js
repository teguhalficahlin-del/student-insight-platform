import { supabase, loginWithIdentifier, getCurrentUserRow, STAKEHOLDER_ROLES, isActiveStakeholder } from './api.js';
import { applyBranding } from '../../shared/branding.js';
import { checkMustChangePassword } from '../../shared/change-password.js';

let _schoolId = null;

const form     = document.getElementById('login-form');
const identEl  = document.getElementById('identifier');
const passEl   = document.getElementById('password');
const errEl    = document.getElementById('login-error');
const loginBtn = document.getElementById('login-btn');

// Tombol dinonaktifkan sampai konteks sekolah terkonfirmasi dari URL slug.
loginBtn.disabled = true;

// Kode login stakeholder SELALU disimpan huruf besar oleh wizard admin
// (admin/js/wizard.js: code.trim().toUpperCase()), sedangkan
// fn_resolve_login_email mencocokkan dengan operator = (exact match).
// Tanpa normalisasi yang sama di sini, "komite01" ditolak dengan pesan
// "kode tidak ditemukan" padahal akunnya ada dan aktif.
identEl.addEventListener('input', () => {
    const pos = identEl.selectionStart;
    identEl.value = identEl.value.toUpperCase();
    identEl.setSelectionRange(pos, pos);
});

applyBranding().then(b => {
    _schoolId = b?.school_id ?? null;
    if (!_schoolId) {
        errEl.textContent   = 'Portal ini harus diakses melalui URL sekolah Anda. Hubungi administrator.';
        errEl.style.display = 'block';
    } else {
        loginBtn.disabled = false;
    }
});

// Jika sudah login sebagai stakeholder, langsung ke dashboard
supabase.auth.getUser().then(async ({ data }) => {
    if (!data?.user) return;
    const row = await getCurrentUserRow();
    if (isActiveStakeholder(row)) {
        window.location.replace('dashboard.html');
    } else {
        await supabase.auth.signOut({ scope: 'local' });
    }
}).catch(() => {
    errEl.textContent = 'Gagal memeriksa sesi. Silakan masuk kembali.';
    errEl.style.display = 'block';
});

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.style.display  = 'none';
    loginBtn.disabled    = true;
    loginBtn.textContent = 'Memuat...';

    try {
        await loginWithIdentifier(identEl.value.trim().toUpperCase(), passEl.value, _schoolId);
        const row = await getCurrentUserRow();
        if (!row || !STAKEHOLDER_ROLES.includes(row.role_type)) {
            await supabase.auth.signOut({ scope: 'local' });
            throw new Error('Akun ini tidak memiliki akses ke Portal Stakeholder.');
        }
        if (!isActiveStakeholder(row)) {
            await supabase.auth.signOut({ scope: 'local' });
            throw new Error('Akun Anda telah dinonaktifkan. Hubungi admin sekolah.');
        }
        await checkMustChangePassword(supabase, row);
        window.location.replace('dashboard.html');
    } catch (err) {
        errEl.textContent    = err.message ?? 'Login gagal. Periksa kode akses Anda.';
        errEl.style.display  = 'block';
        loginBtn.disabled    = false;
        loginBtn.textContent = 'Masuk';
    }
});
