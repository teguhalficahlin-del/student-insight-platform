-- Fix v2: rls_cases_insert — ganti EXISTS subquery biasa dengan
-- SECURITY DEFINER function agar pengecekan student ↔ school tidak
-- dibatasi RLS students (GURU hanya "melihat" siswa yang diajarnya,
-- padahal boleh membuat kasus untuk siswa mana pun di sekolahnya).
--
-- fn_student_in_current_school: mirip pola fn_student_is_on_pkl —
-- SECURITY DEFINER agar bisa baca students.school_id tanpa RLS filter.

-- 1. Buat fungsi helper SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.fn_student_in_current_school(p_student_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM students st
    WHERE st.student_id = p_student_id
      AND st.school_id  = fn_current_school_id()
  );
$$;

-- Ikuti SECURITY DEFINER REVOKE rule: cabut dari PUBLIC/anon, beri ke authenticated
REVOKE EXECUTE ON FUNCTION public.fn_student_in_current_school(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_student_in_current_school(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_student_in_current_school(uuid) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_student_in_current_school(uuid) TO service_role;

-- 2. Ganti policy dengan versi yang memakai fungsi baru
DROP POLICY IF EXISTS rls_cases_insert ON public.cases;

CREATE POLICY rls_cases_insert
  ON public.cases
  FOR INSERT
  WITH CHECK (
    school_id = fn_current_school_id()
    -- Guard: student_id harus milik sekolah yang sama (bypass RLS students via SECURITY DEFINER)
    AND fn_student_in_current_school(student_id)
    AND (
      (fn_current_user_role() = 'DUDI'::role_type)
      OR (
        fn_current_user_role() = ANY (ARRAY[
          'GURU'::role_type, 'BK'::role_type, 'WALI_KELAS'::role_type,
          'KAPRODI'::role_type, 'KEPSEK'::role_type,
          'WAKA_KESISWAAN'::role_type, 'WAKA_HUMAS'::role_type
        ])
        AND NOT fn_student_is_on_pkl(student_id)
      )
      OR (fn_is_bk()             AND NOT fn_student_is_on_pkl(student_id))
      OR (fn_is_kepsek()         AND NOT fn_student_is_on_pkl(student_id))
      OR (fn_is_waka_kesiswaan() AND NOT fn_student_is_on_pkl(student_id))
    )
  );
