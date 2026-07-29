-- Hapus semua posting Forum Kelas (scope_type='KELAS') dari semua school.
-- Child tables (audience, comments, subjects, acknowledgements) ikut terhapus
-- via ON DELETE CASCADE yang sudah ada.
-- notifications.forum_post_id di-SET NULL otomatis (bukan CASCADE).

DELETE FROM public.forum_posts
WHERE scope_type = 'KELAS';
