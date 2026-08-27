-- F-03/F-04: close tenant gaps in the named RLS policies and name-sync triggers.
-- Idempotent: functions are replaced and policies are dropped/recreated by exact name.

-- F-03 classification (audited from pg_policies on 2026-08-27):
-- GLOBAL: public.communication_categories.rls_comm_cat_read
--   Shared active communication-category reference data; the table has no school_id.
-- GLOBAL: public.ld_program_knowledge_national.national_knowledge_read_all
--   National curriculum knowledge is intentionally shared; the table has no school_id.
-- GLOBAL: public.ld_prompt_templates.prompt_templates_read_authenticated
--   Shared learning-document prompt templates; the table has no school_id.
-- GLOBAL: public.prompt_templates.pt_select
--   Shared authenticated prompt-template catalogue; the table has no school_id.
-- The four GLOBAL policies above are intentionally left unchanged.
--
-- TENANT: public.ld_context_snapshots.snapshot_owner_write (direct school_id)
-- TENANT: public.ld_document_nodes.node_via_document (school via ld_documents)
-- TENANT: public.ld_document_tp_links.tp_link_via_document (school via ld_documents)
-- TENANT: public.ld_document_versions.version_owner (school via ld_documents)
-- TENANT: public.ld_documents.document_owner (direct school_id)
-- TENANT: public.ld_teacher_knowledge.teacher_knowledge_owner (school via users owner)
-- TENANT: public.users.rls_users_read_own (direct school_id)

DROP POLICY IF EXISTS snapshot_owner_write ON public.ld_context_snapshots;
CREATE POLICY snapshot_owner_write
ON public.ld_context_snapshots
FOR ALL
USING (
    created_by = auth.uid()
    AND school_id = public.fn_current_school_id()
)
WITH CHECK (
    created_by = auth.uid()
    AND school_id = public.fn_current_school_id()
);

DROP POLICY IF EXISTS node_via_document ON public.ld_document_nodes;
CREATE POLICY node_via_document
ON public.ld_document_nodes
FOR ALL
USING (
    EXISTS (
        SELECT 1
        FROM public.ld_documents d
        WHERE d.document_id = ld_document_nodes.document_id
          AND d.created_by = auth.uid()
          AND d.school_id = public.fn_current_school_id()
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.ld_documents d
        WHERE d.document_id = ld_document_nodes.document_id
          AND d.created_by = auth.uid()
          AND d.school_id = public.fn_current_school_id()
    )
);

DROP POLICY IF EXISTS tp_link_via_document ON public.ld_document_tp_links;
CREATE POLICY tp_link_via_document
ON public.ld_document_tp_links
FOR ALL
USING (
    EXISTS (
        SELECT 1
        FROM public.ld_documents d
        WHERE d.document_id = ld_document_tp_links.document_id
          AND d.created_by = auth.uid()
          AND d.school_id = public.fn_current_school_id()
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1
        FROM public.ld_documents d
        WHERE d.document_id = ld_document_tp_links.document_id
          AND d.created_by = auth.uid()
          AND d.school_id = public.fn_current_school_id()
    )
);

DROP POLICY IF EXISTS version_owner ON public.ld_document_versions;
CREATE POLICY version_owner
ON public.ld_document_versions
FOR ALL
USING (
    published_by = auth.uid()
    AND EXISTS (
        SELECT 1
        FROM public.ld_documents d
        WHERE d.document_id = ld_document_versions.document_id
          AND d.school_id = public.fn_current_school_id()
    )
)
WITH CHECK (
    published_by = auth.uid()
    AND EXISTS (
        SELECT 1
        FROM public.ld_documents d
        WHERE d.document_id = ld_document_versions.document_id
          AND d.school_id = public.fn_current_school_id()
    )
);

DROP POLICY IF EXISTS document_owner ON public.ld_documents;
CREATE POLICY document_owner
ON public.ld_documents
FOR ALL
USING (
    created_by = auth.uid()
    AND school_id = public.fn_current_school_id()
)
WITH CHECK (
    created_by = auth.uid()
    AND school_id = public.fn_current_school_id()
);

DROP POLICY IF EXISTS teacher_knowledge_owner ON public.ld_teacher_knowledge;
CREATE POLICY teacher_knowledge_owner
ON public.ld_teacher_knowledge
FOR ALL
USING (
    teacher_id = auth.uid()
    AND EXISTS (
        SELECT 1
        FROM public.users owner_user
        WHERE owner_user.user_id = ld_teacher_knowledge.teacher_id
          AND owner_user.school_id = public.fn_current_school_id()
    )
)
WITH CHECK (
    teacher_id = auth.uid()
    AND EXISTS (
        SELECT 1
        FROM public.users owner_user
        WHERE owner_user.user_id = ld_teacher_knowledge.teacher_id
          AND owner_user.school_id = public.fn_current_school_id()
    )
);

DROP POLICY IF EXISTS rls_users_read_own ON public.users;
CREATE POLICY rls_users_read_own
ON public.users
FOR SELECT
USING (
    auth_user_id = auth.uid()
    AND school_id = public.fn_current_school_id()
);

-- F-04: validate the linked target tenant before propagating a name change.
CREATE OR REPLACE FUNCTION public.trg_sync_student_name_to_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_target_school_id uuid;
BEGIN
    IF NEW.full_name IS DISTINCT FROM OLD.full_name
       AND NEW.user_id IS NOT NULL THEN
        SELECT u.school_id
        INTO v_target_school_id
        FROM public.users u
        WHERE u.user_id = NEW.user_id;

        -- A missing target produces no UPDATE; the students.user_id FK normally
        -- makes this branch unreachable, but retaining the no-op is retry-safe.
        IF NOT FOUND THEN
            RETURN NEW;
        END IF;

        IF v_target_school_id IS DISTINCT FROM NEW.school_id THEN
            RAISE EXCEPTION
                'student_name_sync_tenant_mismatch: student % school_id % does not match user % school_id %',
                NEW.student_id, NEW.school_id, NEW.user_id, v_target_school_id
                USING ERRCODE = 'P0001';
        END IF;

        UPDATE public.users
        SET full_name = NEW.full_name,
            updated_at = NOW()
        WHERE user_id = NEW.user_id
          AND school_id = NEW.school_id
          AND full_name IS DISTINCT FROM NEW.full_name;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_sync_user_name_to_student()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_target_school_id uuid;
BEGIN
    IF NEW.full_name IS DISTINCT FROM OLD.full_name THEN
        SELECT s.school_id
        INTO v_target_school_id
        FROM public.students s
        WHERE s.user_id = NEW.user_id;

        -- Most users are not students, so an absent target is an intentional no-op.
        IF NOT FOUND THEN
            RETURN NEW;
        END IF;

        IF v_target_school_id IS DISTINCT FROM NEW.school_id THEN
            RAISE EXCEPTION
                'user_name_sync_tenant_mismatch: user % school_id % does not match student target school_id %',
                NEW.user_id, NEW.school_id, v_target_school_id
                USING ERRCODE = 'P0001';
        END IF;

        UPDATE public.students
        SET full_name = NEW.full_name,
            updated_at = NOW()
        WHERE user_id = NEW.user_id
          AND school_id = NEW.school_id
          AND full_name IS DISTINCT FROM NEW.full_name;
    END IF;
    RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.trg_sync_student_name_to_user() IS
    'F-04: sync students.full_name to users only after enforcing equal school_id.';

COMMENT ON FUNCTION public.trg_sync_user_name_to_student() IS
    'F-04: sync users.full_name to students only after enforcing equal school_id.';
