import { supabase, loginWithIdentifier, getCurrentUserRow, getMyStudent, STUDENT_ROLES, ACTIVE_STUDENT_STATUSES } from './api.js';
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

// Jika sudah login sebagai siswa aktif, langsung ke dashboard
supabase.auth.getUser().then(async ({ data }) => {
    if (!data?.user) return;
    const row = await getCurrentUserRow();
    if (row && STUDENT_ROLES.includes(row.role_type) && row.is_active !== false) {
        const s = await getMyStudent(row.user_id).catch(() => null);
        if (s && !ACTIVE_STUDENT_STATUSES.includes(s.student_status)) return; // alumni/keluar: jangan auto-masuk
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
        if (!row || !STUDENT_ROLES.includes(row.role_type)) {
            await supabase.auth.signOut();
            throw new Error('Akun ini tidak memiliki akses ke Portal Siswa.');
        }
        if (row.is_active === false) {
            await supabase.auth.signOut();
            throw new Error('Akun Anda telah dinonaktifkan. Hubungi admin sekolah.');
        }
        const student = await getMyStudent(row.user_id).catch(() => null);
        if (student && !ACTIVE_STUDENT_STATUSES.includes(student.student_status)) {
            await supabase.auth.signOut();
            throw new Error(student.student_status === 'LULUS'
                ? 'Akun ini sudah berstatus alumni (lulus). Portal Siswa tidak lagi tersedia.'
                : 'Akun siswa ini sudah tidak aktif. Hubungi admin sekolah.');
        }
        await checkMustChangePassword(supabase, row);
        window.location.replace('dashboard.html');
    } catch (err) {
        errEl.textContent    = err.message ?? 'Login gagal. Periksa NIS dan password Anda.';
        errEl.style.display  = 'block';
        loginBtn.disabled    = false;
        loginBtn.textContent = 'Masuk';
    }
});
