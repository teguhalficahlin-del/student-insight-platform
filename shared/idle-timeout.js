/**
 * @file shared/idle-timeout.js
 *
 * Auto-logout untuk perangkat bersama di sekolah (lab/ruang guru/TU).
 * Skenario nyata: seseorang login lalu pergi tanpa klik "Keluar" — orang
 * berikutnya melihat/mengubah data sensitif atas nama akun tadi.
 *
 * Alur:
 *   1. Fase aktif — setiap aktivitas (gerak mouse, ketik, klik, sentuh,
 *      scroll) me-reset hitungan idle.
 *   2. Setelah (idleMs - warnMs) tanpa aktivitas → tampilkan modal
 *      peringatan + hitung mundur warnMs detik.
 *   3. Saat modal tampil, aktivitas pasif DIABAIKAN — pengguna harus klik
 *      "Tetap Masuk" untuk lanjut (mencegah mouse yang bergeser sendiri
 *      membuat sesi hidup selamanya di perangkat kosong).
 *   4. Jika hitung mundur habis → panggil onIdle() (logout + redirect).
 *
 * Pemakaian (di dashboard tiap portal, setelah auth terkonfirmasi):
 *   import { initIdleTimeout } from '../../shared/idle-timeout.js';
 *   initIdleTimeout({ onIdle: async () => { await logout(); location.href = 'index.html'; } });
 */

const DEFAULT_IDLE_MS = 15 * 60 * 1000; // 15 menit tanpa aktivitas
const DEFAULT_WARN_MS = 60 * 1000;      // peringatan 60 detik sebelum keluar

/**
 * @param {object}   opts
 * @param {Function} opts.onIdle  - dipanggil saat idle penuh (async didukung).
 * @param {number}  [opts.idleMs] - total idle sebelum logout (default 15 mnt).
 * @param {number}  [opts.warnMs] - durasi hitung mundur peringatan (default 60 dtk).
 * @returns {Function} fungsi untuk menghentikan (cleanup) idle timeout.
 */
export function initIdleTimeout({ onIdle, idleMs = DEFAULT_IDLE_MS, warnMs = DEFAULT_WARN_MS } = {}) {
    if (typeof onIdle !== 'function') {
        console.warn('[idle-timeout] onIdle wajib berupa fungsi — idle timeout tidak aktif.');
        return () => {};
    }
    if (warnMs >= idleMs) warnMs = Math.min(DEFAULT_WARN_MS, Math.floor(idleMs / 2));

    const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'];

    let idleTimer   = null;   // menuju fase peringatan
    let countdownIv = null;   // interval hitung mundur di modal
    let warning     = false;  // sedang menampilkan modal?
    let lastReset   = 0;      // throttle reset agar mousemove tak boros
    let overlay     = null;
    let secondsEl   = null;
    let firedOut    = false;  // cegah onIdle terpanggil dua kali

    // ── Modal peringatan (dibuat lazy saat pertama dibutuhkan) ──
    function buildModal() {
        overlay = document.createElement('div');
        overlay.setAttribute('role', 'alertdialog');
        overlay.setAttribute('aria-live', 'assertive');
        overlay.style.cssText =
            'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;' +
            'justify-content:center;background:rgba(0,0,0,.55);padding:16px';

        const box = document.createElement('div');
        box.style.cssText =
            'background:#fff;border-radius:12px;max-width:380px;width:100%;padding:24px;' +
            'box-shadow:0 10px 40px rgba(0,0,0,.25);text-align:center;font-family:inherit';
        box.innerHTML =
            '<div style="font-size:34px;line-height:1;margin-bottom:8px">⏳</div>' +
            '<h3 style="margin:0 0 8px;font-size:18px;color:var(--color-text,#1f2937)">Masih di sana?</h3>' +
            '<p style="margin:0 0 4px;font-size:14px;color:var(--color-text-muted,#6b7280)">' +
            'Demi keamanan perangkat bersama, Anda akan otomatis keluar dalam</p>' +
            '<p style="margin:0 0 16px;font-size:30px;font-weight:700;color:var(--color-primary,#16a34a)">' +
            '<span data-idle-seconds>60</span> detik</p>' +
            '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">' +
            '<button type="button" data-idle-stay class="btn btn-primary" ' +
            'style="background:var(--color-primary,#16a34a);color:#fff;border:none;border-radius:8px;' +
            'padding:10px 18px;font-size:14px;font-weight:600;cursor:pointer">Tetap Masuk</button>' +
            '<button type="button" data-idle-leave class="btn btn-secondary" ' +
            'style="background:#f3f4f6;color:#374151;border:1px solid #d1d5db;border-radius:8px;' +
            'padding:10px 18px;font-size:14px;cursor:pointer">Keluar Sekarang</button>' +
            '</div>';
        overlay.appendChild(box);
        secondsEl = box.querySelector('[data-idle-seconds]');
        box.querySelector('[data-idle-stay]').addEventListener('click', dismissWarning);
        box.querySelector('[data-idle-leave]').addEventListener('click', fireLogout);
    }

    function showWarning() {
        warning = true;
        if (!overlay) buildModal();
        let remaining = Math.ceil(warnMs / 1000);
        secondsEl.textContent = remaining;
        document.body.appendChild(overlay);

        countdownIv = setInterval(() => {
            remaining -= 1;
            if (remaining <= 0) { fireLogout(); return; }
            secondsEl.textContent = remaining;
        }, 1000);
    }

    function dismissWarning() {
        warning = false;
        if (countdownIv) { clearInterval(countdownIv); countdownIv = null; }
        if (overlay?.parentNode) overlay.parentNode.removeChild(overlay);
        scheduleIdle();
    }

    async function fireLogout() {
        if (firedOut) return;
        firedOut = true;
        cleanup();
        try { await onIdle(); } catch (err) { console.error('[idle-timeout] onIdle gagal:', err); }
    }

    function scheduleIdle() {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(showWarning, Math.max(0, idleMs - warnMs));
    }

    function onActivity() {
        if (warning || firedOut) return;           // saat peringatan tampil, abaikan aktivitas pasif
        const now = Date.now();
        if (now - lastReset < 1000) return;         // throttle 1 dtk
        lastReset = now;
        scheduleIdle();
    }

    function cleanup() {
        if (idleTimer) clearTimeout(idleTimer);
        if (countdownIv) clearInterval(countdownIv);
        ACTIVITY_EVENTS.forEach(ev => window.removeEventListener(ev, onActivity, true));
        if (overlay?.parentNode) overlay.parentNode.removeChild(overlay);
    }

    ACTIVITY_EVENTS.forEach(ev => window.addEventListener(ev, onActivity, true));
    scheduleIdle();

    return cleanup;
}
