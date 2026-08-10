-- Fix: ganti auth.uid() → fn_current_user_id() di 3 policy assessment_criteria.
-- teacher_id di learning_objectives berisi users.user_id (UUID internal),
-- bukan auth.uid() (UUID Supabase Auth) — keduanya berbeda.

BEGIN;

DROP POLICY IF EXISTS rls_ac_insert ON public.assessment_criteria;
DROP POLICY IF EXISTS rls_ac_update ON public.assessment_criteria;
DROP POLICY IF EXISTS rls_ac_delete ON public.assessment_criteria;

CREATE POLICY rls_ac_insert ON public.assessment_criteria
    FOR INSERT
    WITH CHECK (
        school_id = fn_current_school_id()
        AND learning_objective_id IN (
            SELECT id FROM public.learning_objectives
            WHERE teacher_id = fn_current_user_id()
        )
    );

CREATE POLICY rls_ac_update ON public.assessment_criteria
    FOR UPDATE
    USING (
        school_id = fn_current_school_id()
        AND learning_objective_id IN (
            SELECT id FROM public.learning_objectives
            WHERE teacher_id = fn_current_user_id()
        )
    )
    WITH CHECK (
        school_id = fn_current_school_id()
        AND learning_objective_id IN (
            SELECT id FROM public.learning_objectives
            WHERE teacher_id = fn_current_user_id()
        )
    );

CREATE POLICY rls_ac_delete ON public.assessment_criteria
    FOR DELETE
    USING (
        school_id = fn_current_school_id()
        AND learning_objective_id IN (
            SELECT id FROM public.learning_objectives
            WHERE teacher_id = fn_current_user_id()
        )
    );

COMMIT;
