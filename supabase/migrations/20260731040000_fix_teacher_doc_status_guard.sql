-- Fix: tambah BEFORE UPDATE trigger yang mem-whitelist transisi status
-- teacher_documents untuk role 'authenticated' (direct client call).
--
-- Masalah: RLS td_update hanya punya USING clause — tidak ada WITH CHECK yang
-- membatasi nilai status yang boleh ditulis. Guru bisa set status = 'DISAHKAN_WAKA'
-- langsung via DevTools, membypass seluruh alur approval Waka Kurikulum.
--
-- Solusi: BEFORE UPDATE trigger (bukan SECURITY DEFINER) pada teacher_documents.
--   - current_user = 'authenticated' (direct client): whitelist 3 transisi guru
--   - current_user = 'postgres' / 'service_role': bypass
--     (fn_waka_approve_doc adalah SECURITY DEFINER milik postgres — UPDATE-nya
--      melalui bypass ini, sehingga alur approval Waka tetap berjalan normal)
--   - current_user = 'anon': tidak bisa masuk (RLS td_update memblokir anon)
--
-- Transisi yang valid untuk authenticated (guru):
--   AI_DRAFT      → DIREVIEW_GURU  (Tandai Sudah Direview)
--   DIREVIEW_GURU → AI_DRAFT       (Simpan sebagai Draft)
--   DIREVIEW_GURU → MENUNGGU_WAKA  (Ajukan ke Waka Kurikulum)
--
-- Semua transisi lain dari 'authenticated' diblokir:
--   * → DISAHKAN_WAKA   hanya boleh via fn_waka_approve_doc
--   MENUNGGU_WAKA → *  hanya boleh via fn_waka_approve_doc
--   DISAHKAN_WAKA → *  tidak ada transisi yang diizinkan

BEGIN;

-- ─── 1. Fungsi trigger ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_guard_teacher_doc_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
-- SENGAJA tidak SECURITY DEFINER: current_user harus mencerminkan context
-- asli pemanggil, bukan pemilik fungsi.
AS $$
BEGIN
    -- Bypass untuk postgres, service_role, dan semua context non-authenticated
    -- (termasuk SECURITY DEFINER functions seperti fn_waka_approve_doc yang
    --  jalan sebagai postgres, dan edge function via service_role).
    IF current_user NOT IN ('authenticated', 'anon') THEN
        RETURN NEW;
    END IF;

    -- Whitelist transisi status yang valid untuk role 'authenticated'.
    -- Jika status tidak berubah (update field lain saja), WHEN clause di
    -- CREATE TRIGGER sudah menjamin trigger tidak terpanggil.
    IF (OLD.status = 'AI_DRAFT'      AND NEW.status = 'DIREVIEW_GURU')  OR
       (OLD.status = 'DIREVIEW_GURU' AND NEW.status = 'AI_DRAFT')       OR
       (OLD.status = 'DIREVIEW_GURU' AND NEW.status = 'MENUNGGU_WAKA')  THEN
        RETURN NEW;
    END IF;

    -- Semua transisi lain diblokir
    RAISE EXCEPTION 'forbidden_status_transition: % → % tidak diizinkan untuk role ini',
        OLD.status, NEW.status
        USING ERRCODE = 'P0001';
END;
$$;

-- Trigger function bukan SECURITY DEFINER, tapi tetap cabut execute dari
-- public/anon karena tidak ada alasan user memanggil langsung.
REVOKE EXECUTE ON FUNCTION public.fn_guard_teacher_doc_status_transition() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_guard_teacher_doc_status_transition() FROM anon;

-- ─── 2. Pasang trigger ────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_guard_teacher_doc_status ON public.teacher_documents;

CREATE TRIGGER trg_guard_teacher_doc_status
    BEFORE UPDATE OF status ON public.teacher_documents
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION public.fn_guard_teacher_doc_status_transition();

COMMIT;
