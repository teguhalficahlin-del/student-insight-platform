-- C/DB-02: Tambah moddatetime trigger ke tabel forum yang punya kolom updated_at.
-- Tabel yang punya updated_at tapi belum punya trigger: forum_posts, forum_post_comments.
-- Junction tables (forum_post_acknowledgements, forum_post_audience, forum_post_subjects)
-- tidak perlu trigger karena tidak di-UPDATE.
-- Menggunakan fn_set_updated_at() yang sudah ada di schema public (bukan extensions.moddatetime
-- yang tidak terpasang di project ini).

CREATE OR REPLACE TRIGGER trg_forum_posts_updated_at
  BEFORE UPDATE ON public.forum_posts
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_set_updated_at();

CREATE OR REPLACE TRIGGER trg_forum_post_comments_updated_at
  BEFORE UPDATE ON public.forum_post_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_set_updated_at();
