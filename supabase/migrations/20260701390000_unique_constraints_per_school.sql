-- ============================================================
-- Migration 390000: Unique constraints per-school
--
-- Sebelumnya: programs.code, classes(name,academic_year), dan
-- subjects.code unik secara global. Artinya dua sekolah tidak
-- bisa memakai kode program / nama kelas / kode subjek yang sama
-- → onboarding sekolah ke-2 akan error UNIQUE violation.
--
-- Sesudahnya: constraint menyertakan school_id sebagai kolom
-- pertama → unik PER sekolah, lintas sekolah boleh sama.
-- ============================================================

-- ── programs: (code) → (school_id, code) ──────────────────────
ALTER TABLE programs
    DROP CONSTRAINT programs_code_key,
    ADD CONSTRAINT uq_programs_school_code UNIQUE (school_id, code);

-- ── subjects: (code) → (school_id, code) ──────────────────────
ALTER TABLE subjects
    DROP CONSTRAINT subjects_code_key,
    ADD CONSTRAINT uq_subjects_school_code UNIQUE (school_id, code);

-- ── classes: (name, academic_year) → (school_id, name, academic_year) ──
ALTER TABLE classes
    DROP CONSTRAINT uq_class_name_year,
    ADD CONSTRAINT uq_classes_school_name_year UNIQUE (school_id, name, academic_year);
