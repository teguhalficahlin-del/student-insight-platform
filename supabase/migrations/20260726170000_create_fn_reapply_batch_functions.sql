-- =============================================================================
-- Migration: 20260726170000_create_fn_reapply_batch_functions.sql
-- Tujuan   : RPC FASE 1 (fn_prepare_reapply_job) dan FASE 2 (fn_reapply_batch)
--            untuk orchestrate "Terapkan Ulang" berbasis batch.
--
-- Bergantung pada: 20260726160000_create_schedule_reapply_jobs.sql
-- JANGAN deploy migration ini terpisah — deploy bersama seluruh rangkaian
-- (skema + RPC + edge function + UI) sekaligus.
--
-- FK investigation (26 Jul 2026):
--   5 tabel referencing teaching_schedules.schedule_id:
--   • attendance          — NOT NULL, ON DELETE RESTRICT
--                           TIDAK perlu ditangani: target dipilih dengan
--                           NOT EXISTS attendance (by design)
--   • observations        — nullable FK, diset NULL sebelum DELETE
--   • teacher_journals    — nullable FK, diset NULL sebelum DELETE
--   • teacher_attendance_log — NOT NULL, DELETE sebelum induk
--   • substitute_schedules   — NOT NULL, DELETE sebelum induk
-- =============================================================================

-- ── Tambah UNIQUE constraint ke schedule_reapply_targets ────────────────────
-- Cegah duplikat schedule_id per job kalau fn_prepare_reapply_job ter-invoke ulang.
-- Dipakai oleh ON CONFLICT DO NOTHING di FASE 1.
ALTER TABLE public.schedule_reapply_targets
    ADD CONSTRAINT ux_reapply_targets_job_schedule UNIQUE (job_id, schedule_id);

-- ── FASE 1: fn_prepare_reapply_job ──────────────────────────────────────────
-- Buat job baru atau return job aktif yang sudah ada.
-- Populate schedule_reapply_targets dari teaching_schedules.
-- school_id TIDAK diterima dari parameter — diambil dari fn_current_school_id()
-- untuk cegah cross-tenant insert.
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
    WHERE  job_id = v_job_id;

    -- Update total_to_delete di job
    UPDATE schedule_reapply_jobs
    SET    total_to_delete = v_total,
           updated_at      = NOW()
    WHERE  job_id = v_job_id;

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

