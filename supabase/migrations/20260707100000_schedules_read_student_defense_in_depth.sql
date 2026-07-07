-- Defense-in-depth: tambah ce.school_id = fn_current_school_id() eksplisit
-- di subquery EXISTS rls_schedules_read_student, simetris dengan fix yang
-- sudah diterapkan ke rls_schedules_read_parent (mig 20260706210000).
--
-- Sebelumnya subquery bergantung pada RLS implisit class_enrollments;
-- kini school_id di-guard eksplisit di dalam subquery itu sendiri.
-- Logika lain (match class_id, fn_current_student_id(), withdrawn_at) tidak berubah.

DROP POLICY IF EXISTS rls_schedules_read_student ON public.teaching_schedules;

CREATE POLICY rls_schedules_read_student
  ON public.teaching_schedules
  FOR SELECT
  USING (
    school_id = fn_current_school_id()
    AND fn_current_user_role() = 'SISWA'
    AND EXISTS (
      SELECT 1 FROM class_enrollments ce
      WHERE ce.class_id   = teaching_schedules.class_id
        AND ce.student_id = fn_current_student_id()
        AND ce.school_id  = fn_current_school_id()
        AND ce.withdrawn_at IS NULL
    )
  );
