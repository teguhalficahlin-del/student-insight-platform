BEGIN;

CREATE OR REPLACE FUNCTION public.fn_class_attendance_summary(
    p_class_id UUID,
    p_academic_year TEXT,
    p_date_start DATE DEFAULT NULL,
    p_date_end DATE DEFAULT NULL,
    p_teacher_id UUID DEFAULT NULL
)
RETURNS TABLE (
    student_id UUID, full_name TEXT, nis TEXT,
    hadir BIGINT, alpa BIGINT, izin BIGINT, sakit BIGINT, total BIGINT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.users u
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
    SELECT s.student_id, s.full_name::TEXT, s.nis::TEXT,
        COUNT(a.attendance_id) FILTER (WHERE a.status = 'HADIR'),
        COUNT(a.attendance_id) FILTER (WHERE a.status = 'ALPA'),
        COUNT(a.attendance_id) FILTER (WHERE a.status = 'IZIN'),
        COUNT(a.attendance_id) FILTER (WHERE a.status = 'SAKIT'),
        COUNT(a.attendance_id)
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

-- Wali can inspect every teacher's session in their class without widening schedule RLS.
CREATE OR REPLACE FUNCTION public.fn_wali_attendance_sessions(
    p_class_id UUID,
    p_academic_year TEXT,
    p_student_id UUID,
    p_date_start DATE DEFAULT NULL,
    p_date_end DATE DEFAULT NULL
)
RETURNS TABLE (
    attendance_id UUID, status public.attendance_status, notes TEXT,
    session_date DATE, session_start TIME, session_end TIME,
    subject_label TEXT, teacher_full_name TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.users u
        JOIN public.classes c ON c.class_id = u.wali_kelas_class_id AND c.school_id = u.school_id
        WHERE u.auth_user_id = auth.uid()
          AND u.school_id = public.fn_current_school_id()
          AND u.is_active
          AND u.wali_kelas_class_id = p_class_id
          AND u.role_type IN ('GURU','WALI_KELAS','BK','KAPRODI','KEPSEK',
                              'WAKA_KURIKULUM','WAKA_KESISWAAN','WAKA_HUMAS')
    ) THEN
        RAISE EXCEPTION 'Tidak berwenang membaca detail absensi kelas ini' USING ERRCODE = '42501';
    END IF;
    IF p_date_start > p_date_end THEN
        RAISE EXCEPTION 'Rentang tanggal tidak valid' USING ERRCODE = '22023';
    END IF;

    RETURN QUERY
    SELECT a.attendance_id, a.status, a.notes,
        ts.session_date, ts.session_start, ts.session_end,
        ts.subject_label::TEXT, teacher.full_name::TEXT
    FROM public.attendance a
    JOIN public.teaching_schedules ts ON ts.schedule_id = a.schedule_id
    JOIN public.students s ON s.student_id = a.student_id
    LEFT JOIN public.users teacher
        ON teacher.user_id = ts.scheduled_teacher_id AND teacher.school_id = ts.school_id
    WHERE ts.class_id = p_class_id
      AND ts.school_id = public.fn_current_school_id()
      AND ts.academic_year = p_academic_year
      AND a.student_id = p_student_id
      AND a.school_id = public.fn_current_school_id()
      AND NOT a.is_void
      AND s.school_id = public.fn_current_school_id()
      AND s.student_status = 'AKTIF'
      AND (p_date_start IS NULL OR ts.session_date >= p_date_start)
      AND (p_date_end IS NULL OR ts.session_date <= p_date_end)
      AND EXISTS (
          SELECT 1 FROM public.class_enrollments ce
          WHERE ce.student_id = s.student_id
            AND ce.class_id = p_class_id
            AND ce.school_id = public.fn_current_school_id()
            AND ce.academic_year = p_academic_year
            AND ce.withdrawn_at IS NULL
      )
    ORDER BY ts.session_date DESC, ts.session_start, a.attendance_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_class_attendance_summary(UUID, TEXT, DATE, DATE, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_class_attendance_summary(UUID, TEXT, DATE, DATE, UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_wali_attendance_sessions(UUID, TEXT, UUID, DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_wali_attendance_sessions(UUID, TEXT, UUID, DATE, DATE) TO authenticated;

COMMIT;
