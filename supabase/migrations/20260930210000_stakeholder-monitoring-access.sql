-- ============================================================
-- Migration: 20260930210000_stakeholder-monitoring-access.sql
--
-- TUJUAN: Portal Stakeholder menampilkan monitoring kehadiran yang
--         identik dengan yang dilihat Kepala Sekolah.
--
-- YANG BERUBAH: HANYA gerbang peran. Logika agregasi, rentang
--         tanggal, dan bentuk payload tidak disentuh sama sekali —
--         badan fungsi disalin apa adanya dari migration
--         20260802160000 lalu diganti 3 baris secara terprogram,
--         bukan diketik ulang.
--
-- KENAPA MELEBARKAN FUNGSI LAMA, BUKAN BIKIN RPC BARU:
--         menyalin ~300 baris agregasi berarti dua sumber kebenaran
--         yang pasti melenceng seiring waktu, lalu Kepala Sekolah dan
--         Stakeholder melihat angka berbeda untuk hal yang sama.
--
-- KEAMANAN:
--   - Nol PII. Payload hanya persentase dan hitungan agregat
--     (pct_siswa, pct_guru, siswa_hadir/total, guru_hadir/total,
--     count_late, count_exits) plus deret waktunya.
--   - Isolasi tenant tidak berubah: v_school_id tetap diturunkan
--     server-side dari auth.uid(), tidak pernah dari input klien.
--   - Kasus BK dan Kelola Admin TIDAK ikut dibuka ke Stakeholder.
--     Keduanya seksi terpisah di portal guru dan tidak tersentuh
--     migration ini.
--
-- Tanda tangan fungsi TIDAK berubah (text, text, date, date).
-- ============================================================
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
    v_boleh_lihat boolean;
    v_date_start  date;
    v_date_end    date;
    v_by_month    boolean := FALSE;
    v_ay_year     int;
    v_summary     JSONB;
    v_chart       JSONB;
