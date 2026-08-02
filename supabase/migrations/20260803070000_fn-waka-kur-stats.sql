-- Migration: 20260803070000_fn-waka-kur-stats.sql
--
-- Revisi: hitung kehadiran guru berbasis guru unik (COUNT DISTINCT scheduled_teacher_id),
-- identik dengan fn_kepsek_monitoring. Hapus kolom tidak_hadir, sudah_isi, belum_isi, total.
-- Panel 1 selalu hari ini (p_date_start = p_date_end = today dari JS).
-- Panel 2 rentang custom dari date picker.

CREATE OR REPLACE FUNCTION fn_waka_kur_stats(
    p_date_start DATE DEFAULT NULL,
    p_date_end   DATE DEFAULT NULL
)
RETURNS TABLE (
    guru_hadir  BIGINT,
    guru_total  BIGINT,
    guru_belum  BIGINT,
    pct_hadir   NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        COUNT(DISTINCT CASE WHEN EXISTS (
            SELECT 1 FROM attendance ax
            WHERE ax.schedule_id = ts.schedule_id AND NOT ax.is_void
        ) THEN ts.scheduled_teacher_id END)::BIGINT AS guru_hadir,

        COUNT(DISTINCT ts.scheduled_teacher_id)::BIGINT AS guru_total,

        (
            COUNT(DISTINCT ts.scheduled_teacher_id)
            - COUNT(DISTINCT CASE WHEN EXISTS (
                SELECT 1 FROM attendance ax
                WHERE ax.schedule_id = ts.schedule_id AND NOT ax.is_void
            ) THEN ts.scheduled_teacher_id END)
        )::BIGINT AS guru_belum,

        ROUND(
            100.0
            * COUNT(DISTINCT CASE WHEN EXISTS (
                SELECT 1 FROM attendance ax
                WHERE ax.schedule_id = ts.schedule_id AND NOT ax.is_void
            ) THEN ts.scheduled_teacher_id END)
            / NULLIF(COUNT(DISTINCT ts.scheduled_teacher_id), 0),
        1) AS pct_hadir

    FROM teaching_schedules ts
    WHERE ts.school_id      = fn_current_school_id()
      AND ts.meeting_status = 'NORMAL'
      AND (p_date_start IS NULL OR ts.session_date >= p_date_start)
      AND (p_date_end   IS NULL OR ts.session_date <= p_date_end);
$$;

GRANT  EXECUTE ON FUNCTION fn_waka_kur_stats TO authenticated;
REVOKE EXECUTE ON FUNCTION fn_waka_kur_stats FROM anon;
REVOKE EXECUTE ON FUNCTION fn_waka_kur_stats FROM PUBLIC;
