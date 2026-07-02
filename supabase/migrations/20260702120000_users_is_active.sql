-- Tahap 3a: Soft-delete staf
-- Tambah kolom is_active ke users agar admin bisa nonaktifkan tanpa hapus permanen.
-- Staf nonaktif: akun Auth tetap ada, data historis utuh, tapi tidak bisa login.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN users.is_active IS
    'FALSE = staf dinonaktifkan oleh admin; akun Auth masih ada tapi login ditolak di sisi portal.';