BEGIN
    SELECT school_id,
           (role_type IN ('KEPSEK', 'STAKEHOLDER') OR COALESCE(is_kepsek, FALSE))
    INTO v_school_id, v_boleh_lihat
    FROM users WHERE auth_user_id = auth.uid() LIMIT 1;

    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'User tidak ditemukan atau tidak memiliki school_id';
    END IF;
    IF NOT v_boleh_lihat THEN
        RAISE EXCEPTION 'Akses ditolak: monitoring ini hanya untuk Kepala Sekolah dan Stakeholder';
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
            -- FIX 3: pertahankan semantik tahun ajaran Jul–Jun (bukan kalender gregorian)
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
    -- (identik dengan 20260802150000 — tidak ada perubahan)
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
        'count_late', (
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
        -- ── Lokasi 2: Chart bulanan — FIX 1 + FIX 2 ──────────────────
        --
        -- FIX 1: derived table `b` menghasilkan satu baris per bulan.
        -- Outer SELECT tidak punya GROUP BY — b.bulan adalah kolom polos,
        -- sehingga sublink boleh mereferensinya tanpa SQLSTATE 42803.
        --
        -- FIX 2: CTE MATERIALIZED dihitung sekali di luar loop bucket.
        WITH v_siswa_aktif AS MATERIALIZED (
            SELECT COUNT(DISTINCT student_id) AS total
            FROM students
            WHERE school_id = v_school_id
              AND student_status IN ('AKTIF', 'PKL')
        )
        SELECT COALESCE(jsonb_agg(pt ORDER BY pt->>'date'), '[]'::jsonb)
        INTO v_chart
        FROM (
            SELECT jsonb_build_object(
                -- format string 'YYYY-MM-01' identik dengan 20260802150000
                'date', to_char(b.bulan, 'YYYY-MM-01'),

                -- FIX 1 referensi #1: ts_inner.session_date = b.bulan
                'pct_siswa', CASE WHEN (SELECT total FROM v_siswa_aktif) > 0
                    THEN round(100.0 * (
                        SELECT COUNT(DISTINCT s2.student_id)
                        FROM students s2
                        JOIN attendance a2 ON a2.student_id = s2.student_id
                        JOIN teaching_schedules ts_inner
                            ON ts_inner.schedule_id = a2.schedule_id
                            AND ts_inner.meeting_status = 'NORMAL'
                            AND ts_inner.school_id = v_school_id
                        WHERE s2.school_id = v_school_id
                          AND s2.student_status IN ('AKTIF', 'PKL')
                          AND a2.status = 'HADIR'
                          AND NOT a2.is_void
                          AND date_trunc('month', ts_inner.session_date) = b.bulan
                    ) / (SELECT total FROM v_siswa_aktif), 1)
                    ELSE NULL END,

                -- FIX 1 referensi #2: date_trunc('month', ts2.session_date) = b.bulan
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
                    WHERE date_trunc('month', ts2.session_date) = b.bulan
                      AND ts2.school_id = v_school_id
                      AND ts2.meeting_status = 'NORMAL'
                ),

                -- FIX 1 referensi #3: date_trunc('month', la.late_date) = b.bulan
                'count_late', (
                    SELECT COUNT(*)
                    FROM late_arrivals la
                    WHERE la.school_id = v_school_id
                      AND date_trunc('month', la.late_date) = b.bulan
                ),

                -- FIX 1 referensi #4: date_trunc('month', se.exit_date) = b.bulan
                'count_exits', (
                    SELECT COUNT(*)
                    FROM student_exits se
                    WHERE se.school_id = v_school_id
                      AND date_trunc('month', se.exit_date) = b.bulan
                )
            ) AS pt
            FROM (
                -- derived table: satu baris per bulan di rentang
                SELECT date_trunc('month', ts.session_date)::date AS bulan
                FROM teaching_schedules ts
                WHERE ts.session_date BETWEEN v_date_start AND v_date_end
                  AND ts.school_id = v_school_id
                  AND ts.meeting_status = 'NORMAL'
                GROUP BY 1
            ) b
        ) sub;
    ELSE
        -- ── Lokasi 3: Chart harian — FIX 2 saja ─────────────────────
        -- GROUP BY ts.session_date sudah kolom polos — tidak kena 42803.
        -- FIX 2: CTE MATERIALIZED menggantikan correlated subquery denominator.
        WITH v_siswa_aktif AS MATERIALIZED (
            SELECT COUNT(DISTINCT student_id) AS total
            FROM students
            WHERE school_id = v_school_id
              AND student_status IN ('AKTIF', 'PKL')
        )
        SELECT COALESCE(jsonb_agg(pt ORDER BY pt->>'date'), '[]'::jsonb)
        INTO v_chart
        FROM (
            SELECT jsonb_build_object(
                'date', ts.session_date::text,
                'pct_siswa', CASE WHEN (SELECT total FROM v_siswa_aktif) > 0
                    THEN round(100.0 * (
                        SELECT COUNT(DISTINCT s2.student_id)
                        FROM students s2
                        JOIN attendance a2 ON a2.student_id = s2.student_id
                        JOIN teaching_schedules ts_inner
                            ON ts_inner.schedule_id = a2.schedule_id
                            AND ts_inner.meeting_status = 'NORMAL'
                            AND ts_inner.school_id = v_school_id
                        WHERE s2.school_id = v_school_id
                          AND s2.student_status IN ('AKTIF', 'PKL')
                          AND a2.status = 'HADIR'
                          AND NOT a2.is_void
                          AND ts_inner.session_date = ts.session_date
                    ) / (SELECT total FROM v_siswa_aktif), 1)
                    ELSE NULL END,
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

    -- FIX 4: data_earliest untuk JS disable tombol periode tanpa data
    RETURN jsonb_build_object(
        'period',        p_period,
        'date_start',    v_date_start,
        'date_end',      v_date_end,
        'by_month',      v_by_month,
        'summary',       v_summary,
        'chart',         v_chart,
        'data_earliest', (
            SELECT MIN(ts.session_date)
            FROM teaching_schedules ts
            WHERE ts.school_id = v_school_id
              AND ts.meeting_status = 'NORMAL'
        )
    );
END;
$function$;

GRANT  EXECUTE ON FUNCTION public.fn_kepsek_monitoring(text, text, date, date) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_kepsek_monitoring(text, text, date, date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_kepsek_monitoring(text, text, date, date) FROM PUBLIC;
