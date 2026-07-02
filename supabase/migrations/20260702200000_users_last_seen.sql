-- ============================================================
-- Migration 20260702200000: Catat last_seen_at + last_seen_ua
--
-- Digunakan login-guard untuk deteksi sesi bersamaan:
-- saat portal init, bandingkan last_seen_ua dengan UA sekarang.
-- Jika berbeda dan < 30 menit lalu → kemungkinan sesi ganda.
-- ============================================================

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS last_seen_at  TIMESTAMPTZ DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS last_seen_ua  TEXT        DEFAULT NULL;

COMMENT ON COLUMN users.last_seen_at IS 'Waktu terakhir portal diinisialisasi oleh user ini.';
COMMENT ON COLUMN users.last_seen_ua  IS 'User-Agent browser saat last_seen_at diperbarui.';
