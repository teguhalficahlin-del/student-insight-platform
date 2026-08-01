ALTER TABLE public.forum_posts
    ADD COLUMN IF NOT EXISTS attachment_path TEXT;
