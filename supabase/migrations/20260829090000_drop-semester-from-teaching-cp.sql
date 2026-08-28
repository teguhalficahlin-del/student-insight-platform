-- Migration: Hapus kolom semester dari teaching_cp
-- Constraint baru: UNIQUE (school_id, teacher_id, class_id, subject_id, academic_year)
-- CP kini satu per kombinasi kelas+mapel+tahun ajaran (tidak dibedakan per semester)

BEGIN;

-- Hapus UNIQUE constraint lama (menyertakan semester)
ALTER TABLE teaching_cp
    DROP CONSTRAINT IF EXISTS
    "teaching_cp_school_id_teacher_id_class_id_subject_id_academ_key";

-- Hapus kolom semester
ALTER TABLE teaching_cp DROP COLUMN IF EXISTS semester;

-- Tambah UNIQUE constraint baru (tanpa semester)
ALTER TABLE teaching_cp
    ADD CONSTRAINT teaching_cp_school_teacher_class_subject_year_key
    UNIQUE (school_id, teacher_id, class_id, subject_id, academic_year);

COMMIT;
