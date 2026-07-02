-- ============================================================
-- Migration 20260702170000: Auto-deactivate staf tanpa jadwal
--
-- Fungsi fn_get_stale_staff   → daftar GURU aktif yang tidak
--   punya teaching_assignment di tahun ajaran sekolah saat ini.
-- Fungsi fn_deactivate_stale_staff → jalankan deaktivasi batch
--   dan kembalikan jumlah yang dinonaktifkan.
--
-- Scope: hanya GURU murni (bukan yang pegang jabatan tambahan:
-- is_kepsek / is_bk / is_waka_* / wali_kelas_class_id /
-- kaprodi_program_id). Jabatan struktural dikecualikan karena
-- peran mereka tidak tercermin di teaching_assignments.
-- ============================================================

-- ── Preview: kembalikan daftar staf stale ──────────────────
-- Menggunakan fn_current_school_id() agar tidak perlu
-- p_school_id dari client — lebih aman, tidak bisa spoof.
CREATE OR REPLACE FUNCTION fn_get_stale_staff()
RETURNS TABLE (
    user_id          uuid,
    full_name        text,
    login_identifier text,
    teacher_code     text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT u.user_id, u.full_name, u.login_identifier, u.teacher_code
    FROM   users u
    JOIN   school_config sc ON sc.school_id = fn_current_school_id()
    WHERE  u.school_id   = fn_current_school_id()
    AND    u.is_active   = TRUE
    AND    u.role_type   = 'GURU'
    AND    u.is_kepsek          IS NOT TRUE
    AND    u.is_bk              IS NOT TRUE
    AND    u.is_waka_kurikulum  IS NOT TRUE
    AND    u.is_waka_kesiswaan  IS NOT TRUE
    AND    u.wali_kelas_class_id IS NULL
    AND    u.kaprodi_program_id  IS NULL
    AND NOT EXISTS (
        SELECT 1
        FROM   teaching_assignments ta
        WHERE  ta.user_id       = u.user_id
        AND    ta.school_id     = fn_current_school_id()
        AND    ta.academic_year = sc.current_academic_year
    )
    ORDER BY u.full_name;
$$;

-- ── Eksekusi: nonaktifkan semuanya, kembalikan jumlah ──────
CREATE OR REPLACE FUNCTION fn_deactivate_stale_staff()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count integer;
    v_sid   uuid := fn_current_school_id();
BEGIN
    WITH stale AS (
        SELECT user_id FROM fn_get_stale_staff()
    )
    UPDATE users
       SET is_active = FALSE
     WHERE user_id IN (SELECT user_id FROM stale)
       AND school_id = v_sid;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION fn_get_stale_staff()         TO authenticated;
GRANT EXECUTE ON FUNCTION fn_deactivate_stale_staff()  TO authenticated;
