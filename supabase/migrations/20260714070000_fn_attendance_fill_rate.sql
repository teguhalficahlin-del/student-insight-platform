CREATE OR REPLACE FUNCTION fn_attendance_fill_rate(
    p_date_start DATE DEFAULT NULL,
    p_date_end   DATE DEFAULT NULL
)
RETURNS TABLE (
    teacher_indicator TEXT,
    jumlah            BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        ts.teacher_indicator::TEXT,
        COUNT(*)::BIGINT
    FROM teaching_schedules ts
    WHERE ts.school_id     = fn_current_school_id()
      AND ts.meeting_status = 'NORMAL'
      AND (p_date_start IS NULL OR ts.session_date >= p_date_start)
      AND (p_date_end   IS NULL OR ts.session_date <= p_date_end)
    GROUP BY ts.teacher_indicator;
$$;

REVOKE EXECUTE ON FUNCTION fn_attendance_fill_rate FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_attendance_fill_rate FROM anon;
GRANT  EXECUTE ON FUNCTION fn_attendance_fill_rate TO authenticated;
