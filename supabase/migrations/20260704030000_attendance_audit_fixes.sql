-- ============================================================
-- Perbaikan Audit Absensi (docs/audit/attendance-audit.md) 2026-07-04
-- ABS-1  kunci periode school-scoped (attendance+observasi+jurnal)
-- PKL-1  kunci periode untuk pkl_attendance
-- ABS-2  fn_kepsek_monitoring: gerbang peran + cabut anon
-- ABS-4  un-void absensi saat GURU_TIDAK_HADIR -> NORMAL
-- (ABS-3 sengaja tidak diubah: DELETE TU dibutuhkan cascade wizard;
--  ABS-5 diperbaiki di sisi JS, bukan migrasi ini)
-- ============================================================

-- ── ABS-1: fn_is_period_closed kini school-scoped (signature baru) ──
CREATE OR REPLACE FUNCTION fn_is_period_closed(p_date DATE, p_school_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM academic_periods
        WHERE school_id   = p_school_id
          AND start_date <= p_date
          AND end_date   >= p_date
          AND status      = 'CLOSED'
    );
$$;

COMMENT ON FUNCTION fn_is_period_closed(DATE, UUID) IS
    'ABS-1: TRUE bila p_date jatuh di academic_period CLOSED MILIK p_school_id. '
    'School-scoped agar tutup semester satu sekolah tak membekukan sekolah lain.';

-- Lock functions memasok school_id dari entitas induk (bukan NEW.school_id,
-- agar tak bergantung urutan trigger auto_school_id).

CREATE OR REPLACE FUNCTION fn_attendance_period_lock()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_session_date DATE;
    v_school_id    UUID;
BEGIN
    SELECT session_date, school_id INTO v_session_date, v_school_id
    FROM teaching_schedules WHERE schedule_id = NEW.schedule_id;

    IF fn_is_period_closed(v_session_date, v_school_id) THEN
        RAISE EXCEPTION
            'Periode sudah ditutup untuk tanggal %. Tidak dapat menambah/mengubah absensi.',
            v_session_date USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION fn_observation_period_lock()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_school_id UUID;
BEGIN
    SELECT school_id INTO v_school_id FROM students WHERE student_id = NEW.student_id;
    IF fn_is_period_closed(NEW.observed_at, v_school_id) THEN
        RAISE EXCEPTION
            'Periode sudah ditutup untuk tanggal %. Tidak dapat menambah/mengubah observasi.',
            NEW.observed_at USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION fn_journal_period_lock()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_school_id UUID;
BEGIN
    SELECT school_id INTO v_school_id FROM users WHERE user_id = NEW.owner_user_id;
    IF fn_is_period_closed(NEW.entry_date, v_school_id) THEN
        RAISE EXCEPTION
            'Periode sudah ditutup untuk tanggal %. Tidak dapat menambah/mengubah jurnal.',
            NEW.entry_date USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

-- Buang signature lama 1-argumen (tak ada lagi pemanggil).
DROP FUNCTION IF EXISTS fn_is_period_closed(DATE);

-- ── PKL-1: kunci periode untuk pkl_attendance ──
CREATE OR REPLACE FUNCTION fn_pkl_attendance_period_lock()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_school_id UUID;
BEGIN
    SELECT school_id INTO v_school_id FROM students WHERE student_id = NEW.student_id;
    IF fn_is_period_closed(NEW.attendance_date, v_school_id) THEN
        RAISE EXCEPTION
            'Periode sudah ditutup untuk tanggal %. Tidak dapat menambah/mengubah absensi PKL.',
            NEW.attendance_date USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pkl_attendance_period_lock ON pkl_attendance;
CREATE TRIGGER trg_pkl_attendance_period_lock
    BEFORE INSERT OR UPDATE ON pkl_attendance
    FOR EACH ROW EXECUTE FUNCTION fn_pkl_attendance_period_lock();

-- ── ABS-4: un-void absensi saat sesi GURU_TIDAK_HADIR dikembalikan NORMAL ──
CREATE OR REPLACE FUNCTION fn_unvoid_session_attendance()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    UPDATE attendance
    SET is_void     = FALSE,
        void_reason = NULL,
        updated_at  = NOW()
    WHERE schedule_id = NEW.schedule_id
      AND is_void     = TRUE
      AND void_reason = 'GURU_TIDAK_HADIR: session voided automatically';
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_unvoid_session_attendance ON teaching_schedules;
CREATE TRIGGER trg_unvoid_session_attendance
    AFTER UPDATE OF meeting_status ON teaching_schedules
    FOR EACH ROW
    WHEN (NEW.meeting_status = 'NORMAL' AND OLD.meeting_status = 'GURU_TIDAK_HADIR')
    EXECUTE FUNCTION fn_unvoid_session_attendance();

-- ── ABS-2: fn_kepsek_monitoring — gerbang peran + cabut anon ──
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
    -- ABS-2: hanya pengamat se-sekolah (Kepsek/Waka/BK) — bukan siswa/ortu/TU.
    IF NOT fn_is_schoolwide_observer() THEN
        RAISE EXCEPTION 'Akses ditolak: monitoring hanya untuk Kepala Sekolah, Waka, atau BK.';
    END IF;

    SELECT school_id INTO v_school_id
    FROM users WHERE auth_user_id = auth.uid() LIMIT 1;
    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'User tidak ditemukan atau tidak memiliki school_id';
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
            count(DISTINCT ts.schedule_id)                                                         AS sesi_total,
            count(DISTINCT ts.schedule_id) FILTER (WHERE ts.meeting_status <> 'GURU_TIDAK_HADIR') AS guru_hadir,
            count(a.attendance_id)         FILTER (WHERE NOT a.is_void)                           AS att_total,
            count(a.attendance_id)         FILTER (WHERE NOT a.is_void AND a.status = 'HADIR')    AS att_hadir
        FROM teaching_schedules ts
        LEFT JOIN attendance a ON a.schedule_id = ts.schedule_id
        WHERE ts.session_date BETWEEN v_date_start AND v_date_end
          AND ts.school_id = v_school_id
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

REVOKE EXECUTE ON FUNCTION fn_kepsek_monitoring(text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION fn_kepsek_monitoring(text, text) TO authenticated;
