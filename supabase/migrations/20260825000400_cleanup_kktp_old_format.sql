-- Hapus baris KKTP format lama (batas_bawah/batas_atas)
-- yang sudah tidak dipakai JS. Format baru pakai rentang JSONB.
-- Data ini adalah sisa testing 12 Agustus 2026.
-- Verifikasi pra-migration (2026-08-25):
--   5 baris rentang IS NULL, 4 baris rentang IS NOT NULL tersisa
--   grade_recap terdampak  = 0
--   assessments terdampak  = 0
--   sisa duplikat setelah delete = 0 baris
BEGIN;

DELETE FROM assessment_criteria
WHERE rentang IS NULL;

-- Setelah baris lama dihapus, pasang UNIQUE constraint:
-- satu TP hanya boleh punya satu KKTP (keputusan desain).
-- Dibungkus guard agar idempotent (CLAUDE.md 6c).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'assessment_criteria'::regclass
          AND conname  = 'uq_ac_per_lo'
    ) THEN
        ALTER TABLE assessment_criteria
            ADD CONSTRAINT uq_ac_per_lo
            UNIQUE (learning_objective_id);
    END IF;
END $$;

COMMIT;
