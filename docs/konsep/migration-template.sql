-- ============================================================
-- Migration YYYYMMDDHHMMSS: <ringkasan satu kalimat>
-- ROLLBACK:
--   <perintah SQL persis untuk membalik perubahan ini, contoh:>
--   DROP POLICY IF EXISTS <nama_policy> ON <tabel>;
--   DROP FUNCTION IF EXISTS <nama_fungsi>();
--   ALTER TABLE <tabel> DROP COLUMN IF EXISTS <kolom>;
--   -- ATAU jika tidak bisa dibalik via SQL:
--   -- "Restore backup <tanggal/PITR> — perubahan tidak reversibel via SQL."
-- SNAPSHOT PRA-APPLY: scratchpad/pre-mig-YYYYMMDDHHMMSS.json
-- ============================================================

-- Penjelasan singkat: APA yang diubah dan MENGAPA (1-2 kalimat).
-- Contoh: "Tambah kolom is_active ke tabel users. Dibutuhkan untuk
-- menonaktifkan akun tanpa menghapus data historis (audit trail)."

-- ── Badan migrasi ─────────────────────────────────────────────

-- Tulis DDL/DML di sini.
-- Gunakan IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS
-- agar migrasi idempoten (aman diulang jika terpotong).

-- ── Checklist sebelum apply (hapus bagian ini setelah dikonfirmasi) ──
-- [ ] Snapshot pra-apply sudah diambil dan disimpan di scratchpad/
-- [ ] Migrasi idempoten (aman diulang)
-- [ ] Rollback tertulis di header atas
-- [ ] tenant-isolation.mjs sudah hijau sebelum apply
-- [ ] Setelah apply: jalankan ulang tenant-isolation.mjs
