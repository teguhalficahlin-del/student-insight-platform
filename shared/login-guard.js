/**
 * @file shared/login-guard.js
 *
 * Deteksi sesi ganda (concurrent login) & tampilkan notif login baru.
 *
 * Gunakan:
 *   import { initLoginGuard } from '../../shared/login-guard.js';
 *   await initLoginGuard(supabase, userRow);
 *
 * Alur:
 *   1. Baca last_seen_at + last_seen_ua dari DB (dari userRow).
 *   2. Jika last_seen_at ada & < STALE_MS lalu & UA berbeda → tampilkan
 *      notif "Ada login aktif dari perangkat lain" + tombol keluar semua.
 *   3. Update last_seen_at = now() + last_seen_ua = UA sekarang di DB.
 */

const STALE_MS = 30 * 60 * 1000; // 30 menit — anggap sesi "aktif"

function currentUA() {
    return navigator.userAgent.slice(0, 500);
}

function friendlyUA(ua) {
    if (!ua) return 'perangkat tidak diketahui';
    if (/Mobile|Android|iPhone|iPad/i.test(ua)) return 'perangkat mobile';
    if (/Windows/i.test(ua))  return 'komputer Windows';
    if (/Macintosh/i.test(ua)) return 'komputer Mac';
    if (/Linux/i.test(ua))    return 'komputer Linux';
    return 'perangkat lain';
}

function showConcurrentBanner(onSignOutOthers) {
    if (document.getElementById('login-guard-banner')) return; // idempoten
    const banner = document.createElement('div');
    banner.id = 'login-guard-banner';
    banner.style.cssText = [
        'position:fixed;top:0;left:0;right:0;z-index:10000',
        'background:#b45309;color:#fff;padding:10px 16px',
        'display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:14px',
        'box-shadow:0 2px 8px rgba(0,0,0,.3)',
    ].join(';');
    banner.innerHTML = `
        <span style="flex:1;min-width:200px">⚠️ Akun Anda sedang aktif di perangkat lain. Jika bukan Anda, segera keluar semua perangkat.</span>
        <button id="lgb-signout-all" style="background:#fff;color:#b45309;border:none;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:13px;font-weight:600">Keluar Semua Perangkat</button>
        <button id="lgb-dismiss" style="background:transparent;border:1px solid rgba(255,255,255,.5);color:#fff;border-radius:6px;padding:6px 10px;cursor:pointer;font-size:13px">Abaikan</button>`;
    document.body.prepend(banner);
    document.body.classList.add('has-login-banner');

    const removeBanner = () => { banner.remove(); document.body.classList.remove('has-login-banner'); };
    document.getElementById('lgb-dismiss').onclick = removeBanner;
    document.getElementById('lgb-signout-all').onclick = async () => {
        document.getElementById('lgb-signout-all').disabled = true;
        document.getElementById('lgb-signout-all').textContent = 'Memproses…';
        await onSignOutOthers();
        removeBanner();
    };
}

function parseDeviceLabel(ua) {
    let browser = 'Browser';
    if (/Chrome\//.test(ua) && !/Chromium|Edg\//.test(ua)) browser = 'Chrome';
    else if (/Firefox\//.test(ua))  browser = 'Firefox';
    else if (/Edg\//.test(ua))      browser = 'Edge';
    else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = 'Safari';
    let os = 'perangkat';
    if (/Windows/.test(ua))               os = 'Windows';
    else if (/Android/.test(ua))          os = 'Android';
    else if (/iPhone|iPad|iOS/.test(ua))  os = 'iOS';
    else if (/Mac OS X|Macintosh/.test(ua)) os = 'Mac';
    else if (/Linux/.test(ua))            os = 'Linux';
    return `${browser} di ${os}`;
}

/**
 * Daftarkan perangkat login & kirim notif LOGIN_NEW_DEVICE jika baru.
 * Fire-and-forget — tidak memblokir render.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 */
export async function registerLoginDevice(supabase) {
    try {
        let devId = localStorage.getItem('sip_device_id');
        if (!devId) {
            devId = crypto.randomUUID();
            localStorage.setItem('sip_device_id', devId);
        }
        const ua  = navigator.userAgent || '';
        const buf = await crypto.subtle.digest(
            'SHA-256', new TextEncoder().encode(devId + '|' + ua)
        );
        const hash = Array.from(new Uint8Array(buf))
            .map(b => b.toString(16).padStart(2, '0')).join('');
        const { error } = await supabase.rpc('fn_register_login_device', {
            p_device_hash: hash,
            p_user_agent:  ua.slice(0, 400),
            p_label:       parseDeviceLabel(ua),
        });
        if (error) console.warn('[login-device]', error.message);
    } catch (e) {
        console.warn('[login-device]', e);
    }
}

/**
 * Inisialisasi login guard.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ user_id: string, last_seen_at?: string, last_seen_ua?: string }} userRow
 */
export async function initLoginGuard(supabase, userRow) {
    const now    = Date.now();
    const prevAt = userRow.last_seen_at ? new Date(userRow.last_seen_at).getTime() : null;
    const prevUA = userRow.last_seen_ua ?? null;
    const thisUA = currentUA();

    // Deteksi: sesi sebelumnya masih "segar" (< STALE_MS) & UA berbeda
    if (prevAt && (now - prevAt) < STALE_MS && prevUA && prevUA !== thisUA) {
        showConcurrentBanner(async () => {
            // Sign out semua sesi lain via Supabase Auth (scope: 'others')
            await supabase.auth.signOut({ scope: 'others' });
        });
    }

    // Update last_seen setelah cek — jangan await agar tidak blok render
    supabase.from('users')
        .update({ last_seen_at: new Date().toISOString(), last_seen_ua: thisUA })
        .eq('user_id', userRow.user_id)
        .then(() => {}); // fire-and-forget
}
