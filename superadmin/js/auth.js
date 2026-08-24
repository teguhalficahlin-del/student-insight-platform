const SUPABASE_URL = 'https://xovvuuwexoweoqyltepq.supabase.co';

let _saKey = null;
export function getSuperadminKey() { return _saKey; }
export function setSuperadminKey(k) { _saKey = k; }

function showDashboard() {
    document.getElementById('login-view').style.display = 'none';
    document.getElementById('dashboard-view').style.display = '';
    document.dispatchEvent(new CustomEvent('superadmin-ready'));
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const key    = document.getElementById('sa-key').value.trim();
    const errEl  = document.getElementById('login-error');
    const btn    = document.getElementById('login-btn');
    errEl.style.display = 'none';
    btn.disabled = true; btn.textContent = 'Memverifikasi…';

    // Verifikasi key via list-schools — endpoint yang memang dirancang
    // untuk superadmin (bukan efek samping). 200 = valid, 401 = salah.
    try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/list-schools`, {
            headers: { 'x-superadmin-key': key },
        });
        if (res.status === 401) throw new Error('Key salah. Coba lagi.');
        if (!res.ok) throw new Error('Gagal menghubungi server. Coba lagi.');

        // Key disimpan di module variable — tidak di sessionStorage
        // Refresh halaman = login ulang (by design, SUP-03 fix)
        setSuperadminKey(key);
        showDashboard();
    } catch (err) {
        errEl.textContent    = err.message ?? 'Gagal menghubungi server.';
        errEl.style.display  = 'block';
        btn.disabled = false; btn.textContent = 'Masuk';
    }
});
