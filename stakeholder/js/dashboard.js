/**
 * @file stakeholder/js/dashboard.js
 * Dashboard Portal Stakeholder — ringkasan agregat sekolah (view-only).
 */

import { applyBrandingById, getLoginUrl } from '../../shared/branding.js';
import { checkMustChangePassword } from '../../shared/change-password.js';
import { initLoginGuard } from '../../shared/login-guard.js';
import {
    supabase, logout, getCurrentUserRow, STAKEHOLDER_ROLES,
    getStakeholderSummary,
} from './api.js';

function fmtNum(n)  { return (n ?? 0).toLocaleString('id-ID'); }
function fmtPct(n)  { return (n === null || n === undefined) ? '—' : n + '%'; }
function fmtTime(d) {
    if (!d) return '—';
    return 'Diperbarui ' + new Date(d).toLocaleString('id-ID', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
}

async function init() {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) { window.location.replace(getLoginUrl()); return; }

    const user = await getCurrentUserRow(auth.user);
    if (!user || !STAKEHOLDER_ROLES.includes(user.role_type)) {
        await supabase.auth.signOut();
        window.location.replace(getLoginUrl());
        return;
    }

    document.getElementById('hdr-name').textContent = user.full_name;
    document.getElementById('loading').style.display = 'none';
    document.getElementById('app').style.display     = 'block';
    await Promise.all([
        applyBrandingById(user.school_id, supabase),
        checkMustChangePassword(supabase, user),
        initLoginGuard(supabase, user),
        loadSummary(),
    ]);
    document.getElementById('refresh-btn').onclick = loadSummary;
}

async function loadSummary() {
    const btn    = document.getElementById('refresh-btn');
    const errBox = document.getElementById('error-box');
    btn.disabled = true;
    btn.textContent = 'Memuat…';
    errBox.style.display = 'none';

    try {
        const s = await getStakeholderSummary();
        document.getElementById('st-siswa').textContent          = fmtNum(s.total_siswa);
        document.getElementById('st-pkl').textContent            = fmtNum(s.total_pkl);
        document.getElementById('st-staf').textContent           = fmtNum(s.total_staf);
        document.getElementById('st-program').textContent        = fmtNum(s.total_program);
        document.getElementById('st-kelas').textContent          = fmtNum(s.total_kelas);
        document.getElementById('st-kehadiran-bulan').textContent = fmtPct(s.kehadiran_bulan_pct);
        document.getElementById('st-sesi').textContent           = fmtNum(s.sesi_hari_ini);
        document.getElementById('st-hadir-hari').textContent     = fmtNum(s.hadir_hari_ini);
        document.getElementById('updated-at').textContent        = fmtTime(s.updated_at);
    } catch (err) {
        errBox.textContent   = 'Gagal memuat ringkasan. Periksa koneksi lalu coba lagi.';
        errBox.style.display = 'block';
    } finally {
        btn.disabled    = false;
        btn.textContent = 'Muat Ulang';
    }
}

document.getElementById('logout-btn')?.addEventListener('click', async () => {
    await logout();
    window.location.replace(getLoginUrl());
});

init();
