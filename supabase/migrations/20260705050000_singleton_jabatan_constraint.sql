-- ============================================================
-- Migration: 20260705050000_singleton_jabatan_constraint.sql
--
-- Jabatan KEPSEK, WAKA_KURIKULUM, WAKA_KESISWAAN, WAKA_HUMAS
-- hanya boleh dipegang SATU orang aktif per sekolah.
--
-- MASALAH: tidak ada constraint DB → import file salah bisa
--   menambah Kepsek kedua (atau ketiga) tanpa peringatan apapun.
--   Terdeteksi saat uji coba SMK Karya Bangsa (2 Kepsek setelah
--   file uji generik diimpor ke tenant nyata).
--
-- SOLUSI: partial unique index per kolom jabatan:
--   - Hanya baris yang AKTIF (is_active=TRUE)
--   - Hanya baris yang TIDAK terhapus (deleted_at IS NULL)
--   - Satu index per jabatan, menggunakan kolom ekspresi boolean
--     sehingga satu user dengan role_type=GURU + is_kepsek=TRUE
--     juga tertangkap (pola multi-peran).
--
-- Ekspresi: (role_type = 'X' OR is_x = TRUE) dibungkus dalam
-- partial index WHERE is_active AND deleted_at IS NULL.
-- Karena PostgreSQL tidak mendukung OR langsung di partial index
-- expression, kita pakai kolom computed via CASE yang menghasilkan
-- TRUE/FALSE lalu index hanya pada nilai TRUE.
--
-- CARA KERJA:
--   Index menyimpan (school_id) WHERE ekspresi = TRUE.
--   Karena UNIQUE, dua baris aktif dengan sekolah sama tidak bisa
--   keduanya memenuhi kondisi tersebut → INSERT/UPDATE ditolak
--   dengan pesan "duplicate key value violates unique constraint".
-- ============================================================

-- ── KEPSEK ────────────────────────────────────────────────────
-- Seorang user adalah Kepsek jika role_type='KEPSEK' ATAU is_kepsek=TRUE
CREATE UNIQUE INDEX IF NOT EXISTS uq_school_kepsek_active
    ON users (school_id)
    WHERE (role_type = 'KEPSEK' OR is_kepsek = TRUE)
      AND is_active  = TRUE
      AND deleted_at IS NULL;

-- ── WAKA KURIKULUM ────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_school_waka_kurikulum_active
    ON users (school_id)
    WHERE (role_type = 'WAKA_KURIKULUM' OR is_waka_kurikulum = TRUE)
      AND is_active  = TRUE
      AND deleted_at IS NULL;

-- ── WAKA KESISWAAN ────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_school_waka_kesiswaan_active
    ON users (school_id)
    WHERE (role_type = 'WAKA_KESISWAAN' OR is_waka_kesiswaan = TRUE)
      AND is_active  = TRUE
      AND deleted_at IS NULL;

-- ── WAKA HUMAS ────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_school_waka_humas_active
    ON users (school_id)
    WHERE (role_type = 'WAKA_HUMAS' OR is_waka_humas = TRUE)
      AND is_active  = TRUE
      AND deleted_at IS NULL;

-- ── Komentar untuk dokumentasi ───────────────────────────────
COMMENT ON INDEX uq_school_kepsek_active       IS 'Maks 1 Kepsek aktif per sekolah (role_type=KEPSEK atau is_kepsek=TRUE)';
COMMENT ON INDEX uq_school_waka_kurikulum_active IS 'Maks 1 Waka Kurikulum aktif per sekolah';
COMMENT ON INDEX uq_school_waka_kesiswaan_active IS 'Maks 1 Waka Kesiswaan aktif per sekolah';
COMMENT ON INDEX uq_school_waka_humas_active     IS 'Maks 1 Waka Humas aktif per sekolah';
