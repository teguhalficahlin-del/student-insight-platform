-- ============================================================
-- Migration: 20260824020000_fix-fn-reapply-batch-pending-to-deleted.sql
--
-- BUG: "Terapkan Ulang" gagal HTTP 500 di sekolah yang belum punya
--      teaching_schedules sama sekali (mis. smkn3 setelah import jadwal baru).
--
-- Rantai sebab:
--   1. fn_prepare_reapply_job membuat job status PENDING, total_to_delete = 0
--      (tidak ada sesi lama untuk dihapus).
--   2. fn_reapply_batch masuk early-return path (v_batch_ids IS NULL) dan
--      mencoba set status DELETED, TAPI predikatnya "AND status = DELETING".
--      Job masih PENDING -> UPDATE match 0 baris -> status tetap PENDING,
--      padahal fungsi mengembalikan done = true.
--      (Baris "SET status = DELETING kalau masih PENDING" ada SETELAH
--       early-return ini, jadi tidak pernah tercapai saat 0 target.)
--   3. JS keluar loop, panggil finalize.
--   4. fn_finalize_reapply_job menolak karena status <> DELETED dan
--      mengembalikan success:false -> edge function membalas HTTP 500.
--
-- FIX: perluas predikat menjadi status IN (PENDING, DELETING) supaya job
--      dengan nol target ikut transisi ke DELETED.
--
-- Idempotent: CREATE OR REPLACE + GRANT/REVOKE yang tidak berubah.
-- Tidak menyentuh data: hanya definisi fungsi.
-- ROLLBACK: jalankan ulang 20260726170000_create_fn_reapply_batch_functions.sql
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_reapply_batch(p_job_id uuid, p_batch_size integer DEFAULT 500)
 RETURNS TABLE(deleted_this_batch integer, total_deleted integer, done boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        RAISE EXCEPTION 'Sesi tidak valid â€” silakan login ulang';
    END IF;

    IF v_role <> 'ADMINISTRATIVE'::role_type THEN
        RAISE EXCEPTION 'Hanya akun ADMINISTRATIVE yang dapat menjalankan batch reapply';
    END IF;

    -- Validasi p_batch_size: cegah nilai ekstrem yang bisa menyebabkan timeout
    IF p_batch_size < 1 OR p_batch_size > 1000 THEN
        RAISE EXCEPTION 'p_batch_size harus antara 1 dan 1000 (diterima: %)', p_batch_size;
    END IF;

    -- Ambil dan lock job â€” verifikasi ownership school_id sekaligus
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
            'Job % sudah berstatus % â€” tidak bisa dijalankan ulang. '
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
        -- Tidak ada baris lagi â€” sudah selesai (mungkin concurrent batch
        -- yang lain baru saja menyelesaikan sisanya)
        UPDATE schedule_reapply_jobs
        SET    status     = 'DELETED',
               updated_at = NOW()
        WHERE  job_id = p_job_id
          AND  status IN ('PENDING', 'DELETING');

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

    -- â”€â”€ Urutan DELETE (sama dengan fn_reapply_schedule_templates lama) â”€â”€â”€â”€
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

    -- â”€â”€ Mark targets batch ini sebagai done â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    UPDATE schedule_reapply_targets
    SET    deleted_at = NOW()
    WHERE  job_id      = p_job_id
      AND  schedule_id = ANY(v_batch_ids);

    -- â”€â”€ Update progress di job â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
$function$;

-- Privilege: tidak berubah dari 20260726170000, ditulis ulang agar migration
-- ini mandiri (CREATE OR REPLACE mempertahankan grant lama, ini defense-in-depth).
REVOKE EXECUTE ON FUNCTION public.fn_reapply_batch(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_reapply_batch(uuid, integer) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_reapply_batch(uuid, integer) TO authenticated;
