const SUPABASE_URL = 'https://xovvuuwexoweoqyltepq.supabase.co';

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

        sessionStorage.setItem('sa_key', key);
        window.location.replace('dashboard.html');
    } catch (err) {
        errEl.textContent    = err.message ?? 'Gagal menghubungi server.';
        errEl.style.display  = 'block';
        btn.disabled = false; btn.textContent = 'Masuk';
    }
});
