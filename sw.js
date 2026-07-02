/**
 * Service Worker — Platform SMK Harapan Rokan
 * Strategi:
 *   - Static assets (HTML/CSS/JS): cache-first, fallback network
 *   - Supabase API: network-only (data selalu fresh)
 *   - Navigasi offline: tampilkan offline.html
 */

const CACHE_NAME = 'smkhr-v9';

const PRECACHE_URLS = [
    './',
    './offline.html',
    './icons/icon.svg',
    './icons/icon-maskable.svg',

    // Portal Guru
    './guru/index.html',
    './guru/dashboard.html',
    './guru/css/guru.css',
    './guru/js/auth.js',
    './guru/js/api.js',
    './guru/js/dashboard.js',

    // Portal Siswa
    './student/index.html',
    './student/dashboard.html',
    './student/css/student.css',
    './student/js/auth.js',
    './student/js/api.js',
    './student/js/dashboard.js',

    // Portal Orang Tua
    './parent/index.html',
    './parent/portal.html',
    './parent/css/parent.css',
    './parent/js/auth.js',
    './parent/js/api.js',
    './parent/js/portal.js',

    // Portal DUDI
    './dudi/index.html',
    './dudi/dashboard.html',
    './dudi/css/dudi.css',
    './dudi/js/auth.js',
    './dudi/js/api.js',
    './dudi/js/dashboard.js',

    // Portal Stakeholder
    './stakeholder/index.html',
    './stakeholder/dashboard.html',
    './stakeholder/css/stakeholder.css',
    './stakeholder/js/auth.js',
    './stakeholder/js/api.js',
    './stakeholder/js/dashboard.js',

    // Portal Admin
    './admin/index.html',
    './admin/dashboard.html',
    './admin/css/admin.css',
    './admin/js/auth.js',
    './admin/js/api.js',
    './admin/js/dashboard.js',
];

// ── Install: pre-cache semua asset statis ──────────────────────
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache =>
            // addAll gagal jika satu URL error — gunakan individual add agar
            // file yang ada tetap ter-cache meski ada JS yang belum ada.
            Promise.allSettled(PRECACHE_URLS.map(url => cache.add(url)))
        ).then(() => self.skipWaiting())
    );
});

// ── Activate: hapus cache lama ──────────────────────────────────
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

// ── Fetch: strategi per tipe request ───────────────────────────
self.addEventListener('fetch', event => {
    const { request } = event;
    const url = new URL(request.url);

    // Supabase API — network only, jangan cache data sensitif
    if (url.hostname.endsWith('.supabase.co')) {
        event.respondWith(fetch(request));
        return;
    }

    // Request non-GET — lewatkan ke network
    if (request.method !== 'GET') {
        event.respondWith(fetch(request));
        return;
    }

    // Navigasi (HTML) — network-first, fallback ke cache, lalu offline page
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then(response => {
                    // Simpan salinan fresh ke cache
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(c => c.put(request, clone));
                    return response;
                })
                .catch(() =>
                    caches.match(request).then(cached =>
                        cached ?? caches.match('./offline.html')
                    )
                )
        );
        return;
    }

    // JS dan CSS same-origin — network-first agar perubahan langsung terlihat
    // CDN eksternal (Chart.js dll) dibiarkan ke cache-first di bawah
    if (url.origin === self.location.origin && /\.(js|css)(\?|$)/.test(url.pathname)) {
        event.respondWith(
            fetch(request)
                .then(response => {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(c => c.put(request, clone));
                    return response;
                })
                .catch(() => caches.match(request))
        );
        return;
    }

    // Aset lain (gambar, font, ikon) — cache-first
    event.respondWith(
        caches.match(request).then(cached => {
            if (cached) return cached;
            return fetch(request).then(response => {
                const clone = response.clone();
                caches.open(CACHE_NAME).then(c => c.put(request, clone));
                return response;
            });
        })
    );
});
