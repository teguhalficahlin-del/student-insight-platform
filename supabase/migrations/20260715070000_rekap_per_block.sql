-- Ganti COUNT(attendance_id) → COUNT(DISTINCT block_group_id) di dua RPC rekap.
-- Tujuan: rekap absensi dihitung per pertemuan (blok) bukan per slot,
-- sehingga 4 slot B.Inggris dalam 1 blok = 1 pertemuan, bukan 4.

-- ─── 1. Rekap kehadiran per kelas (seluruh sekolah) ──────────────────────────
-- Dipakai BK, Waka Kesiswaan, Kaprodi (loadKpClsRecap).
CREATE OR REPLACE FUNCTION fn_attendance_recap_per_class(
    p_date_start DATE DEFAULT NULL,
    p_date_end   DATE DEFAULT NULL
)
RETURNS TABLE (
    class_id     UUID,
    name         TEXT,
    hadir        BIGINT,
    tidak_hadir  BIGINT,
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
        COUNT(DISTINCT CASE WHEN a.status = 'HADIR'             THEN ts.block_group_id END) AS hadir,
        COUNT(DISTINCT CASE WHEN a.status = 'TIDAK_HADIR'       THEN ts.block_group_id END) AS tidak_hadir,
        COUNT(DISTINCT CASE WHEN a.status = 'IZIN'              THEN ts.block_group_id END) AS izin,
        COUNT(DISTINCT CASE WHEN a.status = 'SAKIT'             THEN ts.block_group_id END) AS sakit,
        COUNT(DISTINCT ts.block_group_id)                                                    AS total
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

-- ─── 2. Rekap kehadiran per siswa dalam satu kelas ───────────────────────────
-- Dipakai Wali Kelas, BK/Waka/Kaprodi (drill-down), dan Tab Guru.
-- p_teacher_id opsional — jika diisi, hanya sesi guru itu yang dihitung.
CREATE OR REPLACE FUNCTION fn_class_attendance_summary(
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
    tidak_hadir  BIGINT,
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
        COUNT(DISTINCT CASE WHEN a.status = 'HADIR'             THEN ts.block_group_id END) AS hadir,
        COUNT(DISTINCT CASE WHEN a.status = 'TIDAK_HADIR'       THEN ts.block_group_id END) AS tidak_hadir,
        COUNT(DISTINCT CASE WHEN a.status = 'IZIN'              THEN ts.block_group_id END) AS izin,
        COUNT(DISTINCT CASE WHEN a.status = 'SAKIT'             THEN ts.block_group_id END) AS sakit,
        COUNT(DISTINCT ts.block_group_id)                                                    AS total
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
