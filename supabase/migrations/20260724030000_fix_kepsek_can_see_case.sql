-- Fix: tambah cabang OR fn_is_kepsek() ke fn_can_see_case()
-- Bug: KEPSEK tidak bisa lihat kasus PRIVATE/RESTRICTED yang tidak melibatkan
-- mereka sebagai handler, creator, atau audience member.
-- Fix: tambah fn_is_kepsek() sebagai cabang kedua setelah fn_involved_in_case(),
-- sehingga KEPSEK selalu bisa lihat semua kasus di sekolahnya.

CREATE OR REPLACE FUNCTION fn_can_see_case(p_case_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1 FROM cases c
    WHERE c.case_id   = p_case_id
      AND c.school_id = fn_current_school_id()
      AND (
        fn_involved_in_case(p_case_id)
        OR fn_is_kepsek()
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
