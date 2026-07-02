// Service Worker — dinonaktifkan sementara (no-op).
// Install: hapus semua cache lama + ambil kontrol segera.
// Tidak ada fetch handler = semua request langsung ke network.

self.addEventListener('install', e => e.waitUntil(
    caches.keys()
        .then(keys => Promise.all(keys.map(k => caches.delete(k))))
        .then(() => self.skipWaiting())
));

self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
