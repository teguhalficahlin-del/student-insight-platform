# Status Service Worker — Student Insight Platform

## Status saat ini: DINONAKTIFKAN SEMENTARA
Sejak commit `ca92fc6` (03 Juli 2026), service worker tidak aktif di
seluruh 6 portal (admin, dudi, guru, stakeholder, student, parent).

## Riwayat masalah
- SW versi v8 stuck aktif di sebagian client meski server sudah bump
  ke v10 — root cause: cache lama tidak pernah invalidated dengan benar.
- Commit `8745e4c`: percobaan pertama — ganti sw.js jadi self-destruct
  (unregister diri sendiri) + tambah sw-guard.js di 6 portal untuk
  purge SW lama. TERBUKTI TIDAK CUKUP — screenshot DevTools menunjukkan
  SW tetap terdaftar ulang hingga versi #4.
- Root cause sebenarnya: 15 file HTML masih memanggil
  navigator.serviceWorker.register('../sw.js', ...) di setiap load
  (window.addEventListener('load', ...) sebelum </body>), sehingga SW
  terus terdaftar ulang meski sw.js sendiri self-destruct.
- Commit `ca92fc6`: fix final — comment-out register() di 15 halaman,
  upgrade sw-guard.js supaya selalu cek getRegistrations() aktual
  (bukan bergantung flag localStorage yang bisa basi).

## File yang terlibat
- `sw.js` (root) — versi self-destruct, hapus semua cache + unregister diri
- `{admin,dudi,guru,stakeholder,student,parent}/js/sw-guard.js` — bootstrap
  guard, purge registrasi tersisa + reload sekali
- 15 file HTML — blok register() di-comment, lokasi: dekat `</body>`,
  cari string "SW DINONAKTIFKAN SEMENTARA"

## Cara reaktivasi service worker (saat strategi caching baru sudah didesain)
1. Di 15 file HTML, cari blok `/* SW DINONAKTIFKAN SEMENTARA — lihat
   commit 8745e4c ... */` dan uncomment isi di dalamnya
2. Hapus atau nonaktifkan `js/sw-guard.js` di 6 folder — kalau dibiarkan
   aktif bersamaan dengan SW baru yang legitimate, guard akan terus
   menghapusnya
3. Ganti isi sw.js dengan strategi caching yang benar (bukan lagi
   self-destruct) — precache versi, cache-first/network-first sesuai
   kebutuhan, dengan CACHE_VERSION yang di-bump setiap rilis

## Backlog terpisah (belum dikerjakan, tidak terkait langsung)
- `dudi/dashboard.html`: title menyimpan karakter `&` literal, bukan
  `&amp;` — technical debt HTML validity, pre-existing
- Folder `superadmin/` belum diverifikasi apakah mendaftarkan service
  worker juga — kalau ya, perlu guard ke-7 di rilis reaktivasi berikutnya
