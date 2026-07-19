import { supabase, loginWithIdentifier, getCurrentUserRow, GURU_ROLES } from './api.js';
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

applyBranding().then(b => {
    _schoolId = b?.school_id ?? null;
    if (!_schoolId) {
        errEl.textContent   = 'Portal ini harus diakses melalui URL sekolah Anda. Hubungi administrator.';
        errEl.style.display = 'block';
    } else {
        loginBtn.disabled = false;
    }
});

// Jika sudah login, redirect ke dashboard
supabase.auth.getUser().then(async ({ data }) => {
    if (!data?.user) return;
    const row = await getCurrentUserRow();
    if (row && GURU_ROLES.includes(row.role_type) && row.is_active !== false) {
        window.location.replace('dashboard.html');
    }
});

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.style.display  = 'none';
    loginBtn.disabled    = true;
    loginBtn.textContent = 'Memuat...';

    try {
        await loginWithIdentifier(identEl.value.trim(), passEl.value, _schoolId);
        const row = await getCurrentUserRow();
        if (!row || !GURU_ROLES.includes(row.role_type)) {
            await supabase.auth.signOut();
            throw new Error('Akun ini tidak memiliki akses ke Portal Guru.');
        }
        if (row.is_active === false) {
            await supabase.auth.signOut();
            throw new Error('Akun Anda telah dinonaktifkan. Hubungi admin sekolah.');
        }
        await checkMustChangePassword(supabase, row);
        sessionStorage.setItem('pwa_show_install_banner', '1');
        window.location.replace('dashboard.html');
    } catch (err) {
        errEl.textContent    = err.message ?? 'Login gagal. Periksa NIP/NIK dan password Anda.';
        errEl.style.display  = 'block';
        loginBtn.disabled    = false;
        loginBtn.textContent = 'Masuk';
    }
});
