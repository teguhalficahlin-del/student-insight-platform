-- Tambah parameter p_date_start dan p_date_end ke fn_kepsek_monitoring.
-- Ketika p_period = 'rentang', gunakan kedua tanggal tersebut langsung
-- (date range bebas dari frontend). by_month otomatis TRUE jika rentang > 60 hari.
CREATE OR REPLACE FUNCTION fn_kepsek_monitoring(
    p_period        text    DEFAULT 'hari_ini',
    p_academic_year text    DEFAULT NULL,
    p_date_start    date    DEFAULT NULL,
    p_date_end      date    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_school_id   uuid;
    v_is_kepsek   boolean;
    v_date_start  date;
    v_date_end    date;
    v_by_month    boolean := FALSE;
    v_ay_year     int;
    v_summary     JSONB;
    v_chart       JSONB;
BEGIN
    SELECT school_id, (role_type = 'KEPSEK' OR COALESCE(is_kepsek, FALSE))
    INTO v_school_id, v_is_kepsek
    FROM users WHERE auth_user_id = auth.uid() LIMIT 1;

    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'User tidak ditemukan atau tidak memiliki school_id';
    END IF;
    IF NOT v_is_kepsek THEN
        RAISE EXCEPTION 'Akses ditolak: hanya Kepala Sekolah yang dapat melihat monitoring ini';
    END IF;

    CASE p_period
        WHEN 'hari_ini' THEN
            v_date_start := CURRENT_DATE;
            v_date_end   := CURRENT_DATE;

        WHEN '7_hari' THEN
            v_date_start := CURRENT_DATE - 6;
            v_date_end   := CURRENT_DATE;

        WHEN 'minggu_lalu' THEN
            v_date_start := date_trunc('week', CURRENT_DATE - 7)::date;
            v_date_end   := date_trunc('week', CURRENT_DATE)::date - 1;

        WHEN 'bulan_lalu' THEN
            v_date_start := date_trunc('month', CURRENT_DATE - interval '1 month')::date;
            v_date_end   := date_trunc('month', CURRENT_DATE)::date - 1;

        WHEN 'tahun_ajaran_lalu' THEN
            IF p_academic_year IS NULL THEN
                RAISE EXCEPTION 'p_academic_year wajib diisi untuk periode tahun_ajaran_lalu';
            END IF;
            v_ay_year    := split_part(p_academic_year, '/', 1)::int;
            v_date_start := make_date(v_ay_year,     7, 1);
            v_date_end   := make_date(v_ay_year + 1, 6, 30);
            v_by_month   := TRUE;

        WHEN 'rentang' THEN
            IF p_date_start IS NULL OR p_date_end IS NULL THEN
                RAISE EXCEPTION 'p_date_start dan p_date_end wajib diisi untuk periode rentang';
            END IF;
            v_date_start := p_date_start;
            v_date_end   := p_date_end;
            v_by_month   := (p_date_end - p_date_start) > 60;

        ELSE
            v_date_start := CURRENT_DATE;
            v_date_end   := CURRENT_DATE;
    END CASE;

    SELECT jsonb_build_object(
        'pct_siswa',
            CASE WHEN sum(att_total) > 0
                 THEN round(100.0 * sum(att_hadir) / sum(att_total), 1)
                 ELSE NULL END,
        'pct_guru',
            CASE WHEN sum(sesi_total) > 0
                 THEN round(100.0 * sum(guru_hadir) / sum(sesi_total), 1)
                 ELSE NULL END,
        'siswa_hadir', sum(att_hadir),
        'siswa_total', sum(att_total),
        'guru_hadir',  sum(guru_hadir),
        'guru_total',  sum(sesi_total)
    )
    INTO v_summary
    FROM (
        SELECT
            count(DISTINCT ts.schedule_id)                                                                    AS sesi_total,
            count(DISTINCT ts.schedule_id) FILTER (WHERE ts.teacher_indicator = 'HADIR')                     AS guru_hadir,
            count(a.attendance_id)         FILTER (WHERE NOT a.is_void)                                      AS att_total,
            count(a.attendance_id)         FILTER (WHERE NOT a.is_void AND a.status = 'HADIR')               AS att_hadir
        FROM teaching_schedules ts
        LEFT JOIN attendance a ON a.schedule_id = ts.schedule_id
        WHERE ts.session_date BETWEEN v_date_start AND v_date_end
          AND ts.school_id = v_school_id
          AND ts.meeting_status = 'NORMAL'
    ) agg;

    IF v_by_month THEN
        SELECT COALESCE(jsonb_agg(pt ORDER BY pt->>'date'), '[]'::jsonb)
        INTO v_chart
        FROM (
            SELECT jsonb_build_object(
                'date',      to_char(date_trunc('month', ts.session_date), 'YYYY-MM-01'),
                'pct_siswa', CASE WHEN count(a.attendance_id) FILTER (WHERE NOT a.is_void) > 0
                                  THEN round(100.0
                                       * count(a.attendance_id) FILTER (WHERE NOT a.is_void AND a.status = 'HADIR')
                                       / count(a.attendance_id) FILTER (WHERE NOT a.is_void), 1)
                                  ELSE NULL END,
                'pct_guru',  CASE WHEN count(DISTINCT ts.schedule_id) > 0
                                  THEN round(100.0
                                       * count(DISTINCT ts.schedule_id) FILTER (WHERE ts.teacher_indicator = 'HADIR')
                                       / count(DISTINCT ts.schedule_id), 1)
                                  ELSE NULL END
            ) AS pt
            FROM teaching_schedules ts
            LEFT JOIN attendance a ON a.schedule_id = ts.schedule_id
            WHERE ts.session_date BETWEEN v_date_start AND v_date_end
              AND ts.school_id = v_school_id
              AND ts.meeting_status = 'NORMAL'
            GROUP BY date_trunc('month', ts.session_date)
        ) sub;
    ELSE
        SELECT COALESCE(jsonb_agg(pt ORDER BY pt->>'date'), '[]'::jsonb)
        INTO v_chart
        FROM (
            SELECT jsonb_build_object(
                'date',      ts.session_date::text,
                'pct_siswa', CASE WHEN count(a.attendance_id) FILTER (WHERE NOT a.is_void) > 0
                                  THEN round(100.0
                                       * count(a.attendance_id) FILTER (WHERE NOT a.is_void AND a.status = 'HADIR')
                                       / count(a.attendance_id) FILTER (WHERE NOT a.is_void), 1)
                                  ELSE NULL END,
                'pct_guru',  CASE WHEN count(DISTINCT ts.schedule_id) > 0
                                  THEN round(100.0
                                       * count(DISTINCT ts.schedule_id) FILTER (WHERE ts.teacher_indicator = 'HADIR')
                                       / count(DISTINCT ts.schedule_id), 1)
                                  ELSE NULL END
            ) AS pt
            FROM teaching_schedules ts
            LEFT JOIN attendance a ON a.schedule_id = ts.schedule_id
            WHERE ts.session_date BETWEEN v_date_start AND v_date_end
              AND ts.school_id = v_school_id
              AND ts.meeting_status = 'NORMAL'
            GROUP BY ts.session_date
        ) sub;
    END IF;

    RETURN jsonb_build_object(
        'period',      p_period,
        'date_start',  v_date_start,
        'date_end',    v_date_end,
        'by_month',    v_by_month,
        'summary',     v_summary,
        'chart',       v_chart
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION fn_kepsek_monitoring(text, text, date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_kepsek_monitoring(text, text, date, date) FROM anon;
GRANT  EXECUTE ON FUNCTION fn_kepsek_monitoring(text, text, date, date) TO authenticated;
