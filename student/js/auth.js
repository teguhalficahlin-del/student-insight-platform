import { supabase, loginWithIdentifier, getCurrentUserRow, STUDENT_ROLES } from './api.js';
import { applyBranding } from '../../shared/branding.js';
applyBranding();

const form     = document.getElementById('login-form');
const identEl  = document.getElementById('identifier');
const passEl   = document.getElementById('password');
const errEl    = document.getElementById('login-error');
const loginBtn = document.getElementById('login-btn');

// Jika sudah login sebagai siswa, langsung ke dashboard
supabase.auth.getUser().then(async ({ data }) => {
    if (!data?.user) return;
    const row = await getCurrentUserRow();
    if (row && STUDENT_ROLES.includes(row.role_type)) {
        window.location.href = 'dashboard.html';
    }
});

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.style.display  = 'none';
    loginBtn.disabled    = true;
    loginBtn.textContent = 'Memuat...';

    try {
        await loginWithIdentifier(identEl.value.trim(), passEl.value);
        const row = await getCurrentUserRow();
        if (!row || !STUDENT_ROLES.includes(row.role_type)) {
            await supabase.auth.signOut();
            throw new Error('Akun ini tidak memiliki akses ke Portal Siswa.');
        }
        window.location.href = 'dashboard.html';
    } catch (err) {
        errEl.textContent    = err.message;
        errEl.style.display  = 'block';
        loginBtn.disabled    = false;
        loginBtn.textContent = 'Masuk';
    }
});
