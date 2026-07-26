-- =============================================================================
-- Migration: 20260726200000_fix_fn_prepare_reapply_job_ambiguous_column.sql
-- Tujuan   : Fix PostgreSQL 42702 "column reference job_id is ambiguous"
--            di fn_prepare_reapply_job.
--
-- Root cause: RETURNS TABLE mendeklarasikan kolom `job_id uuid`. Di dalam
-- function body, dua WHERE clause menggunakan bare `job_id` yang ambigu
-- karena PostgreSQL tidak dapat membedakan antara output column RETURNS TABLE
-- dan kolom `job_id` di tabel yang di-query.
--
-- Fix: tambah qualifier tabel eksplisit di 2 WHERE clause yang ambigu:
--   1. schedule_reapply_targets.job_id = v_job_id  (SELECT COUNT)
--   2. schedule_reapply_jobs.job_id    = v_job_id  (UPDATE total_to_delete)
--
-- Investigasi 3 fungsi lain (20260726170000-190000):
--   fn_reapply_batch          : SAFE — RETURNS TABLE tidak deklarasi job_id
--   fn_finalize_reapply_job   : SAFE — RETURNS jsonb (scalar, bukan TABLE)
--   fn_get_active_reapply_job : SAFE — semua body reference pakai alias j.
--
-- Tidak ada perubahan logika, privilege, atau signature.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_prepare_reapply_job(
    p_academic_year text,
    p_semester      semester
)
RETURNS TABLE (
    job_id          uuid,
    total_to_delete integer,
    already_exists  boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_school_id   uuid;
    v_role        role_type;
    v_job_id      uuid;
    v_total       integer;
    v_existed     boolean := false;
BEGIN
    -- Guard: hanya ADMINISTRATIVE
    v_school_id := fn_current_school_id();
    v_role      := fn_current_user_role();

    IF v_school_id IS NULL OR v_role IS NULL THEN
        RAISE EXCEPTION 'Sesi tidak valid — silakan login ulang';
    END IF;

    IF v_role <> 'ADMINISTRATIVE'::role_type THEN
        RAISE EXCEPTION 'Hanya akun ADMINISTRATIVE yang dapat menjalankan Terapkan Ulang';
    END IF;

    -- Coba insert job baru; kalau unique partial index menolak (23505),
    -- ambil job aktif yang sudah ada — jangan raise error ke client.
    BEGIN
        INSERT INTO schedule_reapply_jobs
            (school_id, academic_year, semester, status, created_by)
        VALUES
            (v_school_id, p_academic_year, p_semester, 'PENDING', fn_current_user_id())
        RETURNING schedule_reapply_jobs.job_id INTO v_job_id;

    EXCEPTION WHEN unique_violation THEN
        -- Job aktif sudah ada untuk periode ini — kembalikan yang sudah ada
        SELECT j.job_id INTO v_job_id
        FROM   schedule_reapply_jobs j
        WHERE  j.school_id     = v_school_id
          AND  j.academic_year = p_academic_year
          AND  j.semester      = p_semester
          AND  j.status IN ('PENDING','DELETING','DELETED','GENERATING')
        LIMIT 1;

        v_existed := true;
    END;

    -- Populate targets (idempotent via ON CONFLICT DO NOTHING)
    INSERT INTO schedule_reapply_targets (job_id, school_id, schedule_id)
    SELECT v_job_id, v_school_id, ts.schedule_id
    FROM   teaching_schedules ts
    WHERE  ts.school_id     = v_school_id
      AND  ts.academic_year = p_academic_year
      AND  ts.semester      = p_semester
      AND  ts.session_date  > CURRENT_DATE
      AND  NOT EXISTS (
               SELECT 1 FROM attendance a
               WHERE  a.schedule_id = ts.schedule_id
           )
    ON CONFLICT ON CONSTRAINT ux_reapply_targets_job_schedule
        DO NOTHING;

    -- Hitung total target (termasuk yang sudah deleted_at IS NOT NULL kalau
    -- ini job lama yang sudah sebagian dikerjakan)
    SELECT COUNT(*) INTO v_total
    FROM   schedule_reapply_targets
    WHERE  schedule_reapply_targets.job_id = v_job_id;   -- FIX: qualifier eksplisit

    -- Update total_to_delete di job
    UPDATE schedule_reapply_jobs
    SET    total_to_delete = v_total,
           updated_at      = NOW()
    WHERE  schedule_reapply_jobs.job_id = v_job_id;      -- FIX: qualifier eksplisit

    RETURN QUERY SELECT v_job_id, v_total, v_existed;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_prepare_reapply_job(text, semester) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_prepare_reapply_job(text, semester) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_prepare_reapply_job(text, semester) TO authenticated;

COMMENT ON FUNCTION public.fn_prepare_reapply_job IS
    'FASE 1 batch reapply: buat job + populate targets. Idempotent — kalau job '
    'aktif sudah ada untuk periode ini, return job yang ada (already_exists=true). '
    'school_id diambil dari sesi, bukan parameter.';
