-- SIP Sprint 2 — 011: RPC fn_kepsek_approve_doc
-- Kepsek tidak bisa langsung UPDATE teacher_documents (RLS td_update hanya izinkan teacher_user_id = auth.uid()).
-- Fungsi ini SECURITY DEFINER agar kepsek bisa setujui/kembalikan dokumen.
-- Sesuai standing rule: REVOKE FROM PUBLIC + REVOKE FROM anon wajib.

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
BEGIN
    -- Hanya kepsek yang boleh memanggil fungsi ini
    IF NOT fn_is_kepsek() THEN
        RAISE EXCEPTION 'Akses ditolak: hanya Kepala Sekolah yang dapat menyetujui dokumen';
    END IF;

    -- Validasi aksi
    IF p_action NOT IN ('APPROVE', 'REJECT') THEN
        RAISE EXCEPTION 'Aksi tidak valid: gunakan APPROVE atau REJECT';
    END IF;

    -- Ambil school_id dokumen dan pastikan masih MENUNGGU_KEPSEK
    SELECT school_id INTO v_school_id
    FROM public.teacher_documents
    WHERE doc_id = p_doc_id
      AND status = 'MENUNGGU_KEPSEK'
      AND school_id = fn_current_school_id();

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Dokumen tidak ditemukan atau sudah diproses';
    END IF;

    -- Tentukan status baru
    v_new_status := CASE p_action
        WHEN 'APPROVE' THEN 'DISAHKAN_KEPSEK'
        WHEN 'REJECT'  THEN 'DIREVIEW_GURU'
    END;

    -- Update status dokumen
    UPDATE public.teacher_documents
    SET status     = v_new_status,
        updated_at = now()
    WHERE doc_id = p_doc_id;

    -- Catat di tabel approval
    INSERT INTO public.teacher_document_approvals (
        doc_id, school_id, kepsek_user_id, action, catatan
    )
    VALUES (
        p_doc_id,
        v_school_id,
        auth.uid(),
        p_action,
        p_catatan
    );
END;
$$;

-- Wajib per standing rule audit (CLAUDE.md §3a + audit-handoff.md Rule 2):
-- REVOKE FROM PUBLIC saja tidak cukup — Supabase beri grant eksplisit ke anon secara terpisah.
REVOKE EXECUTE ON FUNCTION public.fn_kepsek_approve_doc(UUID, VARCHAR, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_kepsek_approve_doc(UUID, VARCHAR, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_kepsek_approve_doc(UUID, VARCHAR, TEXT) TO authenticated;
