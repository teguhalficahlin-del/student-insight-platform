-- ============================================================
-- Migration: 20260703110000_kepsek_monitoring_rpc_v2.sql
-- Perbaikan fn_kepsek_monitoring: denominator siswa yang benar.
--
-- SEBELUM (salah): pct = attendance_records_absen / total_attendance_records
--   → menghitung % sesi, bukan % siswa
--
-- SESUDAH (benar): pct = avg_harian_siswa_absen / total_siswa_aktif
--   Harian  : distinct siswa absen hari ini / total siswa aktif
--   Mingguan: rata-rata distinct siswa absen per hari / total siswa aktif
--   Bulanan : rata-rata distinct siswa absen per hari / total siswa aktif
--
-- Guru tidak berubah: sudah benar (sesi GURU_TIDAK_HADIR / total sesi).
-- ============================================================

CREATE OR REPLACE FUNCTION fn_kepsek_monitoring(p_period text DEFAULT 'harian')
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_school_id      uuid;
  v_date_start     date;
  v_date_end       date := CURRENT_DATE;
  v_siswa_aktif    bigint := 0;
  v_siswa_absen_avg numeric := 0;
  v_guru_total     bigint := 0;
  v_guru_absen     bigint := 0;
BEGIN
  SELECT school_id INTO v_school_id
  FROM users
  WHERE auth_user_id = auth.uid()
  LIMIT 1;

  IF v_school_id IS NULL THEN
    RAISE EXCEPTION 'User tidak ditemukan atau tidak memiliki school_id';
  END IF;

  v_date_start := CASE p_period
    WHEN 'harian'   THEN CURRENT_DATE
    WHEN 'mingguan' THEN date_trunc('week',  CURRENT_DATE)::date
    WHEN 'bulanan'  THEN date_trunc('month', CURRENT_DATE)::date
    ELSE CURRENT_DATE
  END;

  -- Denominator siswa: total siswa aktif di sekolah ini
  SELECT count(*) INTO v_siswa_aktif
  FROM students
  WHERE student_status = 'AKTIF'
    AND school_id = v_school_id;

  -- Numerator siswa: rata-rata harian distinct siswa tidak hadir
  -- Setiap hari sekolah (ada di teaching_schedules) dihitung satu titik data.
  -- Hari tanpa sesi tidak masuk hitungan (libur/weekend).
  SELECT COALESCE(round(avg(daily_absen), 1), 0) INTO v_siswa_absen_avg
  FROM (
    SELECT ts.session_date,
           count(DISTINCT a.student_id)
             FILTER (WHERE a.status <> 'HADIR' AND a.is_void = FALSE) AS daily_absen
    FROM teaching_schedules ts
    JOIN attendance a ON a.schedule_id = ts.schedule_id
    WHERE ts.session_date BETWEEN v_date_start AND v_date_end
      AND ts.school_id = v_school_id
    GROUP BY ts.session_date
  ) daily;

  -- Guru: sesi GURU_TIDAK_HADIR / total sesi terjadwal dalam periode
  SELECT
    count(*),
    count(*) FILTER (WHERE meeting_status = 'GURU_TIDAK_HADIR')
  INTO v_guru_total, v_guru_absen
  FROM teaching_schedules
  WHERE session_date BETWEEN v_date_start AND v_date_end
    AND school_id = v_school_id;

  RETURN jsonb_build_object(
    'period',          p_period,
    'date_start',      v_date_start,
    'date_end',        v_date_end,
    'siswa_aktif',     v_siswa_aktif,
    'siswa_absen_avg', v_siswa_absen_avg,
    'pct_siswa_absen',
      CASE WHEN v_siswa_aktif > 0
           THEN round(100.0 * v_siswa_absen_avg / v_siswa_aktif, 1)
           ELSE NULL END,
    'guru_absen',      v_guru_absen,
    'guru_total',      v_guru_total,
    'pct_guru_absen',
      CASE WHEN v_guru_total > 0
           THEN round(100.0 * v_guru_absen / v_guru_total, 1)
           ELSE NULL END
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION fn_kepsek_monitoring(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION fn_kepsek_monitoring(text) TO authenticated;

COMMENT ON FUNCTION fn_kepsek_monitoring(text) IS
    'Monitoring ketidakhadiran Kepsek. '
    'Siswa: rata-rata harian distinct absen / total siswa aktif. '
    'Guru: sesi GURU_TIDAK_HADIR / total sesi terjadwal. '
    'period: harian | mingguan | bulanan.';
