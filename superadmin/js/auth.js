const SUPABASE_URL = 'https://xovvuuwexoweoqyltepq.supabase.co';

document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const key    = document.getElementById('sa-key').value.trim();
    const errEl  = document.getElementById('login-error');
    const btn    = document.getElementById('login-btn');
    errEl.style.display = 'none';
    btn.disabled = true; btn.textContent = 'Memverifikasi…';

    // Verifikasi key dengan memanggil provision-school dengan body kosong
    // — jika key salah dapat 401, jika benar dapat 400 (body tidak lengkap)
    try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/provision-school`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-superadmin-key': key },
            body: JSON.stringify({}),
        });
        if (res.status === 401) throw new Error('Key salah. Coba lagi.');

        // Status 400 = key benar tapi body tidak lengkap — itu yang kita harapkan
        sessionStorage.setItem('sa_key', key);
        window.location.href = 'dashboard.html';
    } catch (err) {
        errEl.textContent    = err.message ?? 'Gagal menghubungi server.';
        errEl.style.display  = 'block';
        btn.disabled = false; btn.textContent = 'Masuk';
    }
});
