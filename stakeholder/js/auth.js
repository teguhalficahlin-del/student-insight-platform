import { supabase, loginWithIdentifier, getCurrentUserRow, STAKEHOLDER_ROLES } from './api.js';
import { applyBranding } from '../../shared/branding.js';
let _schoolId = null;
applyBranding().then(b => { _schoolId = b?.school_id ?? null; });

const form     = document.getElementById('login-form');
const identEl  = document.getElementById('identifier');
const passEl   = document.getElementById('password');
const errEl    = document.getElementById('login-error');
const loginBtn = document.getElementById('login-btn');

// Jika sudah login sebagai stakeholder, langsung ke dashboard
supabase.auth.getUser().then(async ({ data }) => {
    if (!data?.user) return;
    const row = await getCurrentUserRow();
    if (row && STAKEHOLDER_ROLES.includes(row.role_type)) {
        window.location.href = 'dashboard.html';
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
        if (!row || !STAKEHOLDER_ROLES.includes(row.role_type)) {
            await supabase.auth.signOut();
            throw new Error('Akun ini tidak memiliki akses ke Portal Stakeholder.');
        }
        window.location.href = 'dashboard.html';
    } catch (err) {
        const isOurMsg = err.message?.startsWith('Akun ini');
        errEl.textContent    = isOurMsg ? err.message : 'Login gagal. Periksa kode akses Anda.';
        errEl.style.display  = 'block';
        loginBtn.disabled    = false;
        loginBtn.textContent = 'Masuk';
    }
});
