-- Tambah kolom yang dibutuhkan query Forum Sekolah di semua portal.
-- is_withdrawn tetap ada (semantik berbeda: posting ditarik author,
-- masih bisa dilihat admin). deleted_at adalah soft-delete permanen.

ALTER TABLE public.forum_posts
  ADD COLUMN IF NOT EXISTS is_edited   boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS edited_at   timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at  timestamptz;
