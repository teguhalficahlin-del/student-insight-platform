/**
 * @file admin/js/auth.js
 *
 * Wires the login form on admin/index.html.
 * Auto-detects role from login_identifier — no role selector.
 * After login: redirect to setup.html if onboarding is not
 * finished yet, otherwise to dashboard.html.
 */

import { supabase, loginWithIdentifier, getCurrentUserRow, getSchoolConfig } from './api.js';
import { applyBranding } from '../../shared/branding.js';
import { checkMustChangePassword } from '../../shared/change-password.js';

let _schoolId = null;

const form         = document.getElementById('login-form');
const identifierEl = document.getElementById('login-identifier');
const passwordEl   = document.getElementById('login-password');
const errorEl      = document.getElementById('login-error');
const submitBtn    = document.getElementById('login-submit');

// Tombol dinonaktifkan sampai konteks sekolah terkonfirmasi dari URL slug.
// Tanpa school_id, fn_resolve_login_email menolak — tidak ada fallback global.
submitBtn.disabled = true;

applyBranding().then(b => {
    _schoolId = b?.school_id ?? null;
    if (!_schoolId) {
        errorEl.textContent = 'Portal ini harus diakses melalui URL sekolah Anda. Hubungi administrator.';
        errorEl.style.display = 'block';
    } else {
        submitBtn.disabled = false;
    }
});

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    errorEl.style.display = 'none';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Masuk...';

    try {
        await loginWithIdentifier(identifierEl.value.trim(), passwordEl.value, _schoolId);

        const userRow = await getCurrentUserRow();
        if (!userRow) {
            errorEl.textContent = 'Akun tidak ditemukan.';
            errorEl.style.display = 'block';
            submitBtn.disabled = false;
            submitBtn.textContent = 'Masuk';
            return;
        }

        if (userRow.role_type === 'ORTU') {
            window.location.replace('../parent/portal.html');
            return;
        }

        if (userRow.role_type !== 'ADMINISTRATIVE') {
            errorEl.textContent = 'Akun ini tidak memiliki akses ke konsol admin.';
            errorEl.style.display = 'block';
            submitBtn.disabled = false;
            submitBtn.textContent = 'Masuk';
            return;
        }

        // Paksa ganti password jika di-reset oleh superadmin
        await checkMustChangePassword(supabase, userRow);

        let config = null;
        try {
            config = await getSchoolConfig();
        } catch (_) {
            errorEl.textContent = 'Gagal memeriksa status setup. Coba lagi.';
            errorEl.style.display = 'block';
            submitBtn.disabled = false;
            submitBtn.textContent = 'Masuk';
            return;
        }
        const setupDone = config?.setup_completed === true;
        window.location.replace(setupDone ? 'dashboard.html' : 'wizard.html');

    } catch (err) {
        errorEl.textContent = err.message ?? 'Login gagal. Periksa identifier dan password Anda.';
        errorEl.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Masuk';
    }
});
