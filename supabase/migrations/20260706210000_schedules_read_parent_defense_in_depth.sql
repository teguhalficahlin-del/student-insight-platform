-- Defense-in-depth: tambahkan ce.school_id = fn_current_school_id() eksplisit
-- di subquery EXISTS rls_schedules_read_parent.
--
-- Sebelumnya policy bergantung pada RLS implisit class_enrollments dan
-- student_parents untuk memblokir cross-tenant. Kondisi ini menambahkan
-- jaminan eksplisit sehingga tidak ada langkah dalam rantai join yang
-- tanpa school_id filter (temuan fase 2.2, audit Kelompok A).
-- BUKAN menutup celah aktif — teaching_schedules sudah ada guard eksplisit
-- di tabel utama — ini lapisan kedua.

DROP POLICY IF EXISTS rls_schedules_read_parent ON teaching_schedules;

CREATE POLICY rls_schedules_read_parent ON teaching_schedules
FOR SELECT
USING (
  school_id = fn_current_school_id()
  AND fn_current_user_role() = 'ORTU'::role_type
  AND EXISTS (
    SELECT 1
    FROM class_enrollments ce
    JOIN student_parents sp ON sp.student_id = ce.student_id
    WHERE ce.class_id = teaching_schedules.class_id
      AND ce.school_id = fn_current_school_id()
      AND ce.withdrawn_at IS NULL
      AND sp.parent_user_id = fn_current_user_id()
  )
);
