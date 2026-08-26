-- ADAPT-A: CHECK constraint nilai 0-100 untuk tiga tabel penilaian
-- Idempotent via EXCEPTION WHEN duplicate_object

BEGIN;

DO $$ BEGIN
  ALTER TABLE public.assessment_results
    ADD CONSTRAINT assessment_results_nilai_range
    CHECK (nilai IS NULL OR nilai BETWEEN 0 AND 100);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.student_grades
    ADD CONSTRAINT student_grades_nilai_angka_range
    CHECK (nilai_angka IS NULL OR nilai_angka BETWEEN 0 AND 100);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.grade_recap
    ADD CONSTRAINT grade_recap_nilai_akhir_range
    CHECK (nilai_akhir IS NULL OR nilai_akhir BETWEEN 0 AND 100);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
