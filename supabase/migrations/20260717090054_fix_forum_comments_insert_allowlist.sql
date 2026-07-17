DROP POLICY IF EXISTS rls_forum_comments_insert ON forum_post_comments;

CREATE POLICY rls_forum_comments_insert ON forum_post_comments
  FOR INSERT
  WITH CHECK (
    school_id = fn_current_school_id()
    AND author_user_id = fn_current_user_id()
    AND fn_can_read_forum_post(post_id)
    AND fn_current_user_role() = ANY(ARRAY[
      'GURU','BK','WALI_KELAS','KAPRODI','KEPSEK',
      'ADMINISTRATIVE','WAKA_KURIKULUM','WAKA_KESISWAAN','WAKA_HUMAS',
      'ORTU'
    ]::role_type[])
  );
