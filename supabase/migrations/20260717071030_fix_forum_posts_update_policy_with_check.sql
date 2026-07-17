DROP POLICY IF EXISTS rls_forum_posts_update ON forum_posts;

CREATE POLICY rls_forum_posts_update ON forum_posts
  FOR UPDATE
  USING (
    school_id      = fn_current_school_id()
    AND author_user_id = fn_current_user_id()
  )
  WITH CHECK (
    school_id      = fn_current_school_id()
    AND author_user_id = fn_current_user_id()
    AND class_id      = (SELECT fp2.class_id      FROM forum_posts fp2 WHERE fp2.post_id = forum_posts.post_id)
    AND visibility    = (SELECT fp2.visibility    FROM forum_posts fp2 WHERE fp2.post_id = forum_posts.post_id)
    AND academic_year = (SELECT fp2.academic_year FROM forum_posts fp2 WHERE fp2.post_id = forum_posts.post_id)
  );
