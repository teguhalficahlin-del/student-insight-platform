-- Security sprint: individual-level isolation for assessments, grades,
-- assessment criteria/rubrics, parent relationships, and PKL data.
-- No table schema or application code changes.

BEGIN;

-- Helpers keep cross-table relationship checks out of RLS USING clauses.
CREATE OR REPLACE FUNCTION public.fn_is_parent_of_student(p_student_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.student_parents sp
        WHERE sp.student_id = p_student_id
          AND sp.parent_user_id = public.fn_current_user_id()
          AND sp.school_id = public.fn_current_school_id()
    );
$$;

GRANT EXECUTE ON FUNCTION public.fn_is_parent_of_student(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_is_parent_of_student(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_is_parent_of_student(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.fn_student_enrolled_in_class(p_class_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.class_enrollments ce
        WHERE ce.class_id = p_class_id
          AND ce.student_id = public.fn_current_student_id()
          AND ce.school_id = public.fn_current_school_id()
          AND ce.withdrawn_at IS NULL
    );
$$;

GRANT EXECUTE ON FUNCTION public.fn_student_enrolled_in_class(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_student_enrolled_in_class(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_student_enrolled_in_class(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.fn_parent_has_child_in_class(p_class_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.student_parents sp
        JOIN public.class_enrollments ce
          ON ce.student_id = sp.student_id
         AND ce.school_id = sp.school_id
        WHERE sp.parent_user_id = public.fn_current_user_id()
          AND sp.school_id = public.fn_current_school_id()
          AND ce.class_id = p_class_id
          AND ce.withdrawn_at IS NULL
    );
$$;

GRANT EXECUTE ON FUNCTION public.fn_parent_has_child_in_class(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_parent_has_child_in_class(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_parent_has_child_in_class(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.fn_guru_supervises_pkl_student(p_student_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.pkl_placements pp
        WHERE pp.student_id = p_student_id
          AND pp.school_id = public.fn_current_school_id()
          AND pp.guru_pembimbing_user_id = public.fn_current_user_id()
    );
$$;

GRANT EXECUTE ON FUNCTION public.fn_guru_supervises_pkl_student(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_guru_supervises_pkl_student(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_guru_supervises_pkl_student(uuid) FROM PUBLIC;

-- FIX 1: assessments
DROP POLICY IF EXISTS assessments_school_read ON public.assessments;

DROP POLICY IF EXISTS rls_assessments_select_guru ON public.assessments;
CREATE POLICY rls_assessments_select_guru ON public.assessments
    FOR SELECT TO authenticated
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'GURU'::role_type
        AND teacher_id = fn_current_user_id()
    );

DROP POLICY IF EXISTS rls_assessments_select_siswa ON public.assessments;
CREATE POLICY rls_assessments_select_siswa ON public.assessments
    FOR SELECT TO authenticated
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'SISWA'::role_type
        AND is_visible_siswa = true
        AND fn_student_enrolled_in_class(class_id)
    );

DROP POLICY IF EXISTS rls_assessments_select_ortu ON public.assessments;
CREATE POLICY rls_assessments_select_ortu ON public.assessments
    FOR SELECT TO authenticated
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ORTU'::role_type
        AND is_visible_ortu = true
        AND fn_parent_has_child_in_class(class_id)
    );

DROP POLICY IF EXISTS rls_assessments_select_wali ON public.assessments;
CREATE POLICY rls_assessments_select_wali ON public.assessments
    FOR SELECT TO authenticated
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'WALI_KELAS'::role_type
        AND class_id = fn_wali_kelas_class_id()
    );

DROP POLICY IF EXISTS rls_assessments_select_kaprodi ON public.assessments;
DROP POLICY IF EXISTS rls_assessments_select_kepsek_waka ON public.assessments;
DROP POLICY IF EXISTS rls_assessments_select_supervision ON public.assessments;
CREATE POLICY rls_assessments_select_supervision ON public.assessments
    FOR SELECT TO authenticated
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY[
            'KAPRODI'::role_type,
            'KEPSEK'::role_type,
            'WAKA_KURIKULUM'::role_type,
            'WAKA_HUMAS'::role_type,
            'WAKA_KESISWAAN'::role_type
        ])
    );

-- FIX 2: grade_recap
DROP POLICY IF EXISTS grade_recap_school_read ON public.grade_recap;

DROP POLICY IF EXISTS rls_grade_recap_select_guru ON public.grade_recap;
CREATE POLICY rls_grade_recap_select_guru ON public.grade_recap
    FOR SELECT TO authenticated
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'GURU'::role_type
        AND fn_owns_learning_objective(learning_objective_id)
    );

DROP POLICY IF EXISTS rls_grade_recap_select_siswa ON public.grade_recap;
CREATE POLICY rls_grade_recap_select_siswa ON public.grade_recap
    FOR SELECT TO authenticated
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'SISWA'::role_type
        AND student_id = fn_current_student_id()
    );

DROP POLICY IF EXISTS rls_grade_recap_select_ortu ON public.grade_recap;
CREATE POLICY rls_grade_recap_select_ortu ON public.grade_recap
    FOR SELECT TO authenticated
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ORTU'::role_type
        AND fn_is_parent_of_student(student_id)
    );

DROP POLICY IF EXISTS rls_grade_recap_select_wali ON public.grade_recap;
CREATE POLICY rls_grade_recap_select_wali ON public.grade_recap
    FOR SELECT TO authenticated
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'WALI_KELAS'::role_type
        AND fn_wali_of_student(student_id)
    );

DROP POLICY IF EXISTS rls_grade_recap_select_supervision ON public.grade_recap;
CREATE POLICY rls_grade_recap_select_supervision ON public.grade_recap
    FOR SELECT TO authenticated
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY[
            'KAPRODI'::role_type,
            'KEPSEK'::role_type,
            'WAKA_KURIKULUM'::role_type,
            'WAKA_HUMAS'::role_type,
            'WAKA_KESISWAAN'::role_type
        ])
    );

