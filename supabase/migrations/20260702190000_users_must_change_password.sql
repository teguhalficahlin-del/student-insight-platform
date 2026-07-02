-- ============================================================
-- Migration 20260702190000: Tandai user harus ganti password
--
-- Diset TRUE saat admin mereset password user lain.
-- Portal membaca flag ini pasca-login dan menampilkan
-- form ganti password wajib sebelum bisa mengakses dashboard.
-- ============================================================

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN users.must_change_password IS
    'TRUE = admin telah mereset password; user wajib ganti password saat login berikutnya.';
