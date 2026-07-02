-- ============================================================
-- Migration 20260702180000: Soft-delete untuk tabel users
--
-- Sebelumnya: delete-user melakukan hard-delete (Auth account +
--   baris users dihapus permanen). Admin tidak bisa undo.
--
-- Sesudahnya: delete-user melakukan soft-delete:
--   - deleted_at diset ke waktu hapus
--   - is_active = FALSE (blokir login portal)
--   - Auth account dibanned (bukan dihapus)
--   Admin bisa restore dalam 30 hari, atau purge permanen.
-- ============================================================

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN users.deleted_at IS
    'NULL = user aktif atau nonaktif; NOT NULL = dihapus sementara (soft-delete). Hard-delete oleh admin atau setelah 30 hari.';

CREATE INDEX IF NOT EXISTS idx_users_deleted_at
    ON users (school_id, deleted_at)
    WHERE deleted_at IS NOT NULL;
