-- Hardening portal Guru Piket:
--   * revoke tenant scope for inactive/deleted users;
--   * bind duty authorization to the active academic period;
--   * make Sunday a clean "not on duty" result;
--   * guard student-to-school integrity on attendance/exit writes;
--   * allow on-duty staff to read school students and enrollments;
--   * prevent stale client dates from creating historical records.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_current_school_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT u.school_id
    FROM public.users u
    WHERE u.auth_user_id = auth.uid()
      AND u.is_active IS TRUE
      AND u.deleted_at IS NULL
    LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.fn_current_school_id() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.fn_current_school_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_current_school_id() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.fn_is_on_duty_today()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.duty_schedules ds
        JOIN public.school_config sc
          ON sc.school_id = ds.school_id
        WHERE ds.user_id = public.fn_current_user_id()
          AND ds.school_id = public.fn_current_school_id()
          AND ds.academic_year = sc.current_academic_year
          AND ds.semester::text = sc.current_semester::text
          AND ds.day_of_week = CASE
              WHEN EXTRACT(ISODOW FROM NOW() AT TIME ZONE 'Asia/Jakarta')::int = 1 THEN 'SENIN'::public.day_of_week
              WHEN EXTRACT(ISODOW FROM NOW() AT TIME ZONE 'Asia/Jakarta')::int = 2 THEN 'SELASA'::public.day_of_week
              WHEN EXTRACT(ISODOW FROM NOW() AT TIME ZONE 'Asia/Jakarta')::int = 3 THEN 'RABU'::public.day_of_week
              WHEN EXTRACT(ISODOW FROM NOW() AT TIME ZONE 'Asia/Jakarta')::int = 4 THEN 'KAMIS'::public.day_of_week
              WHEN EXTRACT(ISODOW FROM NOW() AT TIME ZONE 'Asia/Jakarta')::int = 5 THEN 'JUMAT'::public.day_of_week
              WHEN EXTRACT(ISODOW FROM NOW() AT TIME ZONE 'Asia/Jakarta')::int = 6 THEN 'SABTU'::public.day_of_week
              ELSE NULL::public.day_of_week
          END
          AND ds.is_active IS TRUE
    );
$$;
REVOKE EXECUTE ON FUNCTION public.fn_is_on_duty_today() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_is_on_duty_today() FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_is_on_duty_today() TO authenticated;

DROP POLICY IF EXISTS rls_students_read_piket ON public.students;
CREATE POLICY rls_students_read_piket ON public.students
FOR SELECT
USING (
    school_id = public.fn_current_school_id()
    AND public.fn_is_on_duty_today()
);

DROP POLICY IF EXISTS rls_enrollments_read_piket ON public.class_enrollments;
CREATE POLICY rls_enrollments_read_piket ON public.class_enrollments
FOR SELECT
USING (
    school_id = public.fn_current_school_id()
    AND public.fn_is_on_duty_today()
);

DROP POLICY IF EXISTS rls_late_arrivals_insert ON public.late_arrivals;
CREATE POLICY rls_late_arrivals_insert ON public.late_arrivals
FOR INSERT
WITH CHECK (
    school_id = public.fn_current_school_id()
    AND public.fn_student_in_current_school(student_id)
    AND public.fn_is_on_duty_today()
    AND recorded_by = public.fn_current_user_id()
    AND late_date = (NOW() AT TIME ZONE 'Asia/Jakarta')::date
);

DROP POLICY IF EXISTS rls_exits_insert_piket ON public.student_exits;
CREATE POLICY rls_exits_insert_piket ON public.student_exits
FOR INSERT
WITH CHECK (
    school_id = public.fn_current_school_id()
    AND public.fn_student_in_current_school(student_id)
    AND recorded_by = public.fn_current_user_id()
    AND public.fn_is_on_duty_today()
    AND exit_date = (NOW() AT TIME ZONE 'Asia/Jakarta')::date
);

COMMIT;
