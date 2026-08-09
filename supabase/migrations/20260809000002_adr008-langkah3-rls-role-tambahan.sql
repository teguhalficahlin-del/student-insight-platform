-- ADR-008 Langkah 3 — RLS role tambahan di 4 tabel baru
-- Migration murni additive: tidak DROP apapun, tidak menyentuh tabel lama.
-- Menambah 14 policy SELECT untuk ORTU, WALI_KELAS, KAPRODI, KEPSEK, WAKA_KURIKULUM
-- di: assessments, student_grades, assessment_rubric_criteria, assessment_rubric_results
--
-- Catatan idempotency: CREATE POLICY tidak mendukung IF NOT EXISTS.
-- Migration ini hanya boleh dijalankan sekali (behaviour normal Supabase migrations).
-- Jika perlu re-run: DROP POLICY ... ON ... terlebih dahulu secara manual.

-- ============================================================
-- assessments — 4 policy baru
-- ============================================================

-- ORTU: assessment published dari kelas tempat anaknya terdaftar
CREATE POLICY rls_assessments_select_ortu ON assessments
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND is_published = TRUE
        AND fn_current_user_role() = 'ORTU'::role_type
        AND EXISTS (
            SELECT 1
            FROM student_parents sp
            JOIN class_enrollments ce ON ce.student_id = sp.student_id
            WHERE sp.parent_user_id = fn_current_user_id()
              AND sp.school_id      = fn_current_school_id()
              AND ce.class_id       = assessments.class_id
              AND ce.withdrawn_at  IS NULL
        )
    );

-- WALI_KELAS: assessment published dari kelas yang diwali
CREATE POLICY rls_assessments_select_wali ON assessments
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND is_published = TRUE
        AND fn_current_user_role() = 'WALI_KELAS'::role_type
        AND fn_wali_kelas_class_id() IS NOT NULL
        AND class_id = fn_wali_kelas_class_id()
    );

-- KAPRODI: assessment published dari kelas yang mengandung siswa di program mereka
CREATE POLICY rls_assessments_select_kaprodi ON assessments
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND is_published = TRUE
        AND fn_current_user_role() = 'KAPRODI'::role_type
        AND fn_kaprodi_program_id() IS NOT NULL
        AND EXISTS (
            SELECT 1
            FROM students s
            JOIN class_enrollments ce ON ce.student_id = s.student_id
            WHERE ce.class_id      = assessments.class_id
              AND s.program_id     = fn_kaprodi_program_id()
              AND ce.withdrawn_at IS NULL
        )
    );

-- KEPSEK + WAKA_KURIKULUM: monitoring penuh, tanpa filter is_published
CREATE POLICY rls_assessments_select_kepsek_waka ON assessments
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY(
            ARRAY['KEPSEK', 'WAKA_KURIKULUM']::role_type[]
        )
    );

-- ============================================================
-- student_grades — 4 policy baru
-- (tidak ada class_id; trace kelas via class_enrollments)
-- ============================================================

-- ORTU: nilai published milik anaknya
CREATE POLICY rls_student_grades_select_ortu ON student_grades
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND is_published = TRUE
        AND fn_current_user_role() = 'ORTU'::role_type
        AND EXISTS (
            SELECT 1
            FROM student_parents sp
            WHERE sp.parent_user_id = fn_current_user_id()
              AND sp.student_id     = student_grades.student_id
              AND sp.school_id      = fn_current_school_id()
        )
    );

-- WALI_KELAS: nilai published siswa di kelas yang diwali
CREATE POLICY rls_student_grades_select_wali ON student_grades
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND is_published = TRUE
        AND fn_current_user_role() = 'WALI_KELAS'::role_type
        AND fn_wali_kelas_class_id() IS NOT NULL
        AND EXISTS (
            SELECT 1
            FROM class_enrollments ce
            WHERE ce.student_id    = student_grades.student_id
              AND ce.class_id      = fn_wali_kelas_class_id()
              AND ce.withdrawn_at IS NULL
        )
    );

