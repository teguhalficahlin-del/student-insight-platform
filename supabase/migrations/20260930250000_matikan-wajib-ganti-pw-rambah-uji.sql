-- ============================================================
-- Migration: 20260930250000_matikan-wajib-ganti-pw-rambah-uji.sql
--
-- TUJUAN
--   Mematikan modal "wajib ganti password" untuk seluruh akun SEKOLAH UJI
--   SMK Negeri 3 Rambah, agar penguji luar (ChatGPT) bisa login langsung
--   dengan 12345678 tanpa tertahan di layar ganti password setiap akun.
--
--   Ini menggantikan permintaan "login tanpa password", yang MUSTAHIL dibatasi
--   ke satu sekolah: Supabase Auth di project ini satu untuk seluruh platform
--   dan dibagi dengan 1.053 siswa nyata SMKN 1 Ujungbatu. Mematikan modal
--   menyelesaikan masalah kecepatan tanpa melubangi autentikasi — password
--   tetap 12345678 dan tetap diperlukan.
--
--   HANYA sekolah uji (561cc906-...). ADMINISTRATIVE dikecualikan.
--
-- CATATAN KEAMANAN
--   Karena semua akun uji berpassword sama (12345678) dan kini tidak dipaksa
--   ganti, siapa pun yang tahu NIP bisa login. Itu dapat diterima HANYA karena
--   ini sekolah uji. Setelah audit, kembalikan keadaan onboarding dengan
--   menjalankan ulang 20260930230000 (reset + wajib-ganti menyala lagi).
--
-- KOLOM TERLINDUNGI
--   must_change_password ditolak UPDATE langsung oleh trigger
--   fn_guard_users_protected_columns (42501). Jalur sah: flag GUC
--   app.bypass_users_guard. SET LOCAL membuatnya hilang di akhir transaksi.
--   >>> BARIS FLAG DITAMBAHKAN MANUAL OLEH ROMO tepat sebelum UPDATE <<<
--   (lihat pesan pendamping — perkakas sesi ini memblokir penulisannya)
-- ============================================================

-- <<< ROMO: sisipkan di sini satu baris  SET LOCAL app.bypass_users_guard = 'on';
SET LOCAL app.bypass_users_guard = 'on';
UPDATE public.users u
SET    must_change_password = FALSE
WHERE  u.school_id  = '561cc906-e6e0-40c7-a5b0-d8f69a15258a'
  AND  u.deleted_at IS NULL
  AND  u.role_type <> 'ADMINISTRATIVE';
