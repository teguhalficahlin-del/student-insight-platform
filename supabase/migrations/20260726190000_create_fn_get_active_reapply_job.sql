-- =============================================================================
-- Migration: 20260726190000_create_fn_get_active_reapply_job.sql
-- Tujuan   : RPC untuk client cek apakah ada job reapply aktif untuk periode
--            tertentu. Dipanggil oleh admin UI saat panel Schedule Builder
--            dibuka, untuk menampilkan resume banner jika diperlukan.
--
-- Return 0 baris kalau tidak ada job aktif (bukan error — client interpretasikan
-- sebagai "tidak ada proses berjalan").
--
-- Bergantung pada: 20260726160000_create_schedule_reapply_jobs.sql (tabel)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_get_active_reapply_job(
    p_academic_year text,
    p_semester      semester
)
RETURNS TABLE (
    job_id          uuid,
    status          text,
    total_to_delete integer,
    deleted_count   integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_school_id uuid;
    v_role      role_type;
BEGIN
    v_school_id := fn_current_school_id();
    v_role      := fn_current_user_role();

    IF v_school_id IS NULL OR v_role IS NULL THEN
        RAISE EXCEPTION 'Sesi tidak valid — silakan login ulang';
    END IF;

    IF v_role <> 'ADMINISTRATIVE'::role_type THEN
        RAISE EXCEPTION 'Hanya akun ADMINISTRATIVE yang dapat memeriksa status Terapkan Ulang';
    END IF;

    RETURN QUERY
    SELECT j.job_id, j.status, j.total_to_delete, j.deleted_count
    FROM   schedule_reapply_jobs j
    WHERE  j.school_id     = v_school_id
      AND  j.academic_year = p_academic_year
      AND  j.semester      = p_semester
      AND  j.status IN ('PENDING', 'DELETING', 'DELETED', 'GENERATING')
    LIMIT  1;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_get_active_reapply_job(text, semester) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_get_active_reapply_job(text, semester) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_get_active_reapply_job(text, semester) TO authenticated;

COMMENT ON FUNCTION public.fn_get_active_reapply_job IS
    'Cek apakah ada job reapply aktif untuk (academic_year, semester) sekolah ini. '
    'Return 0 baris = tidak ada proses berjalan (bukan error). '
    'Hanya return status aktif: PENDING/DELETING/DELETED/GENERATING. '
    'DONE/FAILED tidak dikembalikan — job tersebut sudah terminal.';
