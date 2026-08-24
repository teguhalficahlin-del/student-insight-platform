-- GRU-12: Buat RPC fn_delete_teacher_document untuk menggantikan 3 DELETE sequential
-- di deleteTeacherDocument() client-side (guru/js/api.js).
-- Menjalankan ketiga DELETE dalam satu transaksi PostgreSQL untuk atomicity.
-- Guard: doc harus milik caller (auth.uid()) di sekolah caller (fn_current_school_id()).
-- teacher_document_approvals dan teacher_document_classes di-DELETE dulu
-- sebelum teacher_documents (referential integrity).

DROP FUNCTION IF EXISTS fn_delete_teacher_document(UUID);

CREATE OR REPLACE FUNCTION fn_delete_teacher_document(p_doc_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_school_id UUID;
    v_found     BOOLEAN;
BEGIN
    v_school_id := fn_current_school_id();

    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'school_id tidak terdeteksi untuk user ini'
            USING ERRCODE = '42501';
    END IF;

    -- Verifikasi dokumen ada, milik caller, di sekolah caller
    SELECT EXISTS (
        SELECT 1 FROM teacher_documents
        WHERE doc_id          = p_doc_id
          AND school_id       = v_school_id
          AND teacher_user_id = auth.uid()
    ) INTO v_found;

    IF NOT v_found THEN
        RAISE EXCEPTION 'Dokumen tidak ditemukan atau tidak ada izin untuk menghapus'
            USING ERRCODE = 'P0002';
    END IF;

    -- Hapus approval terlebih dahulu
    DELETE FROM teacher_document_approvals
    WHERE doc_id = p_doc_id;

    -- Hapus class assignments
    DELETE FROM teacher_document_classes
    WHERE doc_id = p_doc_id;

    -- Hapus dokumen utama dengan guard school_id dan teacher_user_id
    DELETE FROM teacher_documents
    WHERE doc_id          = p_doc_id
      AND school_id       = v_school_id
      AND teacher_user_id = auth.uid();
END;
$$;

GRANT  EXECUTE ON FUNCTION fn_delete_teacher_document(UUID) TO authenticated;
GRANT  EXECUTE ON FUNCTION fn_delete_teacher_document(UUID) TO service_role;
REVOKE EXECUTE ON FUNCTION fn_delete_teacher_document(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION fn_delete_teacher_document(UUID) FROM PUBLIC;
