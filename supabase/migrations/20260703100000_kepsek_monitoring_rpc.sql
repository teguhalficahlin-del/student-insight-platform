-- ============================================================
-- Migration: 20260703100000_kepsek_monitoring_rpc.sql
-- RPC fn_kepsek_monitoring: persentase ketidakhadiran siswa
-- dan guru untuk dashboard Monitoring Kepala Sekolah.
--
-- Mengembalikan agregat per periode (harian/mingguan/bulanan):
--   pct_siswa_absen  = siswa tidak hadir / total sesi attendance
--   pct_guru_absen   = sesi guru tidak hadir / total sesi terjadwal
--
-- SECURITY DEFINER + filter school_id dari auth.uid() agar
-- multi-tenant aman dan tidak butuh RLS bypass lintas sekolah.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_kepsek_monitoring(p_period text DEFAULT 'harian')
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_school_id  uuid;
  v_date_start date;
  v_date_end   date := CURRENT_DATE;
  v_siswa_total bigint := 0;
  v_siswa_absen bigint := 0;
  v_guru_total  bigint := 0;
  v_guru_absen  bigint := 0;
BEGIN
  -- Ambil school_id user yang memanggil RPC ini
  SELECT school_id INTO v_school_id
  FROM users
  WHERE auth_user_id = auth.uid()
  LIMIT 1;

  IF v_school_id IS NULL THEN
    RAISE EXCEPTION 'User tidak ditemukan atau tidak memiliki school_id';
  END IF;

  v_date_start := CASE p_period
    WHEN 'harian'   THEN CURRENT_DATE
    WHEN 'mingguan' THEN date_trunc('week', CURRENT_DATE)::date
    WHEN 'bulanan'  THEN date_trunc('month', CURRENT_DATE)::date
    ELSE CURRENT_DATE
  END;

  -- Siswa: hitung via JOIN teaching_schedules → attendance
  SELECT
    count(*) FILTER (WHERE a.is_void = FALSE),
    count(*) FILTER (WHERE a.is_void = FALSE AND a.status <> 'HADIR')
  INTO v_siswa_total, v_siswa_absen
  FROM teaching_schedules ts
  JOIN attendance a ON a.schedule_id = ts.schedule_id
  WHERE ts.session_date BETWEEN v_date_start AND v_date_end
    AND ts.school_id = v_school_id;

  -- Guru: meeting_status di teaching_schedules
  SELECT
    count(*),
    count(*) FILTER (WHERE meeting_status = 'GURU_TIDAK_HADIR')
  INTO v_guru_total, v_guru_absen
  FROM teaching_schedules
  WHERE session_date BETWEEN v_date_start AND v_date_end
    AND school_id = v_school_id;

  RETURN jsonb_build_object(
    'period',       p_period,
    'date_start',   v_date_start,
    'date_end',     v_date_end,
    'siswa_absen',  v_siswa_absen,
    'siswa_total',  v_siswa_total,
    'pct_siswa_absen',
      CASE WHEN v_siswa_total > 0
           THEN round(100.0 * v_siswa_absen / v_siswa_total, 1)
           ELSE NULL END,
    'guru_absen',   v_guru_absen,
    'guru_total',   v_guru_total,
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
    'Ringkasan % ketidakhadiran siswa dan guru untuk Kepala Sekolah. '
    'period: harian | mingguan | bulanan. '
    'SECURITY DEFINER + filter school_id agar multi-tenant aman.';
