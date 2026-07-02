/**
 * Service Worker — KILL SWITCH
 *
 * SW sementara dinonaktifkan. File ini menghapus semua cache
 * dan membatalkan registrasi SW agar browser berjalan tanpa SW.
 * Untuk mengaktifkan kembali, ganti file ini dengan sw-full.js.
 */

self.addEventListener('install', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.map(k => caches.delete(k))))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        self.registration.unregister()
            .then(() => self.clients.matchAll())
            .then(clients => clients.forEach(c => c.navigate(c.url)))
    );
});
