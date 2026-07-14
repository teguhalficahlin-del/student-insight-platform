/**
 * @file dudi/js/auth.js
 * Login handler Portal DUDI.
 * Gate: role_type = 'DUDI'.
 */

import { supabase, loginWithIdentifier, getCurrentUserRow, isDudi } from './api.js';
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

function showError(msg) {
    errorEl.textContent   = msg;
    errorEl.style.display = 'block';
    submitBtn.disabled    = false;
    submitBtn.textContent = 'Masuk';
}

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.style.display = 'none';
    submitBtn.disabled    = true;
    submitBtn.textContent = 'Masuk...';

    try {
        await loginWithIdentifier(identifierEl.value.trim(), passwordEl.value, _schoolId);

        const userRow = await getCurrentUserRow();
        if (!isDudi(userRow)) {
            showError('Akun ini bukan akun DUDI. Hubungi sekolah jika ada masalah.');
            return;
        }
        if (userRow.is_active === false) {
            showError('Akun Anda telah dinonaktifkan. Hubungi admin sekolah.');
            return;
        }
        await checkMustChangePassword(supabase, userRow);
        window.location.replace('dashboard.html');
    } catch (err) {
        showError(err.message ?? 'Login gagal. Periksa ID login dan password Anda.');
    }
});