-- FIX 3: assessment_results
DROP POLICY IF EXISTS rls_assessment_results_select_staf ON public.assessment_results;

DROP POLICY IF EXISTS rls_assessment_results_select_guru ON public.assessment_results;
CREATE POLICY rls_assessment_results_select_guru ON public.assessment_results
    FOR SELECT TO authenticated
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'GURU'::role_type
        AND fn_owns_assessment(assessment_id)
    );

DROP POLICY IF EXISTS rls_assessment_results_select_siswa ON public.assessment_results;
CREATE POLICY rls_assessment_results_select_siswa ON public.assessment_results
    FOR SELECT TO authenticated
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'SISWA'::role_type
        AND student_id = fn_current_student_id()
    );

DROP POLICY IF EXISTS rls_assessment_results_select_ortu ON public.assessment_results;
CREATE POLICY rls_assessment_results_select_ortu ON public.assessment_results
    FOR SELECT TO authenticated
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ORTU'::role_type
        AND fn_is_parent_of_student(student_id)
    );

DROP POLICY IF EXISTS rls_assessment_results_select_wali ON public.assessment_results;
CREATE POLICY rls_assessment_results_select_wali ON public.assessment_results
    FOR SELECT TO authenticated
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'WALI_KELAS'::role_type
        AND fn_wali_of_student(student_id)
    );

DROP POLICY IF EXISTS rls_assessment_results_select_supervision ON public.assessment_results;
CREATE POLICY rls_assessment_results_select_supervision ON public.assessment_results
    FOR SELECT TO authenticated
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY[
            'KAPRODI'::role_type,
            'KEPSEK'::role_type,
            'WAKA_KURIKULUM'::role_type,
            'WAKA_HUMAS'::role_type,
            'WAKA_KESISWAAN'::role_type
        ])
    );

-- FIX 4: assessment_criteria
DROP POLICY IF EXISTS rls_ac_select ON public.assessment_criteria;
DROP POLICY IF EXISTS rls_ac_select_guru ON public.assessment_criteria;
CREATE POLICY rls_ac_select_guru ON public.assessment_criteria
    FOR SELECT TO authenticated
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'GURU'::role_type
        AND fn_owns_learning_objective(learning_objective_id)
    );

-- FIX 5: assessment rubric criteria/results
DROP POLICY IF EXISTS rls_rubric_criteria_select_ortu ON public.assessment_rubric_criteria;
DROP POLICY IF EXISTS rls_rubric_criteria_select_wali ON public.assessment_rubric_criteria;
DROP POLICY IF EXISTS rls_rubric_criteria_select_guru ON public.assessment_rubric_criteria;
CREATE POLICY rls_rubric_criteria_select_guru ON public.assessment_rubric_criteria
    FOR SELECT TO authenticated
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'GURU'::role_type
        AND teacher_id = fn_current_user_id()
    );

