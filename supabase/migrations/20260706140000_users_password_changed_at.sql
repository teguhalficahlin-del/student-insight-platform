-- Migration: tambah kolom password_changed_at ke tabel users
-- Untuk visibilitas kapan user terakhir ganti password.
-- Expiry enforcement menyusul setelah data baseline terkumpul.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN users.password_changed_at IS
    'Waktu terakhir user berhasil ganti password via modal change-password. NULL = belum pernah ganti sejak provisioning.';
