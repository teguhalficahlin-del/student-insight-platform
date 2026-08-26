-- Migration: 20260803090000_fn-pending-attendance-sessions-v2.sql
--
-- Tambah kolom teacher_id UUID ke fn_pending_attendance_sessions.
-- DROP dulu karena PostgreSQL tidak bisa OR REPLACE dengan perubahan RETURNS TABLE.

DROP FUNCTION IF EXISTS fn_pending_attendance_sessions(DATE);

CREATE FUNCTION fn_pending_attendance_sessions(
    p_date DATE DEFAULT NULL
)
RETURNS TABLE (
    teacher_id    UUID,
    session_start TIME,
    session_end   TIME,
    teacher_name  TEXT,
    subject_name  TEXT,
    class_name    TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        ts.scheduled_teacher_id,
        ts.session_start::TIME,
        ts.session_end::TIME,
        u.full_name,
        s.name,
        c.name
    FROM teaching_schedules ts
    JOIN users    u ON u.user_id    = ts.scheduled_teacher_id
    JOIN subjects s ON s.subject_id = ts.subject_id
    JOIN classes  c ON c.class_id   = ts.class_id
    WHERE ts.school_id      = fn_current_school_id()
      AND ts.meeting_status = 'NORMAL'
      AND (p_date IS NULL OR ts.session_date = p_date)
      AND NOT EXISTS (
          SELECT 1 FROM attendance ax
          WHERE ax.schedule_id = ts.schedule_id AND NOT ax.is_void
      )
    ORDER BY u.full_name ASC, ts.session_start ASC;
$$;

GRANT  EXECUTE ON FUNCTION fn_pending_attendance_sessions TO authenticated;
REVOKE EXECUTE ON FUNCTION fn_pending_attendance_sessions FROM anon;
REVOKE EXECUTE ON FUNCTION fn_pending_attendance_sessions FROM PUBLIC;
