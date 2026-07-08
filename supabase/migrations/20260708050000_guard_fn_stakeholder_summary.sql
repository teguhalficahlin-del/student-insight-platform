-- Migration: 20260708050000_guard_fn_stakeholder_summary.sql
--
-- LATAR BELAKANG:
-- fn_stakeholder_summary() — statistik agregat sekolah (total_siswa, total_pkl,
-- total_staf, total_program, total_kelas, kehadiran_bulan_pct, dll) — dapat
-- diakses oleh SEMUA authenticated tanpa guard, padahal dirancang khusus untuk
-- portal stakeholder. Ditemukan saat scan sistemik SECURITY DEFINER (8 Juli 2026).
-- Sensitivitas data rendah (agregat, bukan personal), tapi tetap perlu dibatasi
-- sesuai desain akses per-role. Hanya dipanggil dari stakeholder/js/api.js:62.
--
-- FIX: Tambah guard KEPSEK + STAKEHOLDER, konsisten dengan pola guard di
-- fn_get_stale_staff / fn_deactivate_stale_staff (migration 20260708040000).
-- Konversi dari LANGUAGE sql ke plpgsql agar bisa pakai IF/RAISE.
-- RETURNS jsonb — tidak ada isu varchar/text cast.
-- Body SELECT identik dengan definisi live (verified 8 Juli 2026, TARGET 1).

CREATE OR REPLACE FUNCTION public.fn_stakeholder_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
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
                (SELECT count(*) FROM attendance
                 WHERE is_void = FALSE AND status = 'HADIR'
                   AND created_at >= CURRENT_DATE
                   AND school_id = fn_current_school_id()),
            'kehadiran_bulan_pct',
                (SELECT CASE WHEN count(*) = 0 THEN NULL
                        ELSE round(100.0 * count(*) FILTER (WHERE status = 'HADIR') / count(*), 1)
                        END
                 FROM attendance
                 WHERE is_void = FALSE
                   AND created_at >= date_trunc('month', CURRENT_DATE)
                   AND school_id = fn_current_school_id()),
            'updated_at', now()
        )
    );
END;
$$;
