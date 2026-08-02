-- Migration: 20260803070000_fn-waka-kur-stats.sql
--
-- Ganti mekanisme hitung kehadiran guru Panel 1 tab Waka Kurikulum dari
-- COUNT(*) GROUP BY teacher_indicator (bergantung cron evaluate-teacher-indicators)
-- menjadi EXISTS(attendance NOT void) — real-time, identik dengan fn_kepsek_monitoring.
--
-- Pembeda belum_isi vs tidak_hadir menggunakan parameter p_date_end dari JS
-- (bukan CURRENT_DATE di DB) untuk menghindari timezone UTC vs WIB.
-- Sesi pada p_date_end = "hari ini dari sudut pandang browser" → belum_isi.
-- Sesi sebelum p_date_end yang tidak diisi → tidak_hadir.

CREATE OR REPLACE FUNCTION fn_waka_kur_stats(
    p_date_start DATE DEFAULT NULL,
    p_date_end   DATE DEFAULT NULL
)
RETURNS TABLE (
    sudah_isi   BIGINT,
    belum_isi   BIGINT,
    tidak_hadir BIGINT,
    total       BIGINT,
    pct_hadir   NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        COUNT(CASE WHEN EXISTS (
            SELECT 1 FROM attendance ax
            WHERE ax.schedule_id = ts.schedule_id AND NOT ax.is_void
        ) THEN 1 END)::BIGINT AS sudah_isi,

        COUNT(CASE WHEN NOT EXISTS (
            SELECT 1 FROM attendance ax
            WHERE ax.schedule_id = ts.schedule_id AND NOT ax.is_void
        ) AND ts.session_date = p_date_end THEN 1 END)::BIGINT AS belum_isi,

        COUNT(CASE WHEN NOT EXISTS (
            SELECT 1 FROM attendance ax
            WHERE ax.schedule_id = ts.schedule_id AND NOT ax.is_void
        ) AND ts.session_date < p_date_end THEN 1 END)::BIGINT AS tidak_hadir,

        COUNT(*)::BIGINT AS total,

        ROUND(
            100.0 * COUNT(CASE WHEN EXISTS (
                SELECT 1 FROM attendance ax
                WHERE ax.schedule_id = ts.schedule_id AND NOT ax.is_void
            ) THEN 1 END) / NULLIF(COUNT(*), 0),
        1) AS pct_hadir

    FROM teaching_schedules ts
    WHERE ts.school_id     = fn_current_school_id()
      AND ts.meeting_status = 'NORMAL'
      AND (p_date_start IS NULL OR ts.session_date >= p_date_start)
      AND (p_date_end   IS NULL OR ts.session_date <= p_date_end);
$$;

GRANT  EXECUTE ON FUNCTION fn_waka_kur_stats TO authenticated;
REVOKE EXECUTE ON FUNCTION fn_waka_kur_stats FROM anon;
REVOKE EXECUTE ON FUNCTION fn_waka_kur_stats FROM PUBLIC;
