const SUPABASE_URL  = 'https://xovvuuwexoweoqyltepq.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhvdnZ1dXdleG93ZW9xeWx0ZXBxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyMDk0NzUsImV4cCI6MjA5Nzc4NTQ3NX0.mFwmVfSqYM7ITURtLC143BsurK6Yr31WFViJe5PFGN8';

const saKey = sessionStorage.getItem('sa_key');
if (!saKey) window.location.href = 'index.html';

function esc(s) {
    const el = document.createElement('span');
    el.textContent = s ?? '—';
    return el.innerHTML;
}
function fmt(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('id-ID', { day:'numeric', month:'short', year:'numeric' });
}

// ── Logout ────────────────────────────────────────────────────
document.getElementById('logout-btn').addEventListener('click', () => {
    sessionStorage.removeItem('sa_key');
    window.location.href = 'index.html';
});

// ── Load daftar sekolah ───────────────────────────────────────
async function loadSchools() {
    const hintEl  = document.getElementById('schools-hint');
    const tableEl = document.getElementById('schools-table');
    const tbody   = document.getElementById('schools-body');

    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/schools?select=school_id,name,npsn,phone,is_active,created_at&order=created_at.desc`, {
            headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
        });
        const data = await res.json();

        if (!Array.isArray(data) || data.length === 0) {
            hintEl.textContent = 'Belum ada sekolah terdaftar.';
            return;
        }

        hintEl.style.display = 'none';
        tableEl.style.display = '';
        tbody.innerHTML = data.map(s => `<tr>
            <td>${esc(s.name)}</td>
            <td>${esc(s.npsn)}</td>
            <td>${esc(s.phone)}</td>
            <td><span class="badge ${s.is_active ? 'badge-active' : 'badge-inactive'}">${s.is_active ? 'Aktif' : 'Nonaktif'}</span></td>
            <td>${fmt(s.created_at)}</td>
        </tr>`).join('');
    } catch (err) {
        hintEl.textContent = `Gagal memuat: ${err.message}`;
    }
}

// ── Form daftar sekolah baru ──────────────────────────────────
document.getElementById('provision-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn       = document.getElementById('provision-btn');
    const resultEl  = document.getElementById('provision-result');
    const credBox   = document.getElementById('cred-box');

    resultEl.style.display = 'none';
    credBox.style.display  = 'none';
    btn.disabled = true; btn.textContent = 'Mendaftarkan…';

    const payload = {
        school_name:      document.getElementById('f-school-name').value.trim(),
        npsn:             document.getElementById('f-npsn').value.trim(),
        phone:            document.getElementById('f-phone').value.trim(),
        address:          document.getElementById('f-address').value.trim(),
        admin_name:       document.getElementById('f-admin-name').value.trim(),
        admin_identifier: document.getElementById('f-admin-id').value.trim(),
    };

    try {
        const res  = await fetch(`${SUPABASE_URL}/functions/v1/provision-school`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', 'x-superadmin-key': saKey },
            body:    JSON.stringify(payload),
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);

        // Tampilkan kredensial
        document.getElementById('cred-school').textContent     = data.school_name;
        document.getElementById('cred-identifier').textContent = data.admin_identifier;
        document.getElementById('cred-password').textContent   = data.admin_password;
        credBox.style.display = 'block';

        resultEl.textContent    = `✓ Sekolah "${data.school_name}" berhasil didaftarkan.`;
        resultEl.className      = 'alert alert-success';
        resultEl.style.display  = 'block';

        e.target.reset();
        await loadSchools();
    } catch (err) {
        resultEl.textContent   = `✗ ${err.message}`;
        resultEl.className     = 'alert alert-danger';
        resultEl.style.display = 'block';
    } finally {
        btn.disabled = false; btn.textContent = 'Daftarkan Sekolah';
    }
});

loadSchools();
