-- Migration: 20260802150000_fn-kepsek-monitoring-fix-chart-individu.sql
--
-- Fix Lokasi 2 (chart bulanan) dan Lokasi 3 (chart harian) di
-- fn_kepsek_monitoring: pct_siswa dan pct_guru sekarang berbasis individu,
-- konsisten dengan Lokasi 1 yang sudah difix di 20260802140000.
--
-- BUG LAMA (20260802140000):
--   Lokasi 2 & 3 masih pakai block_group_id sebagai denominator
--   → satu siswa hadir di N sesi dihitung sebagai N kehadiran
--   → pct_siswa bisa melebihi 100% atau distorted
--
-- FIX (Lokasi 2 — chart bulanan):
--   pct_siswa = COUNT(DISTINCT student_id HADIR bulan X) / COUNT(DISTINCT siswa aktif)
--   pct_guru  = COUNT(DISTINCT scheduled_teacher_id punya att bulan X) /
--               COUNT(DISTINCT scheduled_teacher_id berjadwal bulan X)
--
-- FIX (Lokasi 3 — chart harian):
--   Sama dengan Lokasi 2 tapi granularitas per hari (= ts.session_date).
--
-- Lokasi 1 (summary) identik dengan 20260802140000 — tidak diubah.
-- count_late dan count_exits tidak diubah.
-- Outer FROM Lokasi 2 & 3: LEFT JOIN attendance a dihapus (tidak lagi dipakai).

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

    -- ── Lokasi 1: Summary agregat — berbasis individu ─────────────────
    -- (identik dengan 20260802140000 — tidak ada perubahan)
    SELECT jsonb_build_object(
        'pct_siswa',
            (SELECT CASE WHEN COUNT(DISTINCT s.student_id) > 0
                THEN round(100.0 *
                    COUNT(DISTINCT CASE WHEN a.status = 'HADIR' AND NOT a.is_void
                          AND ts2.session_date BETWEEN v_date_start AND v_date_end
                          THEN a.student_id END) /
                    COUNT(DISTINCT s.student_id), 1)
                ELSE NULL END
            FROM students s
            LEFT JOIN attendance a ON a.student_id = s.student_id
            LEFT JOIN teaching_schedules ts2
                ON ts2.schedule_id = a.schedule_id
                AND ts2.meeting_status = 'NORMAL'
                AND ts2.school_id = v_school_id
            WHERE s.school_id = v_school_id
              AND s.student_status IN ('AKTIF', 'PKL')),
        'pct_guru',
            (SELECT CASE WHEN COUNT(DISTINCT ts3.scheduled_teacher_id) > 0
                THEN round(100.0 *
                    COUNT(DISTINCT CASE WHEN EXISTS (
                        SELECT 1 FROM attendance ax
                        WHERE ax.schedule_id = ts3.schedule_id AND NOT ax.is_void
                    ) THEN ts3.scheduled_teacher_id END) /
                    COUNT(DISTINCT ts3.scheduled_teacher_id), 1)
                ELSE NULL END
            FROM teaching_schedules ts3
            WHERE ts3.session_date BETWEEN v_date_start AND v_date_end
              AND ts3.school_id = v_school_id
              AND ts3.meeting_status = 'NORMAL'),
        'siswa_hadir',
            (SELECT COUNT(DISTINCT CASE WHEN a.status = 'HADIR' AND NOT a.is_void
                          AND ts2.session_date BETWEEN v_date_start AND v_date_end
                          THEN a.student_id END)
            FROM students s
            LEFT JOIN attendance a ON a.student_id = s.student_id
            LEFT JOIN teaching_schedules ts2
                ON ts2.schedule_id = a.schedule_id
                AND ts2.meeting_status = 'NORMAL'
                AND ts2.school_id = v_school_id
            WHERE s.school_id = v_school_id
              AND s.student_status IN ('AKTIF', 'PKL')),
        'siswa_total',
            (SELECT COUNT(DISTINCT s.student_id)
            FROM students s
            WHERE s.school_id = v_school_id
              AND s.student_status IN ('AKTIF', 'PKL')),
        'guru_hadir',
            (SELECT COUNT(DISTINCT CASE WHEN EXISTS (
                SELECT 1 FROM attendance ax
                WHERE ax.schedule_id = ts3.schedule_id AND NOT ax.is_void
            ) THEN ts3.scheduled_teacher_id END)
            FROM teaching_schedules ts3
            WHERE ts3.session_date BETWEEN v_date_start AND v_date_end
              AND ts3.school_id = v_school_id
              AND ts3.meeting_status = 'NORMAL'),
        'guru_total',
            (SELECT COUNT(DISTINCT ts3.scheduled_teacher_id)
            FROM teaching_schedules ts3
            WHERE ts3.session_date BETWEEN v_date_start AND v_date_end
              AND ts3.school_id = v_school_id
              AND ts3.meeting_status = 'NORMAL'),
        'count_late',  (
            SELECT COUNT(*) FROM late_arrivals la
            WHERE la.school_id = v_school_id
              AND la.late_date BETWEEN v_date_start AND v_date_end
        ),
        'count_exits', (
            SELECT COUNT(*) FROM student_exits se
            WHERE se.school_id = v_school_id
              AND se.exit_date BETWEEN v_date_start AND v_date_end
        )
    )
    INTO v_summary;

    IF v_by_month THEN
        -- ── Lokasi 2: Chart bulanan — berbasis individu ───────────────
        SELECT COALESCE(jsonb_agg(pt ORDER BY pt->>'date'), '[]'::jsonb)
        INTO v_chart
        FROM (
            SELECT jsonb_build_object(
                'date', to_char(date_trunc('month', ts.session_date), 'YYYY-MM-01'),
                'pct_siswa', (
                    SELECT CASE WHEN COUNT(DISTINCT s2.student_id) > 0
                        THEN round(100.0 *
                            COUNT(DISTINCT CASE WHEN a2.status = 'HADIR' AND NOT a2.is_void
                                  AND date_trunc('month', ts_inner.session_date) =
                                      date_trunc('month', ts.session_date)
                                  THEN a2.student_id END) /
                            COUNT(DISTINCT s2.student_id), 1)
                        ELSE NULL END
                    FROM students s2
                    LEFT JOIN attendance a2 ON a2.student_id = s2.student_id
                    LEFT JOIN teaching_schedules ts_inner
                        ON ts_inner.schedule_id = a2.schedule_id
                        AND ts_inner.meeting_status = 'NORMAL'
                        AND ts_inner.school_id = v_school_id
                    WHERE s2.school_id = v_school_id
                      AND s2.student_status IN ('AKTIF', 'PKL')
                ),
                'pct_guru', (
                    SELECT CASE WHEN COUNT(DISTINCT ts2.scheduled_teacher_id) > 0
                        THEN round(100.0 *
                            COUNT(DISTINCT CASE WHEN EXISTS (
                                SELECT 1 FROM attendance ax
                                WHERE ax.schedule_id = ts2.schedule_id AND NOT ax.is_void
                            ) THEN ts2.scheduled_teacher_id END) /
                            COUNT(DISTINCT ts2.scheduled_teacher_id), 1)
                        ELSE NULL END
                    FROM teaching_schedules ts2
                    WHERE date_trunc('month', ts2.session_date) =
                          date_trunc('month', ts.session_date)
                      AND ts2.school_id = v_school_id
                      AND ts2.meeting_status = 'NORMAL'
                ),
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
            WHERE ts.session_date BETWEEN v_date_start AND v_date_end
              AND ts.school_id = v_school_id
              AND ts.meeting_status = 'NORMAL'
            GROUP BY date_trunc('month', ts.session_date)
        ) sub;
    ELSE
        -- ── Lokasi 3: Chart harian — berbasis individu ────────────────
        SELECT COALESCE(jsonb_agg(pt ORDER BY pt->>'date'), '[]'::jsonb)
        INTO v_chart
        FROM (
            SELECT jsonb_build_object(
                'date', ts.session_date::text,
                'pct_siswa', (
                    SELECT CASE WHEN COUNT(DISTINCT s2.student_id) > 0
                        THEN round(100.0 *
                            COUNT(DISTINCT CASE WHEN a2.status = 'HADIR' AND NOT a2.is_void
                                  AND ts_inner.session_date = ts.session_date
                                  THEN a2.student_id END) /
                            COUNT(DISTINCT s2.student_id), 1)
                        ELSE NULL END
                    FROM students s2
                    LEFT JOIN attendance a2 ON a2.student_id = s2.student_id
                    LEFT JOIN teaching_schedules ts_inner
                        ON ts_inner.schedule_id = a2.schedule_id
                        AND ts_inner.meeting_status = 'NORMAL'
                        AND ts_inner.school_id = v_school_id
                    WHERE s2.school_id = v_school_id
                      AND s2.student_status IN ('AKTIF', 'PKL')
                ),
                'pct_guru', (
                    SELECT CASE WHEN COUNT(DISTINCT ts2.scheduled_teacher_id) > 0
                        THEN round(100.0 *
                            COUNT(DISTINCT CASE WHEN EXISTS (
                                SELECT 1 FROM attendance ax
                                WHERE ax.schedule_id = ts2.schedule_id AND NOT ax.is_void
                            ) THEN ts2.scheduled_teacher_id END) /
                            COUNT(DISTINCT ts2.scheduled_teacher_id), 1)
                        ELSE NULL END
                    FROM teaching_schedules ts2
                    WHERE ts2.session_date = ts.session_date
                      AND ts2.school_id = v_school_id
                      AND ts2.meeting_status = 'NORMAL'
                ),
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
