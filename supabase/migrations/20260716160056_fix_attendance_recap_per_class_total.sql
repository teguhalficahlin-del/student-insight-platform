-- Fix fn_attendance_recap_per_class:
-- total sebelumnya = COUNT(DISTINCT ts.block_group_id) → semua pertemuan terjadwal
-- total sesudahnya = hanya block_group_id yang punya ≥1 record absensi (is_void=false)

CREATE OR REPLACE FUNCTION fn_attendance_recap_per_class(
    p_date_start date DEFAULT NULL::date,
    p_date_end   date DEFAULT NULL::date
)
RETURNS TABLE(
    class_id     uuid,
    name         text,
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
        c.class_id,
        c.name,
        COUNT(DISTINCT CASE WHEN a.status = 'HADIR'       THEN ts.block_group_id END) AS hadir,
        COUNT(DISTINCT CASE WHEN a.status = 'TIDAK_HADIR' THEN ts.block_group_id END) AS tidak_hadir,
        COUNT(DISTINCT CASE WHEN a.status = 'IZIN'        THEN ts.block_group_id END) AS izin,
        COUNT(DISTINCT CASE WHEN a.status = 'SAKIT'       THEN ts.block_group_id END) AS sakit,
        COUNT(DISTINCT CASE WHEN a.attendance_id IS NOT NULL THEN ts.block_group_id END) AS total
    FROM classes c
    LEFT JOIN teaching_schedules ts
           ON ts.class_id  = c.class_id
          AND ts.school_id = fn_current_school_id()
          AND (p_date_start IS NULL OR ts.session_date >= p_date_start)
          AND (p_date_end   IS NULL OR ts.session_date <= p_date_end)
    LEFT JOIN attendance a
           ON a.schedule_id = ts.schedule_id
          AND NOT a.is_void
    WHERE c.school_id = fn_current_school_id()
      AND c.is_active = TRUE
    GROUP BY c.class_id, c.name
    ORDER BY c.name;
$$;

REVOKE EXECUTE ON FUNCTION fn_attendance_recap_per_class(date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_attendance_recap_per_class(date, date) FROM anon;