-- ── FASE 2: fn_reapply_batch ─────────────────────────────────────────────────
-- Hapus satu batch (default 500, max 1000) target sessions beserta dependannya.
-- FOR UPDATE SKIP LOCKED: aman untuk concurrent calls dari tab berbeda.
-- Idempotent: kalau dipanggil lagi setelah done=true, return (0, total, true)
-- tanpa mengubah apapun.
CREATE OR REPLACE FUNCTION public.fn_reapply_batch(
    p_job_id     uuid,
    p_batch_size integer DEFAULT 500
)
RETURNS TABLE (
    deleted_this_batch integer,
    total_deleted      integer,
    done               boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_school_id   uuid;
    v_role        role_type;
    v_job         schedule_reapply_jobs%ROWTYPE;
    v_batch_ids   uuid[];
    v_batch_count integer := 0;
    v_new_deleted integer;
    v_is_done     boolean := false;
BEGIN
    -- Guard: hanya ADMINISTRATIVE
    v_school_id := fn_current_school_id();
    v_role      := fn_current_user_role();

    IF v_school_id IS NULL OR v_role IS NULL THEN
        RAISE EXCEPTION 'Sesi tidak valid — silakan login ulang';
    END IF;

    IF v_role <> 'ADMINISTRATIVE'::role_type THEN
        RAISE EXCEPTION 'Hanya akun ADMINISTRATIVE yang dapat menjalankan batch reapply';
    END IF;

    -- Validasi p_batch_size: cegah nilai ekstrem yang bisa menyebabkan timeout
    IF p_batch_size < 1 OR p_batch_size > 1000 THEN
        RAISE EXCEPTION 'p_batch_size harus antara 1 dan 1000 (diterima: %)', p_batch_size;
    END IF;

    -- Ambil dan lock job — verifikasi ownership school_id sekaligus
    SELECT * INTO v_job
    FROM   schedule_reapply_jobs
    WHERE  job_id    = p_job_id
      AND  school_id = v_school_id  -- cross-tenant guard
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Job % tidak ditemukan atau bukan milik sekolah Anda', p_job_id;
    END IF;

    -- Guard: tolak eksplisit kalau job sudah terminal
    IF v_job.status IN ('DONE', 'FAILED') THEN
        RAISE EXCEPTION
            'Job % sudah berstatus % — tidak bisa dijalankan ulang. '
            'Buat job baru via fn_prepare_reapply_job.',
            p_job_id, v_job.status;
    END IF;

    -- Idempotent: kalau sudah DELETED (semua batch selesai), return langsung
    IF v_job.status = 'DELETED' THEN
        RETURN QUERY SELECT 0, v_job.deleted_count, true;
        RETURN;
    END IF;

    -- Ambil batch target yang belum dihapus.
    -- FOR UPDATE SKIP LOCKED: concurrent call untuk job yang sama akan
    -- mengambil subset baris berbeda, bukan baris yang sama dua kali.
    SELECT ARRAY_AGG(t.schedule_id ORDER BY t.target_id)
    INTO   v_batch_ids
    FROM  (
        SELECT target_id, schedule_id
        FROM   schedule_reapply_targets
        WHERE  job_id     = p_job_id
          AND  deleted_at IS NULL
        ORDER BY target_id
        LIMIT  p_batch_size
        FOR UPDATE SKIP LOCKED
    ) t;

    IF v_batch_ids IS NULL OR array_length(v_batch_ids, 1) = 0 THEN
        -- Tidak ada baris lagi — sudah selesai (mungkin concurrent batch
        -- yang lain baru saja menyelesaikan sisanya)
        UPDATE schedule_reapply_jobs
        SET    status     = 'DELETED',
               updated_at = NOW()
        WHERE  job_id = p_job_id
          AND  status  = 'DELETING';

        RETURN QUERY
            SELECT 0, v_job.deleted_count, true;
        RETURN;
    END IF;

    v_batch_count := array_length(v_batch_ids, 1);

    -- Set status DELETING kalau masih PENDING
    UPDATE schedule_reapply_jobs
    SET    status     = 'DELETING',
           updated_at = NOW()
    WHERE  job_id = p_job_id
      AND  status  = 'PENDING';

    -- ── Urutan DELETE (sama dengan fn_reapply_schedule_templates lama) ────
    -- 1. Nullable FK: set NULL dulu (jaga data observasi dan jurnal guru)
    UPDATE observations
    SET    schedule_id = NULL
    WHERE  schedule_id = ANY(v_batch_ids);

    UPDATE teacher_journals
    SET    schedule_id = NULL
    WHERE  schedule_id = ANY(v_batch_ids);

    -- 2. NOT NULL FK: hapus child records sebelum induk
    DELETE FROM teacher_attendance_log
    WHERE  schedule_id = ANY(v_batch_ids);

    DELETE FROM substitute_schedules
    WHERE  schedule_id = ANY(v_batch_ids);

    -- 3. Hapus sesi (attendance terlindungi oleh RESTRICT + filter FASE 1)
    DELETE FROM teaching_schedules
    WHERE  schedule_id = ANY(v_batch_ids);

    -- ── Mark targets batch ini sebagai done ──────────────────────────────
    UPDATE schedule_reapply_targets
    SET    deleted_at = NOW()
    WHERE  job_id      = p_job_id
      AND  schedule_id = ANY(v_batch_ids);

    -- ── Update progress di job ────────────────────────────────────────────
    UPDATE schedule_reapply_jobs
    SET    deleted_count = deleted_count + v_batch_count,
           updated_at    = NOW()
    WHERE  job_id = p_job_id
    RETURNING deleted_count INTO v_new_deleted;

    -- Cek apakah sudah tidak ada target tersisa
    IF NOT EXISTS (
        SELECT 1 FROM schedule_reapply_targets
        WHERE  job_id     = p_job_id
          AND  deleted_at IS NULL
    ) THEN
        UPDATE schedule_reapply_jobs
        SET    status     = 'DELETED',
               updated_at = NOW()
        WHERE  job_id = p_job_id;

        v_is_done := true;
    END IF;

    RETURN QUERY SELECT v_batch_count, v_new_deleted, v_is_done;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_reapply_batch(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_reapply_batch(uuid, integer) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_reapply_batch(uuid, integer) TO authenticated;

COMMENT ON FUNCTION public.fn_reapply_batch IS
    'FASE 2 batch reapply: hapus satu batch (1–1000 baris) dari targets job. '
    'FOR UPDATE SKIP LOCKED: aman untuk concurrent calls. '
    'Return done=true kalau semua targets sudah dihapus (status job → DELETED). '
    'Idempotent untuk status DELETED — error eksplisit untuk DONE/FAILED.';
