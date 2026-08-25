/**
 * @file shared/session-guard.js
 *
 * Session persistence guard — deteksi token expire saat tab kembali aktif.
 *
 * Masalah: browser throttle timer saat tab hidden → interval auto-refresh
 * Supabase bisa terlambat jalan → saat user kembali token sudah expire.
 * init() hanya jalan sekali saat page load: kalau session expire setelah
 * itu, tidak ada yang mendeteksi sampai user reload manual.
 *
 * Solusi: pasang visibilitychange + onAuthStateChange setelah init() sukses.
 *
 * Cara pakai:
 *   import { initSessionGuard } from '../../shared/session-guard.js';
 *   // di akhir init(), setelah user sudah terverifikasi:
 *   initSessionGuard(supabase, getLoginUrl());
 */

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} loginUrl - URL login portal ini (dari getLoginUrl())
 */
export function initSessionGuard(supabase, loginUrl) {
    // FIX-4: tangkap SIGNED_OUT dari Supabase internal (misal token rotate gagal)
    // INITIAL_SESSION dilewati — init() sudah verifikasi session saat page load.
    supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'INITIAL_SESSION') return;
        if (event === 'SIGNED_OUT' || !session) {
            localStorage.setItem('sip_last_page',
                window.location.pathname + window.location.search);
            window.location.replace(loginUrl);
        }
        // TOKEN_REFRESHED: Supabase sudah update token di storage — tidak perlu aksi
    });

    // FIX-2: re-validasi session saat tab kembali visible
    // Kasus: user meninggalkan laptop > 1 jam, browser throttle timer auto-refresh
    document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState !== 'visible') return;
        try {
            const { data: { session }, error } = await supabase.auth.getSession();
            if (!session || error) {
                localStorage.setItem('sip_last_page',
                    window.location.pathname + window.location.search);
                window.location.replace(loginUrl);
                return;
            }
            // Proaktif refresh jika token hampir expire (< 5 menit sisa)
            const now = Math.floor(Date.now() / 1000);
            if (session.expires_at && (session.expires_at - now) < 300) {
                await supabase.auth.refreshSession();
            }
        } catch (e) {
            console.warn('[session-guard] visibility check error:', e);
        }
    });
}