DROP POLICY IF EXISTS rls_rubric_criteria_select_kepsek_waka ON public.assessment_rubric_criteria;
CREATE POLICY rls_rubric_criteria_select_kepsek_waka ON public.assessment_rubric_criteria
    FOR SELECT TO authenticated
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY[
            'KEPSEK'::role_type,
            'WAKA_KURIKULUM'::role_type,
            'WAKA_HUMAS'::role_type,
            'WAKA_KESISWAAN'::role_type
        ])
    );

DROP POLICY IF EXISTS rls_rubric_results_select_ortu ON public.assessment_rubric_results;
DROP POLICY IF EXISTS rls_rubric_results_select_wali ON public.assessment_rubric_results;
DROP POLICY IF EXISTS rls_rubric_results_select_guru ON public.assessment_rubric_results;
CREATE POLICY rls_rubric_results_select_guru ON public.assessment_rubric_results
    FOR SELECT TO authenticated
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'GURU'::role_type
        AND teacher_id = fn_current_user_id()
    );

DROP POLICY IF EXISTS rls_rubric_results_select_kepsek_waka ON public.assessment_rubric_results;
CREATE POLICY rls_rubric_results_select_kepsek_waka ON public.assessment_rubric_results
    FOR SELECT TO authenticated
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY[
            'KEPSEK'::role_type,
            'WAKA_KURIKULUM'::role_type,
            'WAKA_HUMAS'::role_type,
            'WAKA_KESISWAAN'::role_type
        ])
    );

-- FIX 6: remove direct staff read. The ORTU-own and administrative policies
-- remain because the parent portal still selects this relation directly.
DROP POLICY IF EXISTS rls_student_parents_read_staff ON public.student_parents;

-- FIX 7: PKL attendance and placements
DROP POLICY IF EXISTS rls_pkl_attendance_read_staff ON public.pkl_attendance;

DROP POLICY IF EXISTS rls_pkl_attendance_read_guru ON public.pkl_attendance;
CREATE POLICY rls_pkl_attendance_read_guru ON public.pkl_attendance
    FOR SELECT TO authenticated
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'GURU'::role_type
        AND fn_guru_supervises_pkl_student(student_id)
    );

DROP POLICY IF EXISTS rls_pkl_attendance_read_waka_humas ON public.pkl_attendance;
CREATE POLICY rls_pkl_attendance_read_waka_humas ON public.pkl_attendance
    FOR SELECT TO authenticated
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'WAKA_HUMAS'::role_type
    );

DROP POLICY IF EXISTS rls_pkl_attendance_read_kaprodi ON public.pkl_attendance;
CREATE POLICY rls_pkl_attendance_read_kaprodi ON public.pkl_attendance
    FOR SELECT TO authenticated
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'KAPRODI'::role_type
        AND fn_kaprodi_of_student(student_id)
    );

DROP POLICY IF EXISTS rls_pkl_attendance_read_kepsek ON public.pkl_attendance;
CREATE POLICY rls_pkl_attendance_read_kepsek ON public.pkl_attendance
    FOR SELECT TO authenticated
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'KEPSEK'::role_type
    );

DROP POLICY IF EXISTS rls_pkl_read_staff ON public.pkl_placements;

DROP POLICY IF EXISTS rls_pkl_read_guru ON public.pkl_placements;
CREATE POLICY rls_pkl_read_guru ON public.pkl_placements
    FOR SELECT TO authenticated
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'GURU'::role_type
        AND guru_pembimbing_user_id = fn_current_user_id()
    );

DROP POLICY IF EXISTS rls_pkl_read_waka_humas ON public.pkl_placements;
CREATE POLICY rls_pkl_read_waka_humas ON public.pkl_placements
    FOR SELECT TO authenticated
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'WAKA_HUMAS'::role_type
    );

DROP POLICY IF EXISTS rls_pkl_read_kaprodi ON public.pkl_placements;
CREATE POLICY rls_pkl_read_kaprodi ON public.pkl_placements
    FOR SELECT TO authenticated
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'KAPRODI'::role_type
        AND fn_kaprodi_of_student(student_id)
    );

DROP POLICY IF EXISTS rls_pkl_read_kepsek ON public.pkl_placements;
CREATE POLICY rls_pkl_read_kepsek ON public.pkl_placements
    FOR SELECT TO authenticated
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'KEPSEK'::role_type
    );

COMMIT;
