-- SIP Sprint 1 — 009: RLS untuk tabel public baru (Teacher Workspace + AI)
-- Menggunakan fn_current_school_id() (existing helper di project ini) dan is_kepsek().
-- Idempotent: DO...EXCEPTION

-- ================================================
-- Enable RLS
-- ================================================

DO $$ BEGIN ALTER TABLE public.teacher_profiles ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN others THEN null; END $$;
DO $$ BEGIN ALTER TABLE public.teaching_contexts ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN others THEN null; END $$;
DO $$ BEGIN ALTER TABLE public.teacher_documents ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN others THEN null; END $$;
DO $$ BEGIN ALTER TABLE public.teacher_document_classes ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN others THEN null; END $$;
DO $$ BEGIN ALTER TABLE public.teacher_document_approvals ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN others THEN null; END $$;
DO $$ BEGIN ALTER TABLE public.generation_jobs ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN others THEN null; END $$;
DO $$ BEGIN ALTER TABLE public.prompt_templates ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN others THEN null; END $$;
DO $$ BEGIN ALTER TABLE public.evaluation_logs ENABLE ROW LEVEL SECURITY; EXCEPTION WHEN others THEN null; END $$;

-- ================================================
-- teacher_profiles
-- ================================================
DO $$ BEGIN
  CREATE POLICY "tp_select" ON public.teacher_profiles
    FOR SELECT USING (
      school_id = fn_current_school_id() AND teacher_user_id = auth.uid()
    );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE POLICY "tp_insert" ON public.teacher_profiles
    FOR INSERT WITH CHECK (
      school_id = fn_current_school_id() AND teacher_user_id = auth.uid()
    );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE POLICY "tp_update" ON public.teacher_profiles
    FOR UPDATE USING (
      school_id = fn_current_school_id() AND teacher_user_id = auth.uid()
    );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ================================================
-- teaching_contexts
-- ================================================
DO $$ BEGIN
  CREATE POLICY "tc_select" ON public.teaching_contexts
    FOR SELECT USING (
      school_id = fn_current_school_id() AND teacher_user_id = auth.uid()
    );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE POLICY "tc_insert" ON public.teaching_contexts
    FOR INSERT WITH CHECK (
      school_id = fn_current_school_id() AND teacher_user_id = auth.uid()
    );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE POLICY "tc_update" ON public.teaching_contexts
    FOR UPDATE USING (
      school_id = fn_current_school_id() AND teacher_user_id = auth.uid()
    );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ================================================
-- teacher_documents
-- ================================================
DO $$ BEGIN
  CREATE POLICY "td_select" ON public.teacher_documents
    FOR SELECT USING (
      school_id = fn_current_school_id()
      AND (teacher_user_id = auth.uid() OR fn_is_kepsek())
    );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE POLICY "td_insert" ON public.teacher_documents
    FOR INSERT WITH CHECK (
      school_id = fn_current_school_id() AND teacher_user_id = auth.uid()
    );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE POLICY "td_update" ON public.teacher_documents
    FOR UPDATE USING (
      school_id = fn_current_school_id() AND teacher_user_id = auth.uid()
    );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ================================================
-- teacher_document_classes
-- ================================================
DO $$ BEGIN
  CREATE POLICY "tdc_select" ON public.teacher_document_classes
    FOR SELECT USING (school_id = fn_current_school_id());
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE POLICY "tdc_insert" ON public.teacher_document_classes
    FOR INSERT WITH CHECK (school_id = fn_current_school_id());
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE POLICY "tdc_delete" ON public.teacher_document_classes
    FOR DELETE USING (school_id = fn_current_school_id());
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ================================================
-- teacher_document_approvals
-- ================================================
DO $$ BEGIN
  CREATE POLICY "tda_select" ON public.teacher_document_approvals
    FOR SELECT USING (school_id = fn_current_school_id());
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE POLICY "tda_insert" ON public.teacher_document_approvals
    FOR INSERT WITH CHECK (
      school_id = fn_current_school_id() AND fn_is_kepsek()
    );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ================================================
-- generation_jobs
-- ================================================
DO $$ BEGIN
  CREATE POLICY "gj_select" ON public.generation_jobs
    FOR SELECT USING (
      school_id = fn_current_school_id() AND teacher_user_id = auth.uid()
    );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE POLICY "gj_insert" ON public.generation_jobs
    FOR INSERT WITH CHECK (
      school_id = fn_current_school_id() AND teacher_user_id = auth.uid()
    );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE POLICY "gj_update" ON public.generation_jobs
    FOR UPDATE USING (
      school_id = fn_current_school_id() AND teacher_user_id = auth.uid()
    );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ================================================
-- prompt_templates — READ by all authenticated; write = service_role only
-- ================================================
DO $$ BEGIN
  CREATE POLICY "pt_select" ON public.prompt_templates
    FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ================================================
-- evaluation_logs
-- ================================================
DO $$ BEGIN
  CREATE POLICY "el_select" ON public.evaluation_logs
    FOR SELECT USING (school_id = fn_current_school_id());
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE POLICY "el_insert" ON public.evaluation_logs
    FOR INSERT WITH CHECK (school_id = fn_current_school_id());
EXCEPTION WHEN duplicate_object THEN null;
END $$;
