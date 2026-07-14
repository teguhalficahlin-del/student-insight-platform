/**
 * @file parent/js/auth.js
 *
 * Login handler for the parent portal.
 * Only allows ORTU role — others are rejected.
 */

import { supabase, loginWithIdentifier, getCurrentUserRow } from './api.js';
import { applyBranding } from '../../shared/branding.js';
import { checkMustChangePassword } from '../../shared/change-password.js';

let _schoolId = null;

const form         = document.getElementById('login-form');
const identifierEl = document.getElementById('login-identifier');
const passwordEl   = document.getElementById('login-password');
const errorEl      = document.getElementById('login-error');
const submitBtn    = document.getElementById('login-submit');

// Tombol dinonaktifkan sampai konteks sekolah terkonfirmasi dari URL slug.
submitBtn.disabled = true;

applyBranding().then(b => {
    _schoolId = b?.school_id ?? null;
    if (!_schoolId) {
        errorEl.textContent   = 'Portal ini harus diakses melalui URL sekolah Anda. Hubungi administrator.';
        errorEl.style.display = 'block';
    } else {
        submitBtn.disabled = false;
    }
});

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent   = '';
    errorEl.style.display = 'none';
    submitBtn.disabled    = true;
    submitBtn.textContent = 'Masuk...';

    try {
        await loginWithIdentifier(identifierEl.value.trim(), passwordEl.value, _schoolId);

        const userRow = await getCurrentUserRow();
        if (!userRow || userRow.role_type !== 'ORTU') {
            errorEl.textContent   = 'Akun ini tidak memiliki akses ke portal orang tua.';
            errorEl.style.display = 'block';
            submitBtn.disabled    = false;
            submitBtn.textContent = 'Masuk';
            return;
        }
        if (userRow.is_active === false) {
            errorEl.textContent   = 'Akun Anda telah dinonaktifkan. Hubungi admin sekolah.';
            errorEl.style.display = 'block';
            submitBtn.disabled    = false;
            submitBtn.textContent = 'Masuk';
            return;
        }
        await checkMustChangePassword(supabase, userRow);
        window.location.replace('portal.html');

    } catch (err) {
        errorEl.textContent   = err.message ?? 'Login gagal. Periksa NIK dan password Anda.';
        errorEl.style.display = 'block';
        submitBtn.disabled    = false;
        submitBtn.textContent = 'Masuk';
    }
});
