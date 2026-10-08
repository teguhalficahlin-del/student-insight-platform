-- Restrict monitoring to active curriculum managers and school administrators.
-- Participation and incomplete-session counts may overlap for the same teacher.
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_waka_kur_stats(
    p_date_start date DEFAULT NULL,
    p_date_end date DEFAULT NULL
)
RETURNS TABLE (guru_hadir bigint, guru_total bigint, guru_belum bigint, pct_hadir numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_school_id uuid;
BEGIN
    SELECT u.school_id INTO v_school_id
    FROM public.users u
    WHERE u.auth_user_id = auth.uid() AND u.is_active
      AND (u.role_type IN ('WAKA_KURIKULUM', 'KEPSEK', 'ADMINISTRATIVE')
           OR u.is_waka_kurikulum OR u.is_kepsek)
    LIMIT 1;
    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'Akses monitoring kurikulum ditolak' USING ERRCODE = '42501';
    END IF;
    IF p_date_start > p_date_end THEN
        RAISE EXCEPTION 'Tanggal awal tidak boleh melewati tanggal akhir' USING ERRCODE = '22007';
    END IF;

    RETURN QUERY
    WITH sessions AS (
        SELECT ts.scheduled_teacher_id,
            EXISTS (
                SELECT 1 FROM public.attendance a
                WHERE a.schedule_id = ts.schedule_id AND NOT a.is_void
            ) AS filled
        FROM public.teaching_schedules ts
        WHERE ts.school_id = v_school_id
          AND ts.meeting_status = 'NORMAL'
          AND (p_date_start IS NULL OR ts.session_date >= p_date_start)
          AND (p_date_end IS NULL OR ts.session_date <= p_date_end)
    ), teachers AS (
        SELECT s.scheduled_teacher_id, bool_or(s.filled) AS started,
            bool_or(NOT s.filled) AS pending
        FROM sessions s
        WHERE s.scheduled_teacher_id IS NOT NULL
        GROUP BY s.scheduled_teacher_id
    )
    SELECT count(*) FILTER (WHERE t.started), count(*),
        count(*) FILTER (WHERE t.pending),
        round(100.0 * count(*) FILTER (WHERE t.started) / nullif(count(*), 0), 1)
    FROM teachers t;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_pending_sessions_by_teacher(
    p_date_start date DEFAULT NULL,
    p_date_end date DEFAULT NULL
)
RETURNS TABLE (teacher_id uuid, teacher_name text, jumlah bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_school_id uuid;
BEGIN
    SELECT u.school_id INTO v_school_id
    FROM public.users u
    WHERE u.auth_user_id = auth.uid() AND u.is_active
      AND (u.role_type IN ('WAKA_KURIKULUM', 'KEPSEK', 'ADMINISTRATIVE')
           OR u.is_waka_kurikulum OR u.is_kepsek)
    LIMIT 1;
    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'Akses monitoring kurikulum ditolak' USING ERRCODE = '42501';
    END IF;
    IF p_date_start > p_date_end THEN
        RAISE EXCEPTION 'Tanggal awal tidak boleh melewati tanggal akhir' USING ERRCODE = '22007';
    END IF;

    RETURN QUERY
    SELECT u.user_id, u.full_name::text, count(*)
    FROM public.teaching_schedules ts
    JOIN public.users u ON u.user_id = ts.scheduled_teacher_id
    WHERE ts.school_id = v_school_id
      AND ts.meeting_status = 'NORMAL'
      AND NOT EXISTS (
          SELECT 1 FROM public.attendance a
          WHERE a.schedule_id = ts.schedule_id AND NOT a.is_void
      )
      AND (p_date_start IS NULL OR ts.session_date >= p_date_start)
      AND (p_date_end IS NULL OR ts.session_date <= p_date_end)
    GROUP BY u.user_id, u.full_name
    ORDER BY count(*) DESC, u.full_name;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_pending_sessions_detail(
    p_teacher_id uuid,
    p_date_start date DEFAULT NULL,
    p_date_end date DEFAULT NULL
)
RETURNS TABLE (
    session_date date, session_start time, session_end time,
    subject_name text, class_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_school_id uuid;
BEGIN
    SELECT u.school_id INTO v_school_id
    FROM public.users u
    WHERE u.auth_user_id = auth.uid() AND u.is_active
      AND (u.role_type IN ('WAKA_KURIKULUM', 'KEPSEK', 'ADMINISTRATIVE')
           OR u.is_waka_kurikulum OR u.is_kepsek)
    LIMIT 1;
    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'Akses monitoring kurikulum ditolak' USING ERRCODE = '42501';
    END IF;
    IF p_date_start > p_date_end THEN
        RAISE EXCEPTION 'Tanggal awal tidak boleh melewati tanggal akhir' USING ERRCODE = '22007';
    END IF;

    RETURN QUERY
    SELECT ts.session_date, ts.session_start::time, ts.session_end::time, s.name::text, c.name::text
    FROM public.teaching_schedules ts
    JOIN public.subjects s ON s.subject_id = ts.subject_id
    JOIN public.classes c ON c.class_id = ts.class_id
    WHERE ts.school_id = v_school_id
      AND ts.scheduled_teacher_id = p_teacher_id
      AND ts.meeting_status = 'NORMAL'
      AND NOT EXISTS (
          SELECT 1 FROM public.attendance a
          WHERE a.schedule_id = ts.schedule_id AND NOT a.is_void
      )
      AND (p_date_start IS NULL OR ts.session_date >= p_date_start)
      AND (p_date_end IS NULL OR ts.session_date <= p_date_end)
    ORDER BY ts.session_date, ts.session_start;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_pending_attendance_sessions(p_date date DEFAULT NULL)
RETURNS TABLE (
    teacher_id uuid, session_start time, session_end time,
    teacher_name text, subject_name text, class_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_school_id uuid;
BEGIN
    SELECT u.school_id INTO v_school_id
    FROM public.users u
    WHERE u.auth_user_id = auth.uid() AND u.is_active
      AND (u.role_type IN ('WAKA_KURIKULUM', 'KEPSEK', 'ADMINISTRATIVE')
           OR u.is_waka_kurikulum OR u.is_kepsek)
    LIMIT 1;
    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'Akses monitoring kurikulum ditolak' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT ts.scheduled_teacher_id, ts.session_start::time, ts.session_end::time,
        u.full_name::text, s.name::text, c.name::text
    FROM public.teaching_schedules ts
    JOIN public.users u ON u.user_id = ts.scheduled_teacher_id
    JOIN public.subjects s ON s.subject_id = ts.subject_id
    JOIN public.classes c ON c.class_id = ts.class_id
    WHERE ts.school_id = v_school_id
      AND ts.meeting_status = 'NORMAL'
      AND (p_date IS NULL OR ts.session_date = p_date)
      AND NOT EXISTS (
          SELECT 1 FROM public.attendance a
          WHERE a.schedule_id = ts.schedule_id AND NOT a.is_void
      )
    ORDER BY u.full_name, ts.session_start;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_waka_kur_stats(date, date) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_waka_kur_stats(date, date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_waka_kur_stats(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_pending_sessions_by_teacher(date, date) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_pending_sessions_by_teacher(date, date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_pending_sessions_by_teacher(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_pending_sessions_detail(uuid, date, date) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_pending_sessions_detail(uuid, date, date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_pending_sessions_detail(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_pending_attendance_sessions(date) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_pending_attendance_sessions(date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_pending_attendance_sessions(date) FROM PUBLIC;

COMMIT;
