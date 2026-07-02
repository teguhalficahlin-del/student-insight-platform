// Bootstrap guard: purge total service worker + cache, reload sekali,
// aman dari infinite loop, defensif terhadap storage API yang gagal.
// SELALU cek registrasi aktual (bukan cuma flag) — flag hanya mencegah
// reload berulang untuk kondisi YANG SAMA, bukan mencegah pengecekan.

(function () {
  'use strict';

  if (!('serviceWorker' in navigator)) return;

  var RELOAD_GUARD_KEY = 'sw_purge_reloading';

  if (window.__SW_GUARD_RUNNING__) return;
  window.__SW_GUARD_RUNNING__ = true;

  function reloadOnce() {
    var reloading = false;
    try {
      reloading = window.sessionStorage.getItem(RELOAD_GUARD_KEY) === '1';
    } catch (e) {
      reloading = false;
    }
    if (reloading) return;

    try {
      window.sessionStorage.setItem(RELOAD_GUARD_KEY, '1');
    } catch (e) { /* abaikan */ }

    window.location.reload();
  }

  function clearAllCaches() {
    if (!('caches' in window)) return Promise.resolve();
    return caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) { return caches.delete(k); }));
      })
      .catch(function (err) {
        console.warn('[sw-guard] gagal hapus cache:', err);
      });
  }

  navigator.serviceWorker.addEventListener('message', function (event) {
    if (event.data && event.data.type === 'SW_SELF_DESTRUCT') {
      clearAllCaches().then(reloadOnce);
    }
  });

  function purge() {
    navigator.serviceWorker.getRegistrations()
      .then(function (registrations) {
        if (!registrations || registrations.length === 0) {
          return clearAllCaches();
        }
        var unregisterPromises = registrations.map(function (reg) {
          return reg.unregister().catch(function () { /* lanjut yang lain */ });
        });
        return Promise.all(unregisterPromises)
          .then(clearAllCaches)
          .then(reloadOnce);
      })
      .catch(function (err) {
        console.warn('[sw-guard] gagal ambil daftar registrasi:', err);
      });
  }

  purge();
})();
