-- Fix td_select: izinkan Waka Kurikulum baca semua teacher_documents sekolahnya
-- (diperlukan untuk riwayat persetujuan di tab Waka Kurikulum)
DROP POLICY IF EXISTS td_select ON public.teacher_documents;

CREATE POLICY td_select ON public.teacher_documents
  FOR SELECT USING (
    school_id = fn_current_school_id()
    AND (
      teacher_user_id = auth.uid()
      OR fn_is_kepsek()
      OR fn_is_waka_kurikulum()
    )
  );