-- KAPRODI: nilai published siswa di program mereka
CREATE POLICY rls_student_grades_select_kaprodi ON student_grades
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND is_published = TRUE
        AND fn_current_user_role() = 'KAPRODI'::role_type
        AND fn_kaprodi_program_id() IS NOT NULL
        AND EXISTS (
            SELECT 1
            FROM students s
            WHERE s.student_id = student_grades.student_id
              AND s.program_id = fn_kaprodi_program_id()
        )
    );

-- KEPSEK + WAKA_KURIKULUM: monitoring penuh, tanpa filter is_published
CREATE POLICY rls_student_grades_select_kepsek_waka ON student_grades
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY(
            ARRAY['KEPSEK', 'WAKA_KURIKULUM']::role_type[]
        )
    );

-- ============================================================
-- assessment_rubric_criteria — 3 policy baru
-- (tidak ada is_published; gate via JOIN ke assessments)
-- ============================================================

-- ORTU: rubrik dari assessment published di kelas tempat anaknya terdaftar
CREATE POLICY rls_rubric_criteria_select_ortu ON assessment_rubric_criteria
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ORTU'::role_type
        AND EXISTS (
            SELECT 1
            FROM assessments a
            JOIN student_parents sp ON (
                sp.parent_user_id = fn_current_user_id()
                AND sp.school_id  = fn_current_school_id()
            )
            JOIN class_enrollments ce ON (
                ce.student_id    = sp.student_id
                AND ce.class_id  = a.class_id
                AND ce.withdrawn_at IS NULL
            )
            WHERE a.id           = assessment_rubric_criteria.assessment_id
              AND a.is_published  = TRUE
        )
    );

-- WALI_KELAS: rubrik dari assessment published di kelas yang diwali
CREATE POLICY rls_rubric_criteria_select_wali ON assessment_rubric_criteria
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'WALI_KELAS'::role_type
        AND fn_wali_kelas_class_id() IS NOT NULL
        AND EXISTS (
            SELECT 1
            FROM assessments a
            WHERE a.id           = assessment_rubric_criteria.assessment_id
              AND a.is_published  = TRUE
              AND a.class_id     = fn_wali_kelas_class_id()
        )
    );

-- KEPSEK + WAKA_KURIKULUM: akses penuh rubrik di sekolah mereka
CREATE POLICY rls_rubric_criteria_select_kepsek_waka ON assessment_rubric_criteria
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY(
            ARRAY['KEPSEK', 'WAKA_KURIKULUM']::role_type[]
        )
    );

-- ============================================================
-- assessment_rubric_results — 3 policy baru
-- (tidak ada is_published; gate via JOIN ke assessments)
-- ============================================================

-- ORTU: hasil rubrik published milik anaknya
CREATE POLICY rls_rubric_results_select_ortu ON assessment_rubric_results
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ORTU'::role_type
        AND EXISTS (
            SELECT 1
            FROM student_parents sp
            WHERE sp.parent_user_id = fn_current_user_id()
              AND sp.student_id     = assessment_rubric_results.student_id
              AND sp.school_id      = fn_current_school_id()
        )
        AND EXISTS (
            SELECT 1
            FROM assessments a
            WHERE a.id          = assessment_rubric_results.assessment_id
              AND a.is_published  = TRUE
        )
    );

-- WALI_KELAS: hasil rubrik published siswa di kelas yang diwali
CREATE POLICY rls_rubric_results_select_wali ON assessment_rubric_results
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'WALI_KELAS'::role_type
        AND fn_wali_kelas_class_id() IS NOT NULL
        AND EXISTS (
            SELECT 1
            FROM assessments a
            WHERE a.id          = assessment_rubric_results.assessment_id
              AND a.is_published  = TRUE
              AND a.class_id     = fn_wali_kelas_class_id()
        )
    );

-- KEPSEK + WAKA_KURIKULUM: akses penuh hasil rubrik di sekolah mereka
CREATE POLICY rls_rubric_results_select_kepsek_waka ON assessment_rubric_results
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY(
            ARRAY['KEPSEK', 'WAKA_KURIKULUM']::role_type[]
        )
    );
