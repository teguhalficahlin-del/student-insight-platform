-- ============================================================
-- FORUM-FIX-01 — rls_forum_posts_update: NULL-safe comparison
--
-- MASALAH:
--   WITH CHECK policy rls_forum_posts_update membandingkan kolom
--   struktural dengan operator `=` biasa:
--       class_id = (SELECT fp2.class_id FROM forum_posts fp2 ...)
--   Untuk posting scope SEKOLAH, class_id bernilai NULL. Ekspresi
--   `NULL = NULL` menghasilkan NULL, dan WITH CHECK menolak apa pun
--   yang bukan TRUE. Akibatnya SEMUA UPDATE ke posting Forum Sekolah
--   ditolak dengan 42501 (HTTP 403) — termasuk pemasangan lampiran
--   (setForumAttachment) dan edit judul/isi.
--
-- BUKTI REPRODUKSI (sebagai author, dalam BEGIN...ROLLBACK):
--   UPDATE forum_posts SET attachment_url='x' WHERE post_id='d9654c34-...';
--   ERROR: 42501: new row violates row-level security policy
--   Evaluasi klausa: chk_class_id = NULL, chk_visibility = true,
--                    chk_year = true, class_id = NULL
--
-- FIX:
--   Ganti `=` menjadi `IS NOT DISTINCT FROM` pada class_id,
--   visibility, dan academic_year — konsisten dengan audience_type
--   dan audience_type_2 yang sudah NULL-safe sejak migration
--   20260717093927.
--
-- CAKUPAN KEAMANAN — TIDAK BERUBAH:
--   school_id dan author_user_id tetap dibandingkan dengan `=`
--   sehingga isolasi tenant dan kepemilikan posting tidak melonggar.
--   Kolom struktural tetap dikunci tidak boleh diubah oleh UPDATE;
--   yang berubah hanya perlakuan NULL (kini dianggap sama dengan
--   NULL, bukan "tidak diketahui").
--
-- IDEMPOTENSI:
--   PostgreSQL tidak mengenal CREATE POLICY IF NOT EXISTS, jadi
--   dipakai pola DROP POLICY IF EXISTS + CREATE POLICY.
--
-- PRIVILEGE:
--   Tidak ada CREATE FUNCTION SECURITY DEFINER baru, sehingga aturan
--   GRANT + dua REVOKE (CLAUDE.md §6c) tidak berlaku di migration ini.
-- ============================================================

BEGIN;

DROP POLICY IF EXISTS rls_forum_posts_update ON forum_posts;

CREATE POLICY rls_forum_posts_update ON forum_posts
  FOR UPDATE
  USING (
    school_id          = fn_current_school_id()
    AND author_user_id = fn_current_user_id()
  )
  WITH CHECK (
    school_id          = fn_current_school_id()
    AND author_user_id = fn_current_user_id()
    AND class_id        IS NOT DISTINCT FROM
        (SELECT fp2.class_id        FROM forum_posts fp2 WHERE fp2.post_id = forum_posts.post_id)
    AND visibility      IS NOT DISTINCT FROM
        (SELECT fp2.visibility      FROM forum_posts fp2 WHERE fp2.post_id = forum_posts.post_id)
    AND academic_year   IS NOT DISTINCT FROM
        (SELECT fp2.academic_year   FROM forum_posts fp2 WHERE fp2.post_id = forum_posts.post_id)
    AND audience_type   IS NOT DISTINCT FROM
        (SELECT fp2.audience_type   FROM forum_posts fp2 WHERE fp2.post_id = forum_posts.post_id)
    AND audience_type_2 IS NOT DISTINCT FROM
        (SELECT fp2.audience_type_2 FROM forum_posts fp2 WHERE fp2.post_id = forum_posts.post_id)
  );

COMMIT;
