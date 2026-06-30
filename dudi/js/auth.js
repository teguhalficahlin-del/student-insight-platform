/**
 * @file dudi/js/auth.js
 * Login handler Portal DUDI.
 * Gate: role_type = 'DUDI'.
 */

import { loginWithIdentifier, getCurrentUserRow, isDudi } from './api.js';

const form         = document.getElementById('login-form');
const identifierEl = document.getElementById('login-identifier');
const passwordEl   = document.getElementById('login-password');
const errorEl      = document.getElementById('login-error');
const submitBtn    = document.getElementById('login-submit');

function showError(msg) {
    errorEl.textContent = msg;
    errorEl.style.display = 'block';
    submitBtn.disabled = false;
    submitBtn.textContent = 'Masuk';
}

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.style.display = 'none';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Masuk...';

    try {
        await loginWithIdentifier(identifierEl.value.trim(), passwordEl.value);

        const userRow = await getCurrentUserRow();
        if (!isDudi(userRow)) {
            showError('Akun ini bukan akun DUDI. Hubungi sekolah jika ada masalah.');
            return;
        }

        window.location.href = 'dashboard.html';
    } catch (err) {
        showError(err.message ?? 'Login gagal. Periksa ID login dan password Anda.');
    }
});
