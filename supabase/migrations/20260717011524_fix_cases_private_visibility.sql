-- Fix fn_can_see_case:
-- Kasus PRIVATE hanya terlihat oleh created_by_user_id (via fn_involved_in_case)
-- fn_matches_case_handler TIDAK berlaku untuk PRIVATE
CREATE OR REPLACE FUNCTION fn_can_see_case(p_case_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM cases c
    WHERE c.case_id   = p_case_id
      AND c.school_id = fn_current_school_id()
      AND (
        fn_involved_in_case(p_case_id)
        OR (
          c.audience != 'PRIVATE'
          AND fn_matches_case_handler(c.current_handler_role, c.student_id)
        )
        OR (c.audience = 'PUBLIC' AND fn_is_internal_case_actor())
        OR (c.audience = 'RESTRICTED' AND EXISTS (
          SELECT 1 FROM case_audience_members m
          WHERE m.case_id = p_case_id
            AND m.user_id = fn_current_user_id()
        ))
        OR (
          fn_current_user_role() = 'DUDI'
          AND fn_dudi_supervises_student(c.student_id)
        )
      )
  )
$$;

REVOKE EXECUTE ON FUNCTION fn_can_see_case(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_can_see_case(uuid) FROM anon;
