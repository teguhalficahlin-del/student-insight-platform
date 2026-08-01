-- ============================================================
-- Migration: 20260802010000_add-pkl-supervisor-column.sql
-- Tambah kolom guru_pembimbing_user_id ke pkl_placements.
-- Prerequisite untuk migration coaching-cases-schema.
-- ============================================================
--
-- KONTEKS
-- Kolom ini menyimpan relasi 1 guru pembimbing → banyak siswa PKL.
-- Nullable karena belum tentu setiap placement langsung diisi guru;
-- ON DELETE SET NULL agar data placement tidak ikut hilang jika
-- user dihapus. fn_get_escalation_candidates mereferensikan kolom ini.
-- ============================================================

ALTER TABLE pkl_placements
    ADD COLUMN IF NOT EXISTS guru_pembimbing_user_id UUID
        REFERENCES users(user_id) ON DELETE SET NULL;

-- Partial index: query hanya butuh baris yang sudah diisi guru.
-- WHERE NOT NULL menghindari index bloat untuk baris yang masih kosong.
CREATE INDEX IF NOT EXISTS idx_pkl_placements_guru_pembimbing
    ON pkl_placements(guru_pembimbing_user_id)
    WHERE guru_pembimbing_user_id IS NOT NULL;
