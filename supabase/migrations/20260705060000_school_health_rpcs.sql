-- ============================================================
-- Migration: 20260705060000_school_health_rpcs.sql
--
-- Dua RPC untuk dashboard health Superadmin.
-- Dipakai oleh list-schools edge function untuk menampilkan
-- status data setiap sekolah tanpa N+1 query.
--
-- fn_school_staff_health  → jabatan singleton + jumlah staf
-- fn_school_student_health → jumlah siswa + yang sudah punya akun
-- ============================================================

-- ── fn_school_staff_health ────────────────────────────────────
-- Menghitung per sekolah:
--   kepsek_count          : jumlah user aktif yang adalah Kepsek
--   waka_kurikulum_count  : jumlah Waka Kurikulum aktif
--   waka_kesiswaan_count  : jumlah Waka Kesiswaan aktif
--   waka_humas_count      : jumlah Waka Humas aktif
--   staff_count           : total staf non-SISWA/ORTU/DUDI/ADMIN/STAKEHOLDER
--
-- Sekolah tanpa staf sama sekali tidak muncul di GROUP BY,
-- maka frontend harus defaultkan nilai yang hilang ke 0.
CREATE OR REPLACE FUNCTION fn_school_staff_health()
RETURNS TABLE (
    school_id            UUID,
    kepsek_count         BIGINT,
    waka_kurikulum_count BIGINT,
    waka_kesiswaan_count BIGINT,
    waka_humas_count     BIGINT,
    staff_count          BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        school_id,
        COUNT(*) FILTER (WHERE role_type = 'KEPSEK'         OR is_kepsek)         AS kepsek_count,
        COUNT(*) FILTER (WHERE role_type = 'WAKA_KURIKULUM' OR is_waka_kurikulum) AS waka_kurikulum_count,
        COUNT(*) FILTER (WHERE role_type = 'WAKA_KESISWAAN' OR is_waka_kesiswaan) AS waka_kesiswaan_count,
        COUNT(*) FILTER (WHERE role_type = 'WAKA_HUMAS'     OR is_waka_humas)     AS waka_humas_count,
        COUNT(*) FILTER (WHERE role_type NOT IN (
            'SISWA','ORTU','DUDI','ADMINISTRATIVE','STAKEHOLDER'
        )) AS staff_count
    FROM users
    WHERE is_active  = TRUE
      AND deleted_at IS NULL
    GROUP BY school_id;
$$;

-- Hanya superadmin (service-role) yang memanggil ini
REVOKE EXECUTE ON FUNCTION fn_school_staff_health() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION fn_school_staff_health IS
    'Health check jabatan singleton + jumlah staf per sekolah. Dipanggil hanya oleh list-schools (service-role).';


-- ── fn_school_student_health ──────────────────────────────────
-- Menghitung per sekolah:
--   student_count     : total siswa (semua status kecuali tidak relevan)
--   provisioned_count : siswa yang sudah punya akun login (user_id IS NOT NULL)
CREATE OR REPLACE FUNCTION fn_school_student_health()
RETURNS TABLE (
    school_id         UUID,
    student_count     BIGINT,
    provisioned_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        school_id,
        COUNT(*)                                          AS student_count,
        COUNT(*) FILTER (WHERE user_id IS NOT NULL)      AS provisioned_count
    FROM students
    GROUP BY school_id;
$$;

REVOKE EXECUTE ON FUNCTION fn_school_student_health() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION fn_school_student_health IS
    'Health check jumlah siswa dan yang sudah diprovisioning per sekolah. Dipanggil hanya oleh list-schools (service-role).';
