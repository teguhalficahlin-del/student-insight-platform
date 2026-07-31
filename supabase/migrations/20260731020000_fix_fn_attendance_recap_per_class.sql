-- Fix: fn_attendance_recap_per_class — ganti status TIDAK_HADIR → ALPA
--      dan rename kolom output tidak_hadir → alpa.
--
-- Bug identik dengan fn_class_attendance_summary (difix di 20260731010000).
-- Terdampak: Tab BK (loadBkAttendanceRecap), Tab Waka Kesiswaan (loadWkAttendanceRecap),
--            Tab Kaprodi (loadKpClsRecap).
-- Consumer JS (getAttendanceRecapPerClass, api.js:674) sudah membaca r.alpa —
-- tidak perlu diubah.
-- Perlu DROP dulu karena RETURNS TABLE berubah (tidak bisa OR REPLACE saja).

BEGIN;

DROP FUNCTION IF EXISTS fn_attendance_recap_per_class(DATE, DATE);

CREATE FUNCTION fn_attendance_recap_per_class(
    p_date_start DATE DEFAULT NULL,
    p_date_end   DATE DEFAULT NULL
)
RETURNS TABLE (
    class_id     UUID,
    name         TEXT,
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
        c.class_id,
        c.name,
        COUNT(a.attendance_id) FILTER (WHERE a.status = 'HADIR')              AS hadir,
        COUNT(a.attendance_id) FILTER (WHERE a.status = 'ALPA')               AS alpa,
        COUNT(a.attendance_id) FILTER (WHERE a.status = 'IZIN')               AS izin,
        COUNT(a.attendance_id) FILTER (WHERE a.status = 'SAKIT')              AS sakit,
        COUNT(a.attendance_id)                                                 AS total
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

REVOKE EXECUTE ON FUNCTION fn_attendance_recap_per_class(DATE, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_attendance_recap_per_class(DATE, DATE) FROM anon;
GRANT  EXECUTE ON FUNCTION fn_attendance_recap_per_class(DATE, DATE) TO authenticated;

COMMIT;
