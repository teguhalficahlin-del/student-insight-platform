-- ============================================================
-- Migration: 20260630190000_stakeholder_summary_rpc.sql
-- RPC ringkasan sekolah (agregat) untuk Portal Stakeholder
-- (/stakeholder/). Read-only, hanya angka & persentase — tanpa
-- PII (tidak ada nama siswa/staf, tidak ada baris detail).
--
-- LATAR BELAKANG
-- role_type 'STAKEHOLDER' (ditambah di migrasi 20260630110000)
-- sengaja TIDAK punya policy baca row-level apa pun di
-- contracts/06_rls_policies.sql — stakeholder hanya boleh melihat
-- "ringkasan %" sekolah, bukan data per-siswa. Query count langsung
-- dari client karena itu akan kembali 0 (RLS menolak).
--
-- SOLUSI
-- Fungsi SECURITY DEFINER yang menghitung agregat di sisi server
-- (bypass RLS) lalu hanya mengembalikan angka ringkasan. Dengan
-- begitu stakeholder dapat dashboard tanpa pernah menyentuh baris
-- berisi PII. Pola sama dengan getSchoolStats di guru/js/api.js,
-- tapi dibungkus RPC agar bisa dipanggil role tanpa RLS read.
--
-- AKSES
-- EXECUTE untuk authenticated (output non-identifying). KEPSEK juga
-- bisa pakai bila perlu pratinjau yang sama.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_stakeholder_summary()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'total_siswa',
            (SELECT count(*) FROM students WHERE student_status = 'AKTIF'),
        'total_pkl',
            (SELECT count(*) FROM students WHERE student_status = 'PKL'),
        'total_staf',
            (SELECT count(*) FROM users
             WHERE role_type NOT IN ('SISWA','ORTU','DUDI','ADMINISTRATIVE','STAKEHOLDER')),
        'total_program',
            (SELECT count(*) FROM programs),
        'total_kelas',
            (SELECT count(*) FROM classes),
        'sesi_hari_ini',
            (SELECT count(*) FROM teaching_schedules WHERE session_date = CURRENT_DATE),
        'hadir_hari_ini',
            (SELECT count(*) FROM attendance
             WHERE is_void = FALSE AND status = 'HADIR' AND created_at >= CURRENT_DATE),
        'kehadiran_bulan_pct',
            (SELECT CASE WHEN count(*) = 0 THEN NULL
                    ELSE round(100.0 * count(*) FILTER (WHERE status = 'HADIR') / count(*), 1)
                    END
             FROM attendance
             WHERE is_void = FALSE
               AND created_at >= date_trunc('month', CURRENT_DATE)),
        'updated_at', now()
    );
$$;

REVOKE EXECUTE ON FUNCTION fn_stakeholder_summary FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION fn_stakeholder_summary TO authenticated;

COMMENT ON FUNCTION fn_stakeholder_summary IS
    'Ringkasan agregat sekolah (non-PII) untuk Portal Stakeholder. '
    'SECURITY DEFINER agar role STAKEHOLDER (tanpa RLS read row-level) '
    'tetap bisa melihat angka & persentase ringkasan.';
