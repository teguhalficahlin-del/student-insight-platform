-- Tambah kolom kelas ke subject_code_aliases
-- agar "Berlaku di Kelas" tersimpan persisten lintas sesi.

ALTER TABLE public.subject_code_aliases
    ADD COLUMN IF NOT EXISTS kelas TEXT;
