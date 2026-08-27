-- C/DB-01: Audit composite FK tenant consistency pada tabel forum.
--
-- Temuan: semua tabel forum punya FK ke schools(school_id) + forum_posts(post_id) secara terpisah.
-- Tidak ada composite FK (school_id, post_id) → (forum_posts.school_id, forum_posts.post_id).
--
-- Alasan tidak diimplementasi:
--   (1) forum_posts hanya punya PRIMARY KEY(post_id), tidak ada UNIQUE(school_id, post_id).
--       Menambah composite unique memerlukan migrasi data dan index besar.
--   (2) RLS USING clause pada semua tabel forum sudah enforce school_id isolation untuk
--       semua operasi SELECT, INSERT, UPDATE, DELETE dari role authenticated.
--   (3) Risiko cross-tenant insert hanya terjadi jika RLS dibypass (service_role),
--       yang sudah di-mitigasi oleh arsitektur: edge functions tidak expose endpoint
--       INSERT forum_post_comments/audience/subjects secara langsung.
--
-- Accepted Risk: composite FK tidak ada di level DB; perlindungan sepenuhnya via RLS.
-- Status: No actionable gap. Migration ini hanya dokumentasi audit.

SELECT 'DB-01: No composite FK migration needed — RLS-enforced isolation sufficient' AS status;
