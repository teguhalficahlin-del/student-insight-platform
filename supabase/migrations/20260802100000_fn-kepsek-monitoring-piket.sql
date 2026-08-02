-- Migration: 20260802100000_fn-kepsek-monitoring-piket.sql
--
-- Tambah count_late (keterlambatan) dan count_exits (izin keluar) ke
-- fn_kepsek_monitoring di 3 lokasi: summary agregat, chart bulanan, chart harian.
-- Semua bagian lain (CASE p_period, kehadiran siswa/guru, RAISE, RETURN keys)
-- TIDAK diubah. Signature dan return type tidak berubah — tidak perlu DROP.
-- GRANT/REVOKE tidak berubah — authenticated sudah punya EXECUTE, anon tidak.

CREATE OR REPLACE FUNCTION public.fn_kepsek_monitoring(
    p_period        text DEFAULT 'hari_ini'::text,
    p_academic_year text DEFAULT NULL::text,
    p_date_start    date DEFAULT NULL::date,
    p_date_end      date DEFAULT NULL::date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

    -- ── Lokasi 1: Summary agregat ─────────────────────────────────────
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
        'guru_total',  sum(sesi_total),
        'count_late',  (
            SELECT COUNT(*)
            FROM late_arrivals la
            WHERE la.school_id = v_school_id
              AND la.late_date BETWEEN v_date_start AND v_date_end
        ),
        'count_exits', (
            SELECT COUNT(*)
            FROM student_exits se
            WHERE se.school_id = v_school_id
              AND se.exit_date BETWEEN v_date_start AND v_date_end
        )
    )
    INTO v_summary
    FROM (
        SELECT
            count(DISTINCT ts.schedule_id)                                                AS sesi_total,
            count(DISTINCT ts.schedule_id) FILTER (WHERE ts.teacher_indicator = 'HADIR') AS guru_hadir,
            COUNT(DISTINCT CASE WHEN NOT a.is_void THEN ts.block_group_id END)                        AS att_total,
            COUNT(DISTINCT CASE WHEN NOT a.is_void AND a.status = 'HADIR' THEN ts.block_group_id END) AS att_hadir
        FROM teaching_schedules ts
        LEFT JOIN attendance a ON a.schedule_id = ts.schedule_id
        WHERE ts.session_date BETWEEN v_date_start AND v_date_end
          AND ts.school_id = v_school_id
          AND ts.meeting_status = 'NORMAL'
    ) agg;

    IF v_by_month THEN
        -- ── Lokasi 2: Chart bulanan ───────────────────────────────────
        SELECT COALESCE(jsonb_agg(pt ORDER BY pt->>'date'), '[]'::jsonb)
        INTO v_chart
        FROM (
            SELECT jsonb_build_object(
                'date',      to_char(date_trunc('month', ts.session_date), 'YYYY-MM-01'),
                'pct_siswa', CASE
                                 WHEN COUNT(DISTINCT CASE WHEN NOT a.is_void THEN ts.block_group_id END) > 0
                                 THEN round(100.0
                                      * COUNT(DISTINCT CASE WHEN NOT a.is_void AND a.status = 'HADIR' THEN ts.block_group_id END)
                                      / COUNT(DISTINCT CASE WHEN NOT a.is_void THEN ts.block_group_id END), 1)
                                 ELSE NULL
                             END,
                'pct_guru',  CASE WHEN count(DISTINCT ts.schedule_id) > 0
                                  THEN round(100.0
                                       * count(DISTINCT ts.schedule_id) FILTER (WHERE ts.teacher_indicator = 'HADIR')
                                       / count(DISTINCT ts.schedule_id), 1)
                                  ELSE NULL END,
                'count_late', (
                    SELECT COUNT(*)
                    FROM late_arrivals la
                    WHERE la.school_id = v_school_id
                      AND date_trunc('month', la.late_date) = date_trunc('month', ts.session_date)
                ),
                'count_exits', (
                    SELECT COUNT(*)
                    FROM student_exits se
                    WHERE se.school_id = v_school_id
                      AND date_trunc('month', se.exit_date) = date_trunc('month', ts.session_date)
                )
            ) AS pt
            FROM teaching_schedules ts
            LEFT JOIN attendance a ON a.schedule_id = ts.schedule_id
            WHERE ts.session_date BETWEEN v_date_start AND v_date_end
              AND ts.school_id = v_school_id
              AND ts.meeting_status = 'NORMAL'
            GROUP BY date_trunc('month', ts.session_date)
        ) sub;
    ELSE
        -- ── Lokasi 3: Chart harian ────────────────────────────────────
        SELECT COALESCE(jsonb_agg(pt ORDER BY pt->>'date'), '[]'::jsonb)
        INTO v_chart
        FROM (
            SELECT jsonb_build_object(
                'date',      ts.session_date::text,
                'pct_siswa', CASE
                                 WHEN COUNT(DISTINCT CASE WHEN NOT a.is_void THEN ts.block_group_id END) > 0
                                 THEN round(100.0
                                      * COUNT(DISTINCT CASE WHEN NOT a.is_void AND a.status = 'HADIR' THEN ts.block_group_id END)
                                      / COUNT(DISTINCT CASE WHEN NOT a.is_void THEN ts.block_group_id END), 1)
                                 ELSE NULL
                             END,
                'pct_guru',  CASE WHEN count(DISTINCT ts.schedule_id) > 0
                                  THEN round(100.0
                                       * count(DISTINCT ts.schedule_id) FILTER (WHERE ts.teacher_indicator = 'HADIR')
                                       / count(DISTINCT ts.schedule_id), 1)
                                  ELSE NULL END,
                'count_late', (
                    SELECT COUNT(*)
                    FROM late_arrivals la
                    WHERE la.school_id = v_school_id
                      AND la.late_date = ts.session_date
                ),
                'count_exits', (
                    SELECT COUNT(*)
                    FROM student_exits se
                    WHERE se.school_id = v_school_id
                      AND se.exit_date = ts.session_date
                )
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
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_kepsek_monitoring(text, text, date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_kepsek_monitoring(text, text, date, date) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_kepsek_monitoring(text, text, date, date) TO authenticated;
