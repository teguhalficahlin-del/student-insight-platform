-- Tambah kolom nama dan jurusan ke subject_code_aliases
-- agar Nama Mapel Lengkap dan Jurusan/Konteks persisten lintas sesi.

ALTER TABLE public.subject_code_aliases
    ADD COLUMN IF NOT EXISTS nama    TEXT,
    ADD COLUMN IF NOT EXISTS jurusan TEXT;
