-- Fix: fn_class_attendance_summary — ganti status TIDAK_HADIR → ALPA
--      dan rename kolom output tidak_hadir → alpa.
--
-- Latar belakang: enum attendance_status memakai 'ALPA', bukan 'TIDAK_HADIR'.
-- Akibatnya kolom tidak_hadir selalu 0, dan consumer JS (getWaliAttendanceSummary
-- + getAttendanceSummaryByStudents) yang membaca r.alpa mendapat undefined → 0.
--
-- Consumer JS tidak perlu diubah karena keduanya sudah membaca r.alpa.
-- Perlu DROP dulu karena RETURNS TABLE berubah (tidak bisa OR REPLACE saja).

BEGIN;

DROP FUNCTION IF EXISTS fn_class_attendance_summary(UUID, TEXT, DATE, DATE, UUID);

CREATE FUNCTION fn_class_attendance_summary(
    p_class_id      UUID,
    p_academic_year TEXT,
    p_date_start    DATE    DEFAULT NULL,
    p_date_end      DATE    DEFAULT NULL,
    p_teacher_id    UUID    DEFAULT NULL
)
RETURNS TABLE (
    student_id   UUID,
    full_name    TEXT,
    nis          TEXT,
    hadir        BIGINT,
    alpa         BIGINT,
    izin         BIGINT,
    sakit        BIGINT,
    total        BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        s.student_id,
        s.full_name,
        s.nis,
        COUNT(a.attendance_id) FILTER (WHERE a.status = 'HADIR')              AS hadir,
        COUNT(a.attendance_id) FILTER (WHERE a.status = 'ALPA')               AS alpa,
        COUNT(a.attendance_id) FILTER (WHERE a.status = 'IZIN')               AS izin,
        COUNT(a.attendance_id) FILTER (WHERE a.status = 'SAKIT')              AS sakit,
        COUNT(a.attendance_id)                                                 AS total
    FROM class_enrollments ce
    JOIN students s ON s.student_id = ce.student_id
    LEFT JOIN teaching_schedules ts
           ON ts.class_id      = p_class_id
          AND ts.school_id     = fn_current_school_id()
          AND ts.academic_year = p_academic_year
          AND (p_date_start    IS NULL OR ts.session_date >= p_date_start)
          AND (p_date_end      IS NULL OR ts.session_date <= p_date_end)
          AND (p_teacher_id    IS NULL OR ts.scheduled_teacher_id = p_teacher_id)
    LEFT JOIN attendance a
           ON a.schedule_id = ts.schedule_id
          AND a.student_id  = s.student_id
          AND NOT a.is_void
    WHERE ce.class_id      = p_class_id
      AND ce.academic_year = p_academic_year
      AND s.school_id      = fn_current_school_id()
    GROUP BY s.student_id, s.full_name, s.nis
    ORDER BY s.full_name;
$$;

REVOKE EXECUTE ON FUNCTION fn_class_attendance_summary(UUID, TEXT, DATE, DATE, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_class_attendance_summary(UUID, TEXT, DATE, DATE, UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION fn_class_attendance_summary(UUID, TEXT, DATE, DATE, UUID) TO authenticated;

COMMIT;
