-- fn_pending_sessions_by_teacher: ringkasan jumlah sesi PENDING per guru
-- untuk tabel rekap WAKA Kurikulum. Server-side GROUP BY — tidak kena batas
-- 1000 baris PostgREST dan tidak kena .limit(200) client.
CREATE OR REPLACE FUNCTION fn_pending_sessions_by_teacher(
    p_date_start DATE DEFAULT NULL,
    p_date_end   DATE DEFAULT NULL
)
RETURNS TABLE (
    teacher_id   UUID,
    teacher_name TEXT,
    jumlah       BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        u.user_id,
        u.full_name,
        COUNT(*)::BIGINT
    FROM teaching_schedules ts
    JOIN users u ON u.user_id = ts.scheduled_teacher_id
    WHERE ts.school_id        = fn_current_school_id()
      AND ts.teacher_indicator = 'PENDING_EVALUATION'
      AND ts.meeting_status   = 'NORMAL'
      AND (p_date_start IS NULL OR ts.session_date >= p_date_start)
      AND (p_date_end   IS NULL OR ts.session_date <= p_date_end)
    GROUP BY u.user_id, u.full_name
    ORDER BY COUNT(*) DESC, u.full_name;
$$;

REVOKE EXECUTE ON FUNCTION fn_pending_sessions_by_teacher FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_pending_sessions_by_teacher FROM anon;
GRANT  EXECUTE ON FUNCTION fn_pending_sessions_by_teacher TO authenticated;

-- fn_pending_sessions_detail: detail sesi PENDING untuk satu guru tertentu
-- dipanggil hanya saat baris guru di-expand (lazy load).
CREATE OR REPLACE FUNCTION fn_pending_sessions_detail(
    p_teacher_id UUID,
    p_date_start DATE DEFAULT NULL,
    p_date_end   DATE DEFAULT NULL
)
RETURNS TABLE (
    session_date  DATE,
    session_start TIME,
    session_end   TIME,
    subject_name  TEXT,
    class_name    TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        ts.session_date,
        ts.session_start::TIME,
        ts.session_end::TIME,
        s.name,
        c.name
    FROM teaching_schedules ts
    JOIN subjects  s ON s.subject_id = ts.subject_id
    JOIN classes   c ON c.class_id   = ts.class_id
    WHERE ts.school_id           = fn_current_school_id()
      AND ts.scheduled_teacher_id = p_teacher_id
      AND ts.teacher_indicator   = 'PENDING_EVALUATION'
      AND ts.meeting_status      = 'NORMAL'
      AND (p_date_start IS NULL OR ts.session_date >= p_date_start)
      AND (p_date_end   IS NULL OR ts.session_date <= p_date_end)
    ORDER BY ts.session_date, ts.session_start;
$$;

REVOKE EXECUTE ON FUNCTION fn_pending_sessions_detail FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_pending_sessions_detail FROM anon;
GRANT  EXECUTE ON FUNCTION fn_pending_sessions_detail TO authenticated;
