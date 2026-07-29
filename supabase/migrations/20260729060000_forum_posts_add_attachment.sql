-- Tambah kolom attachment ke forum_posts untuk Forum Sekolah.
-- Forum Kelas lama tidak menggunakan kolom ini (nullable, default NULL).

ALTER TABLE public.forum_posts
  ADD COLUMN IF NOT EXISTS attachment_url  text,
  ADD COLUMN IF NOT EXISTS attachment_name text;
