/**
 * @file kaprodi/js/auth.js
 *
 * Login handler dashboard Kaprodi (PKL).
 * Hanya Kaprodi (role KAPRODI atau peran rangkap via kaprodi_program_id)
 * yang boleh masuk.
 */

import { loginWithIdentifier, getCurrentUserRow, isKaprodi } from './api.js';

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
    errorEl.textContent = '';
    errorEl.style.display = 'none';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Masuk...';

    try {
        await loginWithIdentifier(identifierEl.value.trim(), passwordEl.value);

        const userRow = await getCurrentUserRow();
        if (!isKaprodi(userRow)) {
            showError('Akun ini tidak memiliki akses ke dashboard Kaprodi.');
            return;
        }

        window.location.href = 'dashboard.html';

    } catch (err) {
        showError(err.message ?? 'Login gagal. Periksa NIP dan password Anda.');
    }
});
