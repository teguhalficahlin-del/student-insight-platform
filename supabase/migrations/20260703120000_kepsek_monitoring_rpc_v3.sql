-- ============================================================
-- Migration: 20260703120000_kepsek_monitoring_rpc_v3.sql
-- fn_kepsek_monitoring v3: 5 periode + data seri waktu untuk grafik.
--
-- PERIODE:
--   hari_ini          → hari ini saja
--   7_hari            → 7 hari terakhir (rolling)
--   minggu_lalu       → Senin–Minggu minggu lalu (lengkap)
--   bulan_lalu        → 1–akhir bulan lalu (lengkap)
--   tahun_ajaran_lalu → Jul–Jun tahun ajaran lalu (p_academic_year wajib)
--
-- METRIK:
--   pct_siswa = record HADIR / total record attendance × 100
--   pct_guru  = sesi guru hadir / total sesi terjadwal × 100
--   (keduanya konsisten lintas semua periode, tidak terpengaruh hari libur)
--
-- RETURN:
--   summary  → agregat keseluruhan periode (untuk angka besar di kartu)
--   chart    → array titik data harian atau bulanan (untuk grafik)
--   by_month → true hanya untuk tahun_ajaran_lalu
-- ============================================================

CREATE OR REPLACE FUNCTION fn_kepsek_monitoring(
    p_period        text    DEFAULT 'hari_ini',
    p_academic_year text    DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_school_id   uuid;
    v_date_start  date;
    v_date_end    date;
    v_by_month    boolean := FALSE;
    v_ay_year     int;
    v_summary     JSONB;
    v_chart       JSONB;
BEGIN
    SELECT school_id INTO v_school_id
    FROM users WHERE auth_user_id = auth.uid() LIMIT 1;
    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'User tidak ditemukan atau tidak memiliki school_id';
    END IF;

    -- ── Tentukan rentang tanggal ──────────────────────────────
    CASE p_period
        WHEN 'hari_ini' THEN
            v_date_start := CURRENT_DATE;
            v_date_end   := CURRENT_DATE;

        WHEN '7_hari' THEN
            v_date_start := CURRENT_DATE - 6;
            v_date_end   := CURRENT_DATE;

        WHEN 'minggu_lalu' THEN
            -- ISO week: Senin s.d. Minggu minggu lalu
            v_date_start := date_trunc('week', CURRENT_DATE - 7)::date;
            v_date_end   := date_trunc('week', CURRENT_DATE)::date - 1;

        WHEN 'bulan_lalu' THEN
            v_date_start := date_trunc('month', CURRENT_DATE - interval '1 month')::date;
            v_date_end   := (date_trunc('month', CURRENT_DATE) - 1)::date;

        WHEN 'tahun_ajaran_lalu' THEN
            IF p_academic_year IS NULL THEN
                RAISE EXCEPTION 'p_academic_year wajib diisi untuk periode tahun_ajaran_lalu';
            END IF;
            v_ay_year    := split_part(p_academic_year, '/', 1)::int;
            v_date_start := make_date(v_ay_year,     7, 1);
            v_date_end   := make_date(v_ay_year + 1, 6, 30);
            v_by_month   := TRUE;

        ELSE
            v_date_start := CURRENT_DATE;
            v_date_end   := CURRENT_DATE;
    END CASE;

    -- ── Ringkasan (summary) agregat seluruh periode ───────────
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
            count(DISTINCT ts.schedule_id)                                                    AS sesi_total,
            count(DISTINCT ts.schedule_id) FILTER (WHERE ts.meeting_status <> 'GURU_TIDAK_HADIR') AS guru_hadir,
            count(a.attendance_id)         FILTER (WHERE NOT a.is_void)                      AS att_total,
            count(a.attendance_id)         FILTER (WHERE NOT a.is_void AND a.status = 'HADIR') AS att_hadir
        FROM teaching_schedules ts
        LEFT JOIN attendance a ON a.schedule_id = ts.schedule_id
        WHERE ts.session_date BETWEEN v_date_start AND v_date_end
          AND ts.school_id = v_school_id
    ) agg;

    -- ── Data seri waktu (chart) ───────────────────────────────
    IF v_by_month THEN
        -- Bulanan: 1 titik per bulan (untuk tahun ajaran)
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
                                       * count(DISTINCT ts.schedule_id) FILTER (WHERE ts.meeting_status <> 'GURU_TIDAK_HADIR')
                                       / count(DISTINCT ts.schedule_id), 1)
                                  ELSE NULL END
            ) AS pt
            FROM teaching_schedules ts
            LEFT JOIN attendance a ON a.schedule_id = ts.schedule_id
            WHERE ts.session_date BETWEEN v_date_start AND v_date_end
              AND ts.school_id = v_school_id
            GROUP BY date_trunc('month', ts.session_date)
        ) sub;
    ELSE
        -- Harian: 1 titik per hari sekolah
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
                                       * count(DISTINCT ts.schedule_id) FILTER (WHERE ts.meeting_status <> 'GURU_TIDAK_HADIR')
                                       / count(DISTINCT ts.schedule_id), 1)
                                  ELSE NULL END
            ) AS pt
            FROM teaching_schedules ts
            LEFT JOIN attendance a ON a.schedule_id = ts.schedule_id
            WHERE ts.session_date BETWEEN v_date_start AND v_date_end
              AND ts.school_id = v_school_id
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

REVOKE EXECUTE ON FUNCTION fn_kepsek_monitoring(text, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION fn_kepsek_monitoring(text, text) TO authenticated;

COMMENT ON FUNCTION fn_kepsek_monitoring(text, text) IS
    'Monitoring kehadiran Kepsek — 5 periode (hari_ini/7_hari/minggu_lalu/bulan_lalu/tahun_ajaran_lalu). '
    'Metrik: pct_siswa=HADIR/total-sesi, pct_guru=sesi-hadir/total-sesi. '
    'Return: summary (agregat) + chart (seri waktu harian atau bulanan).';
