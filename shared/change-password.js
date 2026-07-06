/**
 * @file shared/change-password.js
 *
 * Modul reusable untuk "Ganti Password" di semua portal aktor.
 *
 * Gunakan:
 *   import { initChangePassword, checkMustChangePassword } from '../../shared/change-password.js';
 *
 * checkMustChangePassword(supabase, user):
 *   Jika user.must_change_password === true, tampilkan modal wajib
 *   ganti password. User tidak bisa menutup modal sampai ganti.
 *
 * initChangePassword(supabase, triggerSelector):
 *   Pasang click handler pada elemen yang cocok triggerSelector
 *   (mis. '#btn-ganti-password') untuk membuka dialog ganti password
 *   opsional (user sudah login normal).
 */

const MIN_LEN = 8;

function createModal(title, hint, forceMode = false) {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:9999';
    el.innerHTML = `
        <div style="background:var(--color-surface,#fff);border-radius:12px;padding:24px;max-width:360px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,.25)">
            <h4 style="margin:0 0 6px">${title}</h4>
            ${hint ? `<p class="hint" style="margin:0 0 16px">${hint}</p>` : ''}
            ${!forceMode ? `
            <div class="field" style="margin-bottom:12px">
                <label class="label" for="cp-old">Password Lama</label>
                <input id="cp-old" type="password" class="input" autocomplete="current-password">
            </div>` : ''}
            <div class="field" style="margin-bottom:12px">
                <label class="label" for="cp-new">Password Baru (min. ${MIN_LEN} karakter)</label>
                <input id="cp-new" type="password" class="input" autocomplete="new-password">
            </div>
            <div class="field" style="margin-bottom:16px">
                <label class="label" for="cp-confirm">Konfirmasi Password Baru</label>
                <input id="cp-confirm" type="password" class="input" autocomplete="new-password">
            </div>
            <p id="cp-status" style="font-size:13px;display:none;margin-bottom:12px"></p>
            <div style="display:flex;gap:8px;justify-content:flex-end">
                ${!forceMode ? `<button id="cp-cancel" class="btn btn-secondary btn-sm">Batal</button>` : ''}
                <button id="cp-submit" class="btn btn-sm" style="background:var(--color-primary,#1d4ed8);color:#fff">Simpan Password</button>
            </div>
        </div>`;
    return el;
}

function showStatus(el, msg, ok) {
    el.textContent = msg;
    el.style.color = ok ? 'var(--color-success,#15803d)' : 'var(--color-danger,#dc2626)';
    el.style.display = 'block';
}

/**
 * Cek must_change_password. Jika true, paksa user ganti password
 * sebelum bisa mengakses apapun. Modal tidak bisa ditutup.
 */
export async function checkMustChangePassword(supabase, userRow) {
    if (!userRow?.must_change_password) return;

    return new Promise(resolve => {
        const modal = createModal(
            'Ganti Password',
            'Admin telah mereset password Anda. Silakan set password baru sebelum melanjutkan.',
            true,
        );
        document.body.appendChild(modal);

        const newInput  = modal.querySelector('#cp-new');
        const confInput = modal.querySelector('#cp-confirm');
        const status    = modal.querySelector('#cp-status');
        const submitBtn = modal.querySelector('#cp-submit');

        submitBtn.addEventListener('click', async () => {
            const pw   = newInput.value;
            const conf = confInput.value;
            if (pw.length < MIN_LEN) { showStatus(status, `Password minimal ${MIN_LEN} karakter.`, false); return; }
            if (pw !== conf)         { showStatus(status, 'Konfirmasi password tidak cocok.', false); return; }

            submitBtn.disabled = true; submitBtn.textContent = 'Menyimpan…';
            const { error } = await supabase.auth.updateUser({ password: pw });
            if (error) {
                showStatus(status, 'Gagal menyimpan. Coba lagi.', false);
                submitBtn.disabled = false; submitBtn.textContent = 'Simpan Password';
                return;
            }
            // Konfirmasi via RPC server-side — satu-satunya jalur resmi
            // yang boleh mengubah must_change_password dan password_changed_at.
            await supabase.rpc('fn_confirm_password_changed');

            showStatus(status, '✓ Password berhasil diubah!', true);
            submitBtn.style.display = 'none';
            setTimeout(() => { modal.remove(); resolve(); }, 1200);
        });
    });
}

/**
 * Pasang tombol "Ganti Password" opsional (saat user sudah login normal).
 * triggerSelector: CSS selector untuk elemen pemicu, mis. '#btn-ganti-password'.
 */
export function initChangePassword(supabase, triggerSelector) {
    const trigger = document.querySelector(triggerSelector);
    if (!trigger) return;

    trigger.addEventListener('click', () => {
        const modal = createModal('Ganti Password', '', false);
        document.body.appendChild(modal);

        const oldInput  = modal.querySelector('#cp-old');
        const newInput  = modal.querySelector('#cp-new');
        const confInput = modal.querySelector('#cp-confirm');
        const status    = modal.querySelector('#cp-status');
        const submitBtn = modal.querySelector('#cp-submit');
        const cancelBtn = modal.querySelector('#cp-cancel');

        cancelBtn?.addEventListener('click', () => modal.remove());

        submitBtn.addEventListener('click', async () => {
            const oldPw = oldInput?.value ?? '';
            const pw    = newInput.value;
            const conf  = confInput.value;
            if (pw.length < MIN_LEN) { showStatus(status, `Password minimal ${MIN_LEN} karakter.`, false); return; }
            if (pw !== conf)         { showStatus(status, 'Konfirmasi password tidak cocok.', false); return; }

            submitBtn.disabled = true; submitBtn.textContent = 'Menyimpan…';

            // Re-auth dengan password lama dulu (jika diisi)
            if (oldPw) {
                const { data: { user } } = await supabase.auth.getUser();
                const { error: reAuthErr } = await supabase.auth.signInWithPassword({
                    email: user?.email ?? '', password: oldPw,
                });
                if (reAuthErr) {
                    showStatus(status, 'Password lama tidak cocok.', false);
                    submitBtn.disabled = false; submitBtn.textContent = 'Simpan Password';
                    return;
                }
            }

            const { error } = await supabase.auth.updateUser({ password: pw });
            if (error) {
                showStatus(status, 'Gagal menyimpan. Coba lagi.', false);
                submitBtn.disabled = false; submitBtn.textContent = 'Simpan Password';
                return;
            }

            // Konfirmasi via RPC server-side — satu-satunya jalur resmi
            // yang boleh mengubah must_change_password dan password_changed_at.
            await supabase.rpc('fn_confirm_password_changed');

            showStatus(status, '✓ Password berhasil diubah!', true);
            submitBtn.style.display = 'none';
            cancelBtn.textContent = 'Tutup';
        });
    });
}
