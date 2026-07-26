-- =============================================================================
-- Migration: 20260726180000_create_fn_finalize_reapply_job.sql
-- Tujuan   : FASE 3 batch reapply — generate sesi baru dari job yang sudah
--            selesai DELETE. Dipanggil service_role via edge function
--            apply-schedule-templates?mode=finalize.
--
-- Bergantung pada:
--   20260726160000_create_schedule_reapply_jobs.sql     (tabel)
--   20260726170000_create_fn_reapply_batch_functions.sql (FASE 1+2)
--
-- Preseden service_role EXECUTE:
--   fn_apply_schedule_templates juga hanya dipanggil edge function dan
--   memerlukan GRANT EXECUTE TO service_role eksplisit (dikonfirmasi dari
--   migration 20260703190000, baris BAGIAN A). service_role bukan superuser
--   dan tidak bypass privilege check. Kesimpulan yang sama berlaku di sini.
--
-- INVERT (dijawab sebelum apply):
--   1. Double-click: SELECT FOR UPDATE menjamin hanya satu eksekutor yang
--      lewat guard status=DELETED — request kedua tunggu lock, lalu tolak.
--   2. fn_apply_schedule_templates gagal: EXCEPTION WHEN OTHERS menangkap,
--      UPDATE status=FAILED di-commit (RETURN bukan RAISE), caller cek
--      field 'success' di jsonb. Tidak ada RAISE supaya transaksi tidak abort.
--   3. Re-finalize job DONE: status='DONE' <> 'DELETED' → RETURN success:false.
--   4. Crash sebelum RETURN: seluruh transaksi rollback, job kembali DELETED
--      (bukan macet GENERATING) — retry aman.
--
-- ROLLBACK: DROP FUNCTION IF EXISTS public.fn_finalize_reapply_job(uuid);
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_finalize_reapply_job(
    p_job_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_job    schedule_reapply_jobs%ROWTYPE;
    v_result jsonb;
BEGIN
    -- 1. Lock baris job — FOR UPDATE mencegah concurrent finalize untuk job sama.
    --    Request kedua yang tiba bersamaan akan tunggu di sini, lalu lihat
    --    status sudah berubah (GENERATING/DONE/FAILED) dan ditolak oleh guard di bawah.
    SELECT * INTO v_job
    FROM   schedule_reapply_jobs
    WHERE  job_id = p_job_id
    FOR UPDATE;

    -- 2. Job tidak ditemukan
    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', format('Job %s tidak ditemukan', p_job_id)
        );
    END IF;

    -- 3. Guard ketat: HANYA status DELETED yang boleh lanjut.
    --    PENDING/DELETING → batch DELETE belum selesai
    --    GENERATING       → concurrent request sudah masuk duluan
    --    DONE             → sudah selesai, cegah double-finalize
    --    FAILED           → terminal state, butuh intervensi manual
    IF v_job.status <> 'DELETED' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', format(
                'Job %s berstatus %s — finalize hanya bisa dijalankan '
                'setelah semua sesi lama dihapus (status = DELETED)',
                p_job_id, v_job.status
            )
        );
    END IF;

    -- 4. Tandai sedang generate.
    --    Tidak ada commit parsial di sini — UPDATE ini hanya commit kalau
    --    seluruh function selesai normal (RETURN tercapai). Kalau proses mati
    --    sebelum RETURN, seluruh transaksi rollback dan job kembali DELETED.
    UPDATE schedule_reapply_jobs
    SET    status     = 'GENERATING',
           updated_at = NOW()
    WHERE  job_id = p_job_id;

    -- 5. Generate sesi baru dari template — bungkus dalam exception handler.
    --    academic_year, semester, school_id diambil dari baris job (bukan parameter
    --    tambahan) — otorisasi tenant sudah diverifikasi di edge function sebelum
    --    RPC ini dipanggil (job.school_id == user.school_id di TypeScript).
    BEGIN
        SELECT public.fn_apply_schedule_templates(
            v_job.academic_year,
            v_job.semester,
            v_job.school_id
        ) INTO v_result;

        -- Sukses → DONE
        UPDATE schedule_reapply_jobs
        SET    status       = 'DONE',
               completed_at = NOW(),
               updated_at   = NOW()
        WHERE  job_id = p_job_id;

        RETURN jsonb_build_object('success', true, 'result', v_result);

    EXCEPTION WHEN OTHERS THEN
        -- Gagal → FAILED, simpan pesan PostgreSQL asli.
        -- TIDAK RAISE — biarkan transaksi commit dengan status FAILED
        -- supaya UPDATE ini benar-benar persisten di database.
        -- Caller (edge function) WAJIB cek field 'success' di jsonb,
        -- bukan hanya mengandalkan exception dari .rpc() call.
        UPDATE schedule_reapply_jobs
        SET    status        = 'FAILED',
               error_message = SQLERRM,
               updated_at    = NOW()
        WHERE  job_id = p_job_id;

        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
    END;
END;
$$;

-- Standing rule: dua lapis REVOKE (PUBLIC saja tidak cukup — Supabase beri
-- grant eksplisit ke anon yang tidak ikut tercabut oleh REVOKE FROM PUBLIC).
REVOKE EXECUTE ON FUNCTION public.fn_finalize_reapply_job(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_finalize_reapply_job(uuid) FROM anon;

-- Wajib karena service_role bukan superuser dan tidak bypass privilege check
-- (dikonfirmasi dari preseden fn_apply_schedule_templates).
-- TIDAK grant ke `authenticated` — fungsi ini hanya boleh dipanggil lewat
-- edge function (service_role), bukan langsung dari client biasa.
GRANT  EXECUTE ON FUNCTION public.fn_finalize_reapply_job(uuid) TO service_role;

COMMENT ON FUNCTION public.fn_finalize_reapply_job IS
    'FASE 3 batch reapply: generate sesi baru dari job yang sudah selesai DELETE. '
    'Hanya bisa dijalankan jika status job = DELETED. '
    'FOR UPDATE cegah concurrent double-generate untuk job_id yang sama. '
    'Return jsonb {success, result|error} — tidak pernah RAISE supaya UPDATE '
    'status=FAILED benar-benar commit. Caller wajib cek field success. '
    'Dipanggil service_role via edge function apply-schedule-templates?mode=finalize.';
