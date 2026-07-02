// Service Worker — self-destruct: hapus semua cache, beri tahu client, unregister diri sendiri.
// Tidak ada fetch handler = semua request langsung ke network.

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .catch((err) => {
        console.warn('[sw] gagal hapus cache saat install:', err);
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        await self.clients.claim();
      } catch (err) {
        console.warn('[sw] gagal claim clients:', err);
      }

      try {
        const clientList = await self.clients.matchAll({ type: 'window' });
        clientList.forEach((client) => {
          client.postMessage({ type: 'SW_SELF_DESTRUCT' });
        });
      } catch (err) {
        console.warn('[sw] gagal kirim pesan ke client:', err);
      }

      try {
        await self.registration.unregister();
      } catch (err) {
        console.warn('[sw] gagal unregister:', err);
      }
    })()
  );
});
