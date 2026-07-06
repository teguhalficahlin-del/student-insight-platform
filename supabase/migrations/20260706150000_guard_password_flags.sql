-- ============================================================
-- Migration: 20260706150000_guard_password_flags.sql
--
-- Menutup celah self-clear must_change_password.
--
-- MASALAH:
--   rls_users_update_own memberi user akses UPDATE baris miliknya
--   sendiri. Karena tidak ada pembatasan kolom, user bisa memanggil
--   supabase.from('users').update({must_change_password:false})
--   langsung lewat REST API tanpa benar-benar mengganti password
--   lewat supabase.auth.updateUser().
--
-- SOLUSI:
--   1. Buat fn_confirm_password_changed() SECURITY DEFINER —
--      satu-satunya jalur resmi untuk mengubah kedua kolom ini.
--      Dipanggil HANYA setelah supabase.auth.updateUser() berhasil.
--   2. REVOKE UPDATE pada dua kolom spesifik dari role authenticated.
--      Kolom lain yang legitimately self-updatable (last_seen_at,
--      last_seen_ua) maupun kolom yang di-update oleh ADMINISTRATIVE
--      (is_active, is_bk, dll) TIDAK tersentuh karena REVOKE ini
--      bersifat per-kolom (column-level privilege), bukan per-tabel.
-- ============================================================


-- ── 1. Fungsi resmi ganti flag password ─────────────────────
--
-- SECURITY DEFINER: berjalan sebagai owner (postgres/superuser),
-- bukan sebagai authenticated. Dengan demikian fungsi ini bisa
-- menulis ke kolom must_change_password dan password_changed_at
-- meskipun authenticated sudah kehilangan UPDATE privilege pada
-- kedua kolom tersebut.
--
-- auth.uid() dievaluasi dalam konteks CALLER (authenticated user),
-- bukan owner — ini adalah perilaku standar Supabase/PostgREST.
-- Artinya fungsi hanya bisa mengubah baris milik pemanggil sendiri.

CREATE OR REPLACE FUNCTION fn_confirm_password_changed()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE users
    SET must_change_password = false,
        password_changed_at  = now()
    WHERE auth_user_id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION fn_confirm_password_changed() TO authenticated;

COMMENT ON FUNCTION fn_confirm_password_changed IS
    'Satu-satunya jalur resmi untuk mengubah must_change_password dan '
    'password_changed_at. Dipanggil HANYA setelah supabase.auth.updateUser() '
    'berhasil di shared/change-password.js. SECURITY DEFINER agar bisa menulis '
    'kolom yang privilege UPDATE-nya sudah dicabut dari role authenticated.';


-- ── 2. Cabut hak UPDATE dua kolom sensitif dari authenticated ─
--
-- Column-level REVOKE dievaluasi SEBELUM RLS. Artinya bahkan jika
-- RLS policy (rls_users_update_own atau rls_users_write_administrative)
-- mengijinkan baris, Postgres tetap menolak jika kolom tidak punya
-- UPDATE privilege untuk role pemanggil.
--
-- Kolom lain yang self-updatable (last_seen_at, last_seen_ua) dan
-- kolom admin (is_active, is_bk, is_kepsek, wali_kelas_class_id, dst)
-- TIDAK terpengaruh — REVOKE ini hanya menyentuh dua kolom di bawah.

REVOKE UPDATE (must_change_password, password_changed_at)
    ON public.users
    FROM authenticated;
