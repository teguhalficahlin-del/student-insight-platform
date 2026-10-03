-- Migration: 20261003110000_fix-stakeholder-summary-session-date.sql
--
-- Temuan audit #12: fn_stakeholder_summary memakai created_at untuk menghitung
-- hadir_hari_ini dan kehadiran_bulan_pct. Dengan mode offline, absensi yang
-- disinkronisasi terlambat masuk ke periode yang salah karena created_at mencerminkan
-- waktu INSERT, bukan tanggal sesi.
--
-- Fix: ganti filter created_at dengan JOIN ke teaching_schedules.session_date,
-- sesuai dengan fn_kepsek_monitoring yang sudah benar sejak 20260802150000.

CREATE OR REPLACE FUNCTION public.fn_stakeholder_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    IF NOT (fn_is_kepsek() OR fn_current_user_role() = 'STAKEHOLDER') THEN
        RAISE EXCEPTION 'akses ditolak: hanya kepsek/stakeholder'
            USING ERRCODE = '42501';
    END IF;

    RETURN (
        SELECT jsonb_build_object(
            'total_siswa',
                (SELECT count(*) FROM students
                 WHERE student_status = 'AKTIF'
                   AND school_id = fn_current_school_id()),
            'total_pkl',
                (SELECT count(*) FROM students
                 WHERE student_status = 'PKL'
                   AND school_id = fn_current_school_id()),
            'total_staf',
                (SELECT count(*) FROM users
                 WHERE role_type NOT IN ('SISWA','ORTU','DUDI','ADMINISTRATIVE','STAKEHOLDER')
                   AND school_id = fn_current_school_id()),
            'total_program',
                (SELECT count(*) FROM programs
                 WHERE school_id = fn_current_school_id()),
            'total_kelas',
                (SELECT count(*) FROM classes
                 WHERE school_id = fn_current_school_id()),
            'sesi_hari_ini',
                (SELECT count(*) FROM teaching_schedules
                 WHERE session_date = CURRENT_DATE
                   AND school_id = fn_current_school_id()),
            'hadir_hari_ini',
                (SELECT count(*)
                 FROM attendance a
                 JOIN teaching_schedules ts ON ts.schedule_id = a.schedule_id
                 WHERE a.is_void = FALSE
                   AND a.status = 'HADIR'
                   AND ts.session_date = CURRENT_DATE
                   AND a.school_id = fn_current_school_id()),
            'kehadiran_bulan_pct',
                (SELECT CASE WHEN count(*) = 0 THEN NULL
                        ELSE round(100.0 * count(*) FILTER (WHERE a.status = 'HADIR') / count(*), 1)
                        END
                 FROM attendance a
                 JOIN teaching_schedules ts ON ts.schedule_id = a.schedule_id
                 WHERE a.is_void = FALSE
                   AND ts.session_date >= date_trunc('month', CURRENT_DATE)
                   AND a.school_id = fn_current_school_id()),
            'updated_at', now()
        )
    );
END;
$$;

GRANT  EXECUTE ON FUNCTION fn_stakeholder_summary() TO authenticated;
REVOKE EXECUTE ON FUNCTION fn_stakeholder_summary() FROM anon;
REVOKE EXECUTE ON FUNCTION fn_stakeholder_summary() FROM PUBLIC;
