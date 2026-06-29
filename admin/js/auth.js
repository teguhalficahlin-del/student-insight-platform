/**
 * @file admin/js/auth.js
 *
 * Wires the login form on admin/index.html.
 * Auto-detects role from login_identifier — no role selector.
 * After login: redirect to setup.html if onboarding is not
 * finished yet, otherwise to dashboard.html.
 */

import { loginWithIdentifier, getCurrentUserRow } from './api.js';

const form        = document.getElementById('login-form');
const identifierEl = document.getElementById('login-identifier');
const passwordEl   = document.getElementById('login-password');
const errorEl       = document.getElementById('login-error');
const submitBtn     = document.getElementById('login-submit');

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    errorEl.style.display = 'none';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Masuk...';

    try {
        await loginWithIdentifier(identifierEl.value.trim(), passwordEl.value);

        const userRow = await getCurrentUserRow();
        if (!userRow || userRow.role_type !== 'ADMINISTRATIVE') {
            errorEl.textContent = 'Akun ini tidak memiliki akses ke konsol admin.';
            errorEl.style.display = 'block';
            submitBtn.disabled = false;
            submitBtn.textContent = 'Masuk';
            return;
        }

        window.location.href = 'dashboard.html';

    } catch (err) {
        errorEl.textContent = err.message ?? 'Login gagal. Periksa identifier dan password Anda.';
        errorEl.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Masuk';
    }
});
