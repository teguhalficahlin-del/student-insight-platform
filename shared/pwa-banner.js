/**
 * @file shared/pwa-banner.js
 * Banner instruksi install PWA manual — muncul sekali per user, dismissible.
 * Tidak bergantung pada beforeinstallprompt (SW sengaja self-destruct).
 */

const DISMISSED_KEY = 'sip_pwa_dismissed';

function detectPlatform() {
    const ua = navigator.userAgent;
    if (/android/i.test(ua)) return 'android';
    if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
    return 'desktop';
}

function getInstruction(platform) {
    if (platform === 'android') {
        return 'Ketuk menu <b>⋮</b> di pojok kanan atas browser, lalu pilih <b>"Tambahkan ke layar utama"</b>';
    }
    if (platform === 'ios') {
        return 'Ketuk ikon <b>Share ⎙</b> di bagian bawah Safari, lalu pilih <b>"Tambahkan ke Layar Utama"</b>';
    }
    return 'Klik ikon <b>⊕ Instal</b> di address bar browser, atau buka menu browser → <b>"Instal SIP"</b>';
}

/**
 * Tampilkan banner instruksi install PWA.
 * @param {{ hasBottomNav?: boolean }} [opts]
 *   hasBottomNav: true jika portal punya bottom nav (default false).
 *                 Banner digeser ke atas agar tidak menindih nav.
 */
export function showPwaBanner({ hasBottomNav = false } = {}) {
    try {
        if (localStorage.getItem(DISMISSED_KEY)) return;
    } catch {
        return; // private mode — skip
    }

    // Jangan tampilkan jika sudah terinstall sebagai PWA (standalone mode)
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    if (window.navigator.standalone === true) return; // iOS Safari standalone

    const platform = detectPlatform();
    const instruction = getInstruction(platform);
    const bottomOffset = hasBottomNav ? '68px' : '0px';

    const banner = document.createElement('div');
    banner.id = 'sip-pwa-banner';
    banner.setAttribute('role', 'complementary');
    banner.setAttribute('aria-label', 'Pasang aplikasi');
    banner.style.cssText = `
        position: fixed;
        bottom: ${bottomOffset};
        left: 0;
        right: 0;
        z-index: 1200;
        background: var(--color-surface, #1e293b);
        border-top: 1px solid var(--color-border, #334155);
        padding: 10px 16px;
        display: flex;
        align-items: flex-start;
        gap: 10px;
        box-shadow: 0 -2px 12px rgba(0,0,0,0.25);
        font-size: 0.82rem;
        line-height: 1.4;
    `;

    banner.innerHTML = `
        <span style="font-size:1.3rem;flex-shrink:0;margin-top:1px">📲</span>
        <div style="flex:1;color:var(--color-text,#e2e8f0)">
            <div style="font-weight:600;margin-bottom:2px">Pasang SIP sebagai aplikasi</div>
            <div>${instruction}</div>
        </div>
        <button
            id="sip-pwa-dismiss"
            aria-label="Tutup"
            style="
                background:none;
                border:none;
                cursor:pointer;
                color:var(--color-text-muted,#94a3b8);
                font-size:1.2rem;
                line-height:1;
                padding:2px 4px;
                flex-shrink:0;
                margin-top:-2px;
            "
        >×</button>
    `;

    document.body.appendChild(banner);

    document.getElementById('sip-pwa-dismiss').addEventListener('click', () => {
        try { localStorage.setItem(DISMISSED_KEY, '1'); } catch { /* private mode */ }
        banner.remove();
    });
}
