-- Fix: fn_kepsek_approve_doc INSERT column mismatch
-- Bug: INSERT pakai kepsek_user_id/action, tapi tabel pakai approved_by/status
-- dengan CHECK ('APPROVED','REJECTED'), bukan ('APPROVE','REJECT')

CREATE OR REPLACE FUNCTION public.fn_kepsek_approve_doc(
    p_doc_id  UUID,
    p_action  VARCHAR(10),   -- 'APPROVE' atau 'REJECT'
    p_catatan TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, core
AS $$
DECLARE
    v_school_id UUID;
    v_new_status VARCHAR(30);
    v_approval_status VARCHAR(20);
BEGIN
    IF NOT fn_is_kepsek() THEN
        RAISE EXCEPTION 'Akses ditolak: hanya Kepala Sekolah yang dapat menyetujui dokumen';
    END IF;

    IF p_action NOT IN ('APPROVE', 'REJECT') THEN
        RAISE EXCEPTION 'Aksi tidak valid: gunakan APPROVE atau REJECT';
    END IF;

    SELECT school_id INTO v_school_id
    FROM public.teacher_documents
    WHERE doc_id = p_doc_id
      AND status = 'MENUNGGU_KEPSEK'
      AND school_id = fn_current_school_id();

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Dokumen tidak ditemukan atau sudah diproses';
    END IF;

    v_new_status := CASE p_action
        WHEN 'APPROVE' THEN 'DISAHKAN_KEPSEK'
        WHEN 'REJECT'  THEN 'DIREVIEW_GURU'
    END;

    -- nilai untuk kolom status di teacher_document_approvals
    v_approval_status := CASE p_action
        WHEN 'APPROVE' THEN 'APPROVED'
        WHEN 'REJECT'  THEN 'REJECTED'
    END;

    UPDATE public.teacher_documents
    SET status     = v_new_status,
        updated_at = now()
    WHERE doc_id = p_doc_id;

    INSERT INTO public.teacher_document_approvals (
        doc_id, school_id, approved_by, status, catatan
    )
    VALUES (
        p_doc_id,
        v_school_id,
        auth.uid(),
        v_approval_status,
        p_catatan
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_kepsek_approve_doc(UUID, VARCHAR, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_kepsek_approve_doc(UUID, VARCHAR, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_kepsek_approve_doc(UUID, VARCHAR, TEXT) TO authenticated;
