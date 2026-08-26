BEGIN;

-- ── T1-07: Defense-in-depth guard student↔school di rls_cc_update ──
--
-- Catatan: student_id sudah immutable via trg_coaching_case_immutable_creator.
-- Guard ini adalah lapisan tambahan yang memastikan WITH CHECK policy
-- juga memvalidasi student_id milik sekolah yang sama.
--
-- GUC app.coaching_sync_active dipertahankan di USING clause karena
-- mekanisme pengganti (token acak, pg_trigger_depth) tidak feasible —
-- LOCAL GUC tidak visible setelah SET LOCAL ROLE authenticated.
-- Accepted risk didokumentasikan di CLAUDE.md.

DROP POLICY IF EXISTS rls_cc_update ON public.coaching_cases;

CREATE POLICY rls_cc_update ON public.coaching_cases
    FOR UPDATE
    TO authenticated
    USING (
        school_id = fn_current_school_id()
        AND current_setting('app.coaching_sync_active', true) = 'true'
    )
    WITH CHECK (
        school_id = fn_current_school_id()
        AND fn_student_in_current_school(student_id)
    );

COMMIT;
