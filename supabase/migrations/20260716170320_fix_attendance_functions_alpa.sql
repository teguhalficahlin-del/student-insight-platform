-- Fix tiga fungsi RPC yang masih pakai 'TIDAK_HADIR' setelah rename enum
-- attendance_status TIDAK_HADIR → ALPA (migration 20260716164801).
-- Kolom output juga diganti: tidak_hadir → alpa.
-- DROP dulu karena PostgreSQL tidak izinkan CREATE OR REPLACE jika return type berubah.

-- ─── fn_class_attendance_summary ─────────────────────────────
DROP FUNCTION IF EXISTS fn_class_attendance_summary(UUID, TEXT, DATE, DATE, UUID);
CREATE FUNCTION fn_class_attendance_summary(
    p_class_id      UUID,
    p_academic_year TEXT,
    p_date_start    DATE DEFAULT NULL,
    p_date_end      DATE DEFAULT NULL,
    p_teacher_id    UUID DEFAULT NULL
)
RETURNS TABLE (
    student_id  UUID,
    full_name   TEXT,
    nis         TEXT,
    hadir       BIGINT,
    alpa        BIGINT,
    izin        BIGINT,
    sakit       BIGINT,
    total       BIGINT
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
        COUNT(DISTINCT CASE WHEN a.status = 'HADIR' THEN ts.block_group_id END) AS hadir,
        COUNT(DISTINCT CASE WHEN a.status = 'ALPA'  THEN ts.block_group_id END) AS alpa,
        COUNT(DISTINCT CASE WHEN a.status = 'IZIN'  THEN ts.block_group_id END) AS izin,
        COUNT(DISTINCT CASE WHEN a.status = 'SAKIT' THEN ts.block_group_id END) AS sakit,
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

REVOKE EXECUTE ON FUNCTION fn_class_attendance_summary(UUID, TEXT, DATE, DATE, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_class_attendance_summary(UUID, TEXT, DATE, DATE, UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION fn_class_attendance_summary(UUID, TEXT, DATE, DATE, UUID) TO authenticated;

-- ─── fn_attendance_recap_per_class ───────────────────────────
DROP FUNCTION IF EXISTS fn_attendance_recap_per_class(DATE, DATE);
CREATE FUNCTION fn_attendance_recap_per_class(
    p_date_start DATE DEFAULT NULL,
    p_date_end   DATE DEFAULT NULL
)
RETURNS TABLE (
    class_id  UUID,
    name      TEXT,
    hadir     BIGINT,
    alpa      BIGINT,
    izin      BIGINT,
    sakit     BIGINT,
    total     BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        c.class_id,
        c.name,
        COUNT(DISTINCT CASE WHEN a.status = 'HADIR' THEN ts.block_group_id END) AS hadir,
        COUNT(DISTINCT CASE WHEN a.status = 'ALPA'  THEN ts.block_group_id END) AS alpa,
        COUNT(DISTINCT CASE WHEN a.status = 'IZIN'  THEN ts.block_group_id END) AS izin,
        COUNT(DISTINCT CASE WHEN a.status = 'SAKIT' THEN ts.block_group_id END) AS sakit,
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

REVOKE EXECUTE ON FUNCTION fn_attendance_recap_per_class(DATE, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_attendance_recap_per_class(DATE, DATE) FROM anon;
GRANT  EXECUTE ON FUNCTION fn_attendance_recap_per_class(DATE, DATE) TO authenticated;

-- ─── fn_pkl_attendance_recap ──────────────────────────────────
DROP FUNCTION IF EXISTS fn_pkl_attendance_recap(UUID[], DATE, DATE);
CREATE FUNCTION fn_pkl_attendance_recap(
    p_student_ids UUID[],
    p_date_start  DATE DEFAULT NULL,
    p_date_end    DATE DEFAULT NULL
)
RETURNS TABLE (
    student_id  UUID,
    hadir       BIGINT,
    alpa        BIGINT,
    izin        BIGINT,
    sakit       BIGINT,
    total       BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        s.student_id,
        COUNT(pa.pkl_attendance_id) FILTER (WHERE pa.status = 'HADIR') AS hadir,
        COUNT(pa.pkl_attendance_id) FILTER (WHERE pa.status = 'ALPA')  AS alpa,
        COUNT(pa.pkl_attendance_id) FILTER (WHERE pa.status = 'IZIN')  AS izin,
        COUNT(pa.pkl_attendance_id) FILTER (WHERE pa.status = 'SAKIT') AS sakit,
        COUNT(pa.pkl_attendance_id)                                     AS total
    FROM unnest(p_student_ids) AS sid(student_id)
    JOIN students s ON s.student_id = sid.student_id
        AND s.school_id = fn_current_school_id()
    LEFT JOIN pkl_attendance pa
           ON pa.student_id = s.student_id
          AND (p_date_start IS NULL OR pa.attendance_date >= p_date_start)
          AND (p_date_end   IS NULL OR pa.attendance_date <= p_date_end)
    GROUP BY s.student_id;
$$;

REVOKE EXECUTE ON FUNCTION fn_pkl_attendance_recap(UUID[], DATE, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_pkl_attendance_recap(UUID[], DATE, DATE) FROM anon;
GRANT  EXECUTE ON FUNCTION fn_pkl_attendance_recap(UUID[], DATE, DATE) TO authenticated;
