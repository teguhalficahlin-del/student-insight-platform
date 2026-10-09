-- Waka Humas reads PKL students across programs in their own school.
-- Keep this scope separate from school-wide access to non-PKL student data.
CREATE OR REPLACE FUNCTION public.fn_is_waka_humas()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.auth_user_id = auth.uid()
          AND u.is_active IS TRUE
          AND u.deleted_at IS NULL
          AND (u.role_type = 'WAKA_HUMAS' OR u.is_waka_humas)
    );
$$;

GRANT EXECUTE ON FUNCTION public.fn_is_waka_humas() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.fn_is_waka_humas() FROM anon, PUBLIC;

DROP POLICY IF EXISTS rls_students_read_waka_humas_pkl ON public.students;
CREATE POLICY rls_students_read_waka_humas_pkl ON public.students
    FOR SELECT TO authenticated
    USING (
        school_id = public.fn_current_school_id()
        AND student_status = 'PKL'
        AND public.fn_is_waka_humas()
    );

DROP POLICY IF EXISTS rls_pkl_read_waka_humas ON public.pkl_placements;
CREATE POLICY rls_pkl_read_waka_humas ON public.pkl_placements
    FOR SELECT TO authenticated
    USING (
        school_id = public.fn_current_school_id()
        AND public.fn_is_waka_humas()
    );

DROP POLICY IF EXISTS rls_observations_read_pkl_supervisor ON public.observations;
CREATE POLICY rls_observations_read_pkl_supervisor ON public.observations
    FOR SELECT TO authenticated
    USING (
        school_id = public.fn_current_school_id()
        AND visibility = 'RESTRICTED'
        AND is_void = false
        AND (public.fn_current_user_role() = 'KAPRODI' OR public.fn_is_waka_humas())
    );

CREATE OR REPLACE FUNCTION public.fn_pkl_attendance_recap(
    p_student_ids uuid[],
    p_date_start date DEFAULT NULL,
    p_date_end date DEFAULT NULL
)
RETURNS TABLE (
    student_id uuid,
    hadir bigint,
    alpa bigint,
    izin bigint,
    sakit bigint,
    total bigint
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        s.student_id,
        COUNT(pa.pkl_attendance_id) FILTER (WHERE pa.status = 'HADIR') AS hadir,
        COUNT(pa.pkl_attendance_id) FILTER (WHERE pa.status = 'ALPA') AS alpa,
        COUNT(pa.pkl_attendance_id) FILTER (WHERE pa.status = 'IZIN') AS izin,
        COUNT(pa.pkl_attendance_id) FILTER (WHERE pa.status = 'SAKIT') AS sakit,
        COUNT(pa.pkl_attendance_id) AS total
    FROM unnest(p_student_ids) AS requested(student_id)
    JOIN public.students s
      ON s.student_id = requested.student_id
     AND s.school_id = public.fn_current_school_id()
     AND (
         public.fn_current_user_role() = 'ADMINISTRATIVE'
         OR public.fn_is_schoolwide_observer()
         OR (public.fn_is_waka_humas() AND s.student_status = 'PKL')
         OR (
             public.fn_kaprodi_program_id() IS NOT NULL
             AND s.program_id = public.fn_kaprodi_program_id()
         )
     )
    LEFT JOIN public.pkl_attendance pa
      ON pa.student_id = s.student_id
     AND pa.school_id = public.fn_current_school_id()
     AND (p_date_start IS NULL OR pa.attendance_date >= p_date_start)
     AND (p_date_end IS NULL OR pa.attendance_date <= p_date_end)
    GROUP BY s.student_id;
$$;

GRANT EXECUTE ON FUNCTION public.fn_pkl_attendance_recap(uuid[], date, date) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_pkl_attendance_recap(uuid[], date, date) FROM anon, PUBLIC;
