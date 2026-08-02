-- Migration: 20260803080000_fix-pending-sessions-exists.sql
--
-- Ganti filter teacher_indicator = 'PENDING_EVALUATION' ke NOT EXISTS(attendance NOT void)
-- di semua fungsi Panel 1 tabel dan Panel 2 tab Waka Kurikulum.
-- Setelah ini tidak ada komponen Waka yang bergantung pada cron evaluate-teacher-indicators.

-- 1. fn_pending_sessions_by_teacher — Panel 2 ringkasan per guru
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
    WHERE ts.school_id      = fn_current_school_id()
      AND ts.meeting_status = 'NORMAL'
      AND NOT EXISTS (
          SELECT 1 FROM attendance ax
          WHERE ax.schedule_id = ts.schedule_id AND NOT ax.is_void
      )
      AND (p_date_start IS NULL OR ts.session_date >= p_date_start)
      AND (p_date_end   IS NULL OR ts.session_date <= p_date_end)
    GROUP BY u.user_id, u.full_name
    ORDER BY COUNT(*) DESC, u.full_name;
$$;

GRANT  EXECUTE ON FUNCTION fn_pending_sessions_by_teacher TO authenticated;
REVOKE EXECUTE ON FUNCTION fn_pending_sessions_by_teacher FROM anon;
REVOKE EXECUTE ON FUNCTION fn_pending_sessions_by_teacher FROM PUBLIC;

-- 2. fn_pending_sessions_detail — Panel 2 detail sesi per guru (lazy load)
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
    WHERE ts.school_id            = fn_current_school_id()
      AND ts.scheduled_teacher_id = p_teacher_id
      AND ts.meeting_status       = 'NORMAL'
      AND NOT EXISTS (
          SELECT 1 FROM attendance ax
          WHERE ax.schedule_id = ts.schedule_id AND NOT ax.is_void
      )
      AND (p_date_start IS NULL OR ts.session_date >= p_date_start)
      AND (p_date_end   IS NULL OR ts.session_date <= p_date_end)
    ORDER BY ts.session_date, ts.session_start;
$$;

GRANT  EXECUTE ON FUNCTION fn_pending_sessions_detail TO authenticated;
REVOKE EXECUTE ON FUNCTION fn_pending_sessions_detail FROM anon;
REVOKE EXECUTE ON FUNCTION fn_pending_sessions_detail FROM PUBLIC;

-- 3. fn_pending_attendance_sessions — Panel 1 tabel "Sesi Belum Diisi Hari Ini"
--    Menggantikan query langsung ke teaching_schedules di getPendingAttendanceSessions()
--    yang tidak memiliki filter school_id (karena RLS waka hanya cek role, bukan school_id).
--    SECURITY DEFINER + fn_current_school_id() memastikan tenant isolation.
CREATE OR REPLACE FUNCTION fn_pending_attendance_sessions(
    p_date DATE DEFAULT NULL
)
RETURNS TABLE (
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
    ORDER BY ts.session_start;
$$;

GRANT  EXECUTE ON FUNCTION fn_pending_attendance_sessions TO authenticated;
REVOKE EXECUTE ON FUNCTION fn_pending_attendance_sessions FROM anon;
REVOKE EXECUTE ON FUNCTION fn_pending_attendance_sessions FROM PUBLIC;
