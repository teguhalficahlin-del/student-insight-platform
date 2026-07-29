-- Fix circular dependency di RLS forum_post_audience.
--
-- Masalah: rls_forum_aud_read memanggil fn_can_read_forum_post,
-- yang untuk scope_type='SEKOLAH' query ke forum_post_audience lagi
-- → circular dependency → HTTP 400.
--
-- Solusi: tambah policy terpisah untuk scope SEKOLAH yang cek langsung
-- user_id = fn_current_user_id() tanpa lewat fn_can_read_forum_post.
-- Policy lama tetap aktif untuk scope KELAS.

CREATE POLICY rls_forum_aud_sekolah_read
ON public.forum_post_audience FOR SELECT
USING (
    school_id = fn_current_school_id()
    AND user_id = fn_current_user_id()
    AND EXISTS (
        SELECT 1 FROM public.forum_posts fp
        WHERE fp.post_id = forum_post_audience.post_id
          AND fp.scope_type = 'SEKOLAH'
          AND fp.school_id = fn_current_school_id()
          AND fp.is_withdrawn = false
    )
);

-- Tambah juga policy untuk author bisa baca audience posting miliknya
-- (dibutuhkan untuk tab Terkirim — author perlu tahu jumlah penerima)
CREATE POLICY rls_forum_aud_author_read
ON public.forum_post_audience FOR SELECT
USING (
    school_id = fn_current_school_id()
    AND EXISTS (
        SELECT 1 FROM public.forum_posts fp
        WHERE fp.post_id = forum_post_audience.post_id
          AND fp.author_user_id = fn_current_user_id()
          AND fp.school_id = fn_current_school_id()
    )
);
