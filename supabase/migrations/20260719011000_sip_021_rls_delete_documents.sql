-- SIP-021: RLS DELETE policy untuk teacher_documents dan teacher_document_approvals
-- Guru hanya bisa hapus dokumen milik sendiri yang belum DISAHKAN_WAKA.
-- Idempotent: DO...EXCEPTION

DO $$ BEGIN
  CREATE POLICY "td_delete" ON public.teacher_documents
    FOR DELETE TO authenticated
    USING (
      school_id = public.fn_current_school_id()
      AND teacher_user_id = auth.uid()
      AND status != 'DISAHKAN_WAKA'
    );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE POLICY "tda_delete" ON public.teacher_document_approvals
    FOR DELETE TO authenticated
    USING (
      school_id = public.fn_current_school_id()
      AND doc_id IN (
        SELECT doc_id FROM public.teacher_documents
        WHERE teacher_user_id = auth.uid()
          AND status != 'DISAHKAN_WAKA'
      )
    );
EXCEPTION WHEN duplicate_object THEN null;
END $$;
