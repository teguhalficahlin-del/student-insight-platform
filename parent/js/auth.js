/**
 * @file parent/js/auth.js
 *
 * Login handler for the parent portal.
 * Only allows ORTU role — others are rejected.
 */

import { loginWithIdentifier, getCurrentUserRow } from './api.js';

const form         = document.getElementById('login-form');
const identifierEl = document.getElementById('login-identifier');
const passwordEl   = document.getElementById('login-password');
const errorEl      = document.getElementById('login-error');
const submitBtn    = document.getElementById('login-submit');

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    errorEl.style.display = 'none';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Masuk...';

    try {
        await loginWithIdentifier(identifierEl.value.trim(), passwordEl.value);

        const userRow = await getCurrentUserRow();
        if (!userRow || userRow.role_type !== 'ORTU') {
            errorEl.textContent = 'Akun ini tidak memiliki akses ke portal orang tua.';
            errorEl.style.display = 'block';
            submitBtn.disabled = false;
            submitBtn.textContent = 'Masuk';
            return;
        }

        window.location.href = 'portal.html';

    } catch (err) {
        errorEl.textContent = err.message ?? 'Login gagal. Periksa NIK dan password Anda.';
        errorEl.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Masuk';
    }
});
