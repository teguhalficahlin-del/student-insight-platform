-- ============================================================
-- Migration: 20260930230000_reset-password-rambah-ke-onboarding.sql
--
-- TUJUAN
--   Kembalikan SELURUH akun pengguna SMK Negeri 3 Rambah ke keadaan
--   onboarding: password '12345678' dan must_change_password = true.
--
-- LATAR
--   Audit 30 Sep 2026 menemukan 100 akun Rambah tidak seragam:
--     - 96 akun sesuai (password default + wajib ganti)
--     -  1 GURU  : password bukan default, flag masih menyala
--     -  1 ORTU  : sudah onboard penuh (flag mati, password sendiri)
--     -  1 ADMIN : sudah onboard penuh
--     -  1 STAKEHOLDER: flag mati tapi password masih '12345678' —
--        alur ganti password mengizinkan password baru sama dengan
--        password lama, jadi langkah wajib-ganti bisa dilewati
--        tanpa benar-benar mengganti apa pun.
--
-- CAKUPAN — DIBATASI SATU SEKOLAH
--   Hanya school_id = 561cc906-... (SMK Negeri 3 Rambah).
--   Migration serupa Juli 2026 (20260714050000) dijalankan TANPA filter
--   sekolah dan mengenai seluruh platform. Di sini sengaja dibatasi:
--   password yang sudah diganti pengguna tidak bisa dikembalikan, jadi
--   jangkauan yang lebih luas harus jadi keputusan sadar, bukan
--   akibat sampingan.
--
-- ADMINISTRATIVE DIKECUALIKAN
--   Mengikuti preseden 20260714050000. Admin sekolah dapat membuat dan
--   menghapus pengguna; memberinya password yang diketahui umum membuka
--   jalan pengambilalihan seluruh sekolah oleh siapa pun yang tahu NIP
--   admin. Untuk menyertakannya, hapus baris role_type <> 'ADMINISTRATIVE'
--   di KEDUA statement.
--
-- YANG HILANG DAN TIDAK BISA DIKEMBALIKAN
--   Akun yang sudah mengganti passwordnya sendiri (per audit: 1 ORTU,
--   1 ADMINISTRATIVE) akan kehilangan password itu. Mereka harus login
--   ulang dengan '12345678' lalu membuat password baru.
--
-- KENAPA extensions.crypt DAN BUKAN crypt
--   pgcrypto terpasang di skema `extensions`, dan role sementara yang
--   dipakai `supabase db push` tidak memuat skema itu di search_path-nya.
--   Tanpa kualifikasi eksplisit, migration gagal dengan
--   "function gen_salt(unknown) does not exist (SQLSTATE 42883)".
--   Migration Juli 2026 (20260714050000) memakai bentuk tanpa kualifikasi;
--   jangan dijadikan contoh.
--
-- VOLUME
--   ~99 baris (100 akun minus 1 ADMINISTRATIVE) — jauh di bawah ambang
--   yang mewajibkan EXPLAIN ANALYZE, dan aman terhadap statement_timeout
--   2 menit.
-- ============================================================

-- 1. Password -> '12345678'
UPDATE auth.users au
SET    encrypted_password = extensions.crypt('12345678', extensions.gen_salt('bf'))
WHERE  au.id IN (
    SELECT u.auth_user_id
    FROM   public.users u
    WHERE  u.school_id    = '561cc906-e6e0-40c7-a5b0-d8f69a15258a'
      AND  u.deleted_at   IS NULL
      AND  u.auth_user_id IS NOT NULL
      AND  u.role_type   <> 'ADMINISTRATIVE'
);

-- 2. Wajib ganti password saat login berikutnya.
--    Migration Juli 2026 melewatkan langkah ini — akibatnya password
--    kembali ke default tanpa ada yang memaksa penggunanya mengganti.
SET LOCAL app.bypass_users_guard = 'on';
UPDATE public.users u
SET    must_change_password = TRUE
WHERE  u.school_id    = '561cc906-e6e0-40c7-a5b0-d8f69a15258a'
  AND  u.deleted_at   IS NULL
  AND  u.auth_user_id IS NOT NULL
  AND  u.role_type   <> 'ADMINISTRATIVE';
