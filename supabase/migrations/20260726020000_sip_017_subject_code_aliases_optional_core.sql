-- Migration: subject_code_aliases — core_subject_id opsional
-- Sekolah SMK punya mapel kejuruan yang tidak ada di core.subjects.
-- Kode tersebut tetap perlu disimpan agar Terapkan Jadwal bisa resolve
-- nama tampilan, meski tanpa tautan ke kurikulum nasional.

ALTER TABLE public.subject_code_aliases
    ALTER COLUMN core_subject_id DROP NOT NULL;
