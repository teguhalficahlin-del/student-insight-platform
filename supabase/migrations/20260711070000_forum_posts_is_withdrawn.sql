-- Migration: tambah kolom is_withdrawn ke forum_posts
-- Dipakai oleh fn_can_read_forum_post untuk menyembunyikan
-- posting yang ditarik dari audience (kecuali author +
-- KEPSEK/WAKA_KESISWAAN/ADMINISTRATIVE).

ALTER TABLE public.forum_posts
    ADD COLUMN IF NOT EXISTS is_withdrawn BOOLEAN
    NOT NULL DEFAULT false;

-- RLS UPDATE policy sudah ada (rls_forum_posts_update):
-- author bisa update posting sendiri, termasuk set
-- is_withdrawn = true. Tidak perlu policy baru.
