-- Harden Waka Kesiswaan visibility and attendance recap consistency.
-- No existing rows are changed; this migration only updates functions used by
-- the Waka Kesiswaan portal.

BEGIN;

-- Waka Kesiswaan is the school-wide owner of the coaching queue. Keep the
-- existing creator/handler restrictions for other staff, but allow this role
-- to read cases in its own school through the RLS predicate.
CREATE OR REPLACE FUNCTION public.fn_can_see_coaching_case(p_case_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.coaching_cases c
        WHERE c.case_id = p_case_id
          AND c.school_id = public.fn_current_school_id()
          AND (
              c.created_by_user_id = public.fn_current_user_id()
              OR EXISTS (
                  SELECT 1
                  FROM public.coaching_case_handlers h
                  WHERE h.case_id = p_case_id
                    AND h.handler_user_id = public.fn_current_user_id()
              )
              OR public.fn_current_user_role() = 'ADMINISTRATIVE'::public.role_type
              OR public.fn_is_kepsek()
              OR public.fn_is_waka_kesiswaan()
          )
    );
$$;

REVOKE EXECUTE ON FUNCTION public.fn_can_see_coaching_case(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_can_see_coaching_case(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_can_see_coaching_case(uuid) TO authenticated;

-- Count one attendance block per class. A block may contain several teaching
-- schedule slots, but it is one student meeting in the Waka recap.
CREATE OR REPLACE FUNCTION public.fn_attendance_recap_per_class(
    p_date_start date DEFAULT NULL,
    p_date_end date DEFAULT NULL
)
RETURNS TABLE (
    class_id uuid,
    name text,
    hadir bigint,
    alpa bigint,
    izin bigint,
    sakit bigint,
    total bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        c.class_id,
        c.name,
        COUNT(DISTINCT CASE WHEN a.status = 'HADIR' THEN ts.block_group_id END) AS hadir,
        COUNT(DISTINCT CASE WHEN a.status = 'ALPA'  THEN ts.block_group_id END) AS alpa,
        COUNT(DISTINCT CASE WHEN a.status = 'IZIN'  THEN ts.block_group_id END) AS izin,
        COUNT(DISTINCT CASE WHEN a.status = 'SAKIT' THEN ts.block_group_id END) AS sakit,
        COUNT(DISTINCT CASE WHEN a.attendance_id IS NOT NULL THEN ts.block_group_id END) AS total
    FROM public.classes c
    LEFT JOIN public.teaching_schedules ts
           ON ts.class_id = c.class_id
          AND ts.school_id = public.fn_current_school_id()
          AND ts.academic_year = (
              SELECT sc.current_academic_year
              FROM public.school_config sc
              WHERE sc.school_id = public.fn_current_school_id()
          )
          AND (p_date_start IS NULL OR ts.session_date >= p_date_start)
          AND (p_date_end IS NULL OR ts.session_date <= p_date_end)
    LEFT JOIN public.attendance a
           ON a.schedule_id = ts.schedule_id
          AND NOT a.is_void
    WHERE c.school_id = public.fn_current_school_id()
      AND c.is_active = TRUE
      AND (
          public.fn_current_user_role() = 'ADMINISTRATIVE'::public.role_type
          OR public.fn_is_schoolwide_observer()
          OR (
              public.fn_kaprodi_program_id() IS NOT NULL
              AND c.program_id = public.fn_kaprodi_program_id()
          )
      )
    GROUP BY c.class_id, c.name
    ORDER BY c.name;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_attendance_recap_per_class(date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_attendance_recap_per_class(date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_attendance_recap_per_class(date, date) TO authenticated;

-- Keep the student drill-down on the same block-level contract as the class
-- recap, while retaining active-enrollment and caller-scope checks.
CREATE OR REPLACE FUNCTION public.fn_class_attendance_summary(
    p_class_id uuid,
    p_academic_year text,
    p_date_start date DEFAULT NULL,
    p_date_end date DEFAULT NULL,
    p_teacher_id uuid DEFAULT NULL
)
RETURNS TABLE (
    student_id uuid,
    full_name text,
    nis text,
    hadir bigint,
    alpa bigint,
    izin bigint,
    sakit bigint,
    total bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.users u
        WHERE u.auth_user_id = auth.uid()
          AND u.school_id = public.fn_current_school_id()
          AND u.is_active
          AND u.role_type IN ('GURU','WALI_KELAS','BK','KAPRODI','KEPSEK',
                              'WAKA_KURIKULUM','WAKA_KESISWAAN','WAKA_HUMAS')
    ) THEN
        RAISE EXCEPTION 'Tidak berwenang membaca rekap absensi' USING ERRCODE = '42501';
    END IF;
    IF p_date_start > p_date_end THEN
        RAISE EXCEPTION 'Rentang tanggal tidak valid' USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    SELECT
        s.student_id,
        s.full_name::text,
        s.nis::text,
        COUNT(DISTINCT CASE WHEN a.status = 'HADIR' THEN ts.block_group_id END),
        COUNT(DISTINCT CASE WHEN a.status = 'ALPA'  THEN ts.block_group_id END),
        COUNT(DISTINCT CASE WHEN a.status = 'IZIN'  THEN ts.block_group_id END),
        COUNT(DISTINCT CASE WHEN a.status = 'SAKIT' THEN ts.block_group_id END),
        COUNT(DISTINCT CASE WHEN a.attendance_id IS NOT NULL THEN ts.block_group_id END)
    FROM public.class_enrollments ce
    JOIN public.students s ON s.student_id = ce.student_id
    LEFT JOIN public.teaching_schedules ts
           ON ts.class_id = p_class_id
          AND ts.school_id = public.fn_current_school_id()
          AND ts.academic_year = p_academic_year
          AND (p_date_start IS NULL OR ts.session_date >= p_date_start)
          AND (p_date_end IS NULL OR ts.session_date <= p_date_end)
          AND (p_teacher_id IS NULL OR ts.scheduled_teacher_id = p_teacher_id)
    LEFT JOIN public.attendance a
           ON a.schedule_id = ts.schedule_id
          AND a.student_id = s.student_id
          AND a.school_id = public.fn_current_school_id()
          AND NOT a.is_void
    WHERE ce.class_id = p_class_id
      AND ce.school_id = public.fn_current_school_id()
      AND ce.academic_year = p_academic_year
      AND ce.withdrawn_at IS NULL
      AND s.student_status = 'AKTIF'
      AND s.school_id = public.fn_current_school_id()
      AND public.fn_can_see_student(s.student_id)
    GROUP BY s.student_id, s.full_name, s.nis
    ORDER BY s.full_name;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_class_attendance_summary(uuid, text, date, date, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_class_attendance_summary(uuid, text, date, date, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_class_attendance_summary(uuid, text, date, date, uuid) TO authenticated;

COMMIT;
