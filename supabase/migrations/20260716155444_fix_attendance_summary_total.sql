-- Fix fn_class_attendance_summary:
-- total sebelumnya = COUNT(DISTINCT ts.block_group_id) → semua pertemuan terjadwal
-- total sesudahnya = hanya block_group_id yang punya ≥1 record absensi (is_void=false)

CREATE OR REPLACE FUNCTION fn_class_attendance_summary(
    p_class_id      uuid,
    p_academic_year text,
    p_date_start    date DEFAULT NULL::date,
    p_date_end      date DEFAULT NULL::date,
    p_teacher_id    uuid DEFAULT NULL::uuid
)
RETURNS TABLE(
    student_id   uuid,
    full_name    text,
    nis          text,
    hadir        bigint,
    tidak_hadir  bigint,
    izin         bigint,
    sakit        bigint,
    total        bigint
)
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT
        s.student_id,
        s.full_name,
        s.nis,
        COUNT(DISTINCT CASE WHEN a.status = 'HADIR'       THEN ts.block_group_id END) AS hadir,
        COUNT(DISTINCT CASE WHEN a.status = 'TIDAK_HADIR' THEN ts.block_group_id END) AS tidak_hadir,
        COUNT(DISTINCT CASE WHEN a.status = 'IZIN'        THEN ts.block_group_id END) AS izin,
        COUNT(DISTINCT CASE WHEN a.status = 'SAKIT'       THEN ts.block_group_id END) AS sakit,
        COUNT(DISTINCT CASE WHEN a.attendance_id IS NOT NULL THEN ts.block_group_id END) AS total
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

REVOKE EXECUTE ON FUNCTION fn_class_attendance_summary(uuid, text, date, date, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_class_attendance_summary(uuid, text, date, date, uuid) FROM anon;
