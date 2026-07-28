-- RLS dan trigger guard untuk 6 tabel penilaian Kurikulum Merdeka
-- (learning_objectives, learning_objective_classes, assessment_criteria,
--  grading_settings, tp_assessments, grade_summaries)

-- ============================================================
-- SECURITY DEFINER helper functions
-- Dibutuhkan karena policy siswa/ortu/wali perlu mengecek tabel
-- yang di-RLS (grading_settings, grade_summaries, learning_objectives)
-- — subquery mentah ke tabel RLS-protected di USING clause akan
-- dievaluasi dengan visibilitas caller, bukan definer.
-- ============================================================

-- A. Apakah learning_objective dengan id ini milik guru yang login?
CREATE OR REPLACE FUNCTION fn_is_my_lo(p_lo_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM learning_objectives
        WHERE learning_objective_id = p_lo_id
          AND teacher_user_id = fn_current_user_id()
          AND school_id       = fn_current_school_id()
    );
$$;
REVOKE EXECUTE ON FUNCTION fn_is_my_lo(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_is_my_lo(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION fn_is_my_lo(UUID) TO authenticated;

-- B. Apakah learning_objective berasal dari sekolah yang login?
CREATE OR REPLACE FUNCTION fn_lo_in_my_school(p_lo_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM learning_objectives
        WHERE learning_objective_id = p_lo_id
          AND school_id = fn_current_school_id()
    );
$$;
REVOKE EXECUTE ON FUNCTION fn_lo_in_my_school(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_lo_in_my_school(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION fn_lo_in_my_school(UUID) TO authenticated;

-- C. Apakah grading_settings.is_published = TRUE untuk LO+teacher+class ini?
CREATE OR REPLACE FUNCTION fn_grading_is_published(
    p_school_id       UUID,
    p_lo_id           UUID,
    p_teacher_user_id UUID,
    p_class_id        UUID
) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM grading_settings gs
        JOIN learning_objectives lo
          ON lo.learning_objective_id = p_lo_id
        WHERE gs.school_id       = p_school_id
          AND gs.teacher_user_id = p_teacher_user_id
          AND gs.subject_id      = lo.subject_id
          AND gs.class_id        = p_class_id
          AND gs.academic_year   = lo.academic_year
          AND gs.semester        = lo.semester
          AND gs.is_published    = TRUE
    );
$$;
REVOKE EXECUTE ON FUNCTION fn_grading_is_published(UUID,UUID,UUID,UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_grading_is_published(UUID,UUID,UUID,UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION fn_grading_is_published(UUID,UUID,UUID,UUID) TO authenticated;

-- D. Apakah grade_summary untuk SISWA YANG LOGIN sudah published untuk LO ini?
CREATE OR REPLACE FUNCTION fn_grade_published_for_me(
    p_school_id UUID,
    p_lo_id     UUID
) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM grade_summaries gs
        JOIN learning_objectives lo
          ON lo.learning_objective_id = p_lo_id
        WHERE gs.school_id        = p_school_id
          AND gs.subject_id       = lo.subject_id
          AND gs.teacher_user_id  = lo.teacher_user_id
          AND gs.student_id       = (
              SELECT s.student_id FROM students s
              WHERE s.user_id = fn_current_user_id()
              LIMIT 1
          )
          AND gs.published_at IS NOT NULL
    );
$$;
REVOKE EXECUTE ON FUNCTION fn_grade_published_for_me(UUID,UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_grade_published_for_me(UUID,UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION fn_grade_published_for_me(UUID,UUID) TO authenticated;

-- E. Apakah grade_summary untuk SISWA TERTENTU sudah published untuk LO ini?
--    Dipakai oleh policy ortu.
CREATE OR REPLACE FUNCTION fn_grade_published_for_student(
    p_school_id  UUID,
    p_lo_id      UUID,
    p_student_id UUID
) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM grade_summaries gs
        JOIN learning_objectives lo
          ON lo.learning_objective_id = p_lo_id
        WHERE gs.school_id        = p_school_id
          AND gs.subject_id       = lo.subject_id
          AND gs.teacher_user_id  = lo.teacher_user_id
          AND gs.student_id       = p_student_id
          AND gs.published_at IS NOT NULL
    );
$$;
REVOKE EXECUTE ON FUNCTION fn_grade_published_for_student(UUID,UUID,UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_grade_published_for_student(UUID,UUID,UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION fn_grade_published_for_student(UUID,UUID,UUID) TO authenticated;

-- ============================================================
-- Trigger guard: UPDATE tp_assessments hanya boleh void
-- ============================================================

CREATE OR REPLACE FUNCTION fn_guard_tp_assessment_update()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.assessment_id         <> OLD.assessment_id
    OR NEW.school_id             <> OLD.school_id
    OR NEW.learning_objective_id <> OLD.learning_objective_id
    OR NEW.student_id            <> OLD.student_id
    OR NEW.teacher_user_id       <> OLD.teacher_user_id
    OR NEW.class_id              <> OLD.class_id
    OR NEW.tipe                  <> OLD.tipe
    OR (NEW.judul            IS DISTINCT FROM OLD.judul)
    OR (NEW.nilai_angka      IS DISTINCT FROM OLD.nilai_angka)
    OR (NEW.nilai_kualitatif IS DISTINCT FROM OLD.nilai_kualitatif)
    OR NEW.tanggal               <> OLD.tanggal
    OR NEW.created_at            <> OLD.created_at
    THEN
        RAISE EXCEPTION
            'UPDATE tp_assessments: hanya kolom is_void dan void_reason yang boleh diubah';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guard_tp_assessment_update
    BEFORE UPDATE ON tp_assessments
    FOR EACH ROW
    EXECUTE FUNCTION fn_guard_tp_assessment_update();

-- ============================================================
-- ENABLE ROW LEVEL SECURITY — 6 tabel
-- ============================================================

ALTER TABLE learning_objectives        ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_objective_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_criteria        ENABLE ROW LEVEL SECURITY;
ALTER TABLE grading_settings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE tp_assessments             ENABLE ROW LEVEL SECURITY;
ALTER TABLE grade_summaries            ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- learning_objectives
-- ============================================================

CREATE POLICY rls_learning_objectives_insert_guru ON learning_objectives
    FOR INSERT WITH CHECK (
        school_id           = fn_current_school_id()
        AND teacher_user_id = fn_current_user_id()
        AND fn_current_user_role() = 'GURU'::role_type
    );

CREATE POLICY rls_learning_objectives_select_guru ON learning_objectives
    FOR SELECT USING (
        school_id           = fn_current_school_id()
        AND teacher_user_id = fn_current_user_id()
        AND fn_current_user_role() = 'GURU'::role_type
    );

CREATE POLICY rls_learning_objectives_update_guru ON learning_objectives
    FOR UPDATE USING (
        school_id           = fn_current_school_id()
        AND teacher_user_id = fn_current_user_id()
        AND fn_current_user_role() = 'GURU'::role_type
    ) WITH CHECK (
        school_id           = fn_current_school_id()
        AND teacher_user_id = fn_current_user_id()
    );

CREATE POLICY rls_learning_objectives_delete_guru ON learning_objectives
    FOR DELETE USING (
        school_id           = fn_current_school_id()
        AND teacher_user_id = fn_current_user_id()
        AND fn_current_user_role() = 'GURU'::role_type
    );

CREATE POLICY rls_learning_objectives_select_siswa ON learning_objectives
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'SISWA'::role_type
        AND fn_grade_published_for_me(school_id, learning_objective_id)
    );

CREATE POLICY rls_learning_objectives_select_ortu ON learning_objectives
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ORTU'::role_type
        AND EXISTS (
            SELECT 1 FROM student_parents sp
            WHERE sp.parent_user_id = fn_current_user_id()
              AND sp.school_id      = fn_current_school_id()
              AND fn_grade_published_for_student(
                  school_id, learning_objective_id, sp.student_id
              )
        )
    );

-- Wali kelas: semua LO di sekolah (disederhanakan dari "di kelasnya" —
-- hindari subquery ke learning_objective_classes yang akan RLS-protected)
CREATE POLICY rls_learning_objectives_select_wali ON learning_objectives
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND fn_wali_kelas_class_id() IS NOT NULL
    );

-- Kaprodi: semua LO di sekolah (disederhanakan dari "di jurusannya" —
-- subjects tidak memiliki direct program_id FK)
CREATE POLICY rls_learning_objectives_select_kaprodi ON learning_objectives
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND fn_kaprodi_program_id() IS NOT NULL
    );

CREATE POLICY rls_learning_objectives_select_kepsek_waka ON learning_objectives
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (
            ARRAY['KEPSEK','WAKA_KURIKULUM','WAKA_KESISWAAN']::role_type[]
        )
    );

-- ============================================================
-- learning_objective_classes
-- ============================================================

CREATE POLICY rls_learning_objective_classes_insert_guru ON learning_objective_classes
    FOR INSERT WITH CHECK (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'GURU'::role_type
        AND fn_is_my_lo(learning_objective_id)
    );

CREATE POLICY rls_learning_objective_classes_delete_guru ON learning_objective_classes
    FOR DELETE USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'GURU'::role_type
        AND fn_is_my_lo(learning_objective_id)
    );

CREATE POLICY rls_learning_objective_classes_select_guru ON learning_objective_classes
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'GURU'::role_type
        AND fn_is_my_lo(learning_objective_id)
    );

CREATE POLICY rls_learning_objective_classes_select_siswa ON learning_objective_classes
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'SISWA'::role_type
        AND fn_grade_published_for_me(school_id, learning_objective_id)
    );

CREATE POLICY rls_learning_objective_classes_select_ortu ON learning_objective_classes
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ORTU'::role_type
        AND EXISTS (
            SELECT 1 FROM student_parents sp
            WHERE sp.parent_user_id = fn_current_user_id()
              AND sp.school_id      = fn_current_school_id()
              AND fn_grade_published_for_student(
                  school_id, learning_objective_id, sp.student_id
              )
        )
    );

CREATE POLICY rls_learning_objective_classes_select_wali ON learning_objective_classes
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND fn_wali_kelas_class_id() IS NOT NULL
    );

CREATE POLICY rls_learning_objective_classes_select_kaprodi ON learning_objective_classes
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND fn_kaprodi_program_id() IS NOT NULL
    );

CREATE POLICY rls_learning_objective_classes_select_kepsek_waka ON learning_objective_classes
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (
            ARRAY['KEPSEK','WAKA_KURIKULUM','WAKA_KESISWAAN']::role_type[]
        )
    );

-- ============================================================
-- assessment_criteria
-- ============================================================

CREATE POLICY rls_assessment_criteria_insert_guru ON assessment_criteria
    FOR INSERT WITH CHECK (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'GURU'::role_type
        AND fn_is_my_lo(learning_objective_id)
    );

CREATE POLICY rls_assessment_criteria_update_guru ON assessment_criteria
    FOR UPDATE USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'GURU'::role_type
        AND fn_is_my_lo(learning_objective_id)
    ) WITH CHECK (
        school_id = fn_current_school_id()
        AND fn_is_my_lo(learning_objective_id)
    );

CREATE POLICY rls_assessment_criteria_delete_guru ON assessment_criteria
    FOR DELETE USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'GURU'::role_type
        AND fn_is_my_lo(learning_objective_id)
    );

CREATE POLICY rls_assessment_criteria_select_guru ON assessment_criteria
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'GURU'::role_type
        AND fn_is_my_lo(learning_objective_id)
    );

CREATE POLICY rls_assessment_criteria_select_siswa ON assessment_criteria
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'SISWA'::role_type
        AND fn_grade_published_for_me(school_id, learning_objective_id)
    );

CREATE POLICY rls_assessment_criteria_select_ortu ON assessment_criteria
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ORTU'::role_type
        AND EXISTS (
            SELECT 1 FROM student_parents sp
            WHERE sp.parent_user_id = fn_current_user_id()
              AND sp.school_id      = fn_current_school_id()
              AND fn_grade_published_for_student(
                  school_id, learning_objective_id, sp.student_id
              )
        )
    );

CREATE POLICY rls_assessment_criteria_select_wali ON assessment_criteria
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND fn_wali_kelas_class_id() IS NOT NULL
    );

CREATE POLICY rls_assessment_criteria_select_kaprodi ON assessment_criteria
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND fn_kaprodi_program_id() IS NOT NULL
    );

CREATE POLICY rls_assessment_criteria_select_kepsek_waka ON assessment_criteria
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (
            ARRAY['KEPSEK','WAKA_KURIKULUM','WAKA_KESISWAAN']::role_type[]
        )
    );

-- ============================================================
-- grading_settings
-- ============================================================

CREATE POLICY rls_grading_settings_insert_guru ON grading_settings
    FOR INSERT WITH CHECK (
        school_id           = fn_current_school_id()
        AND teacher_user_id = fn_current_user_id()
        AND fn_current_user_role() = 'GURU'::role_type
    );

CREATE POLICY rls_grading_settings_update_guru ON grading_settings
    FOR UPDATE USING (
        school_id           = fn_current_school_id()
        AND teacher_user_id = fn_current_user_id()
        AND fn_current_user_role() = 'GURU'::role_type
    ) WITH CHECK (
        school_id           = fn_current_school_id()
        AND teacher_user_id = fn_current_user_id()
    );

CREATE POLICY rls_grading_settings_select_guru ON grading_settings
    FOR SELECT USING (
        school_id           = fn_current_school_id()
        AND teacher_user_id = fn_current_user_id()
        AND fn_current_user_role() = 'GURU'::role_type
    );

CREATE POLICY rls_grading_settings_select_kepsek_waka ON grading_settings
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (
            ARRAY['KEPSEK','WAKA_KURIKULUM','WAKA_KESISWAAN']::role_type[]
        )
    );

CREATE POLICY rls_grading_settings_select_kaprodi ON grading_settings
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND fn_kaprodi_program_id() IS NOT NULL
    );

-- ============================================================
-- tp_assessments
-- ============================================================

CREATE POLICY rls_tp_assessments_insert_guru ON tp_assessments
    FOR INSERT WITH CHECK (
        school_id           = fn_current_school_id()
        AND teacher_user_id = fn_current_user_id()
        AND fn_current_user_role() = 'GURU'::role_type
    );

CREATE POLICY rls_tp_assessments_select_guru ON tp_assessments
    FOR SELECT USING (
        school_id           = fn_current_school_id()
        AND teacher_user_id = fn_current_user_id()
        AND fn_current_user_role() = 'GURU'::role_type
    );

-- UPDATE: guru hanya bisa void — kolom lain dijaga trigger
CREATE POLICY rls_tp_assessments_update_guru ON tp_assessments
    FOR UPDATE USING (
        school_id           = fn_current_school_id()
        AND teacher_user_id = fn_current_user_id()
        AND fn_current_user_role() = 'GURU'::role_type
    ) WITH CHECK (
        school_id           = fn_current_school_id()
        AND teacher_user_id = fn_current_user_id()
    );

-- Siswa: miliknya jika grading_settings.is_published = TRUE
CREATE POLICY rls_tp_assessments_select_siswa ON tp_assessments
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'SISWA'::role_type
        AND student_id = (
            SELECT s.student_id FROM students s
            WHERE s.user_id = fn_current_user_id()
            LIMIT 1
        )
        AND fn_grading_is_published(
            school_id, learning_objective_id, teacher_user_id, class_id
        )
    );

-- Ortu: milik anaknya jika is_published = TRUE
CREATE POLICY rls_tp_assessments_select_ortu ON tp_assessments
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ORTU'::role_type
        AND fn_grading_is_published(
            school_id, learning_objective_id, teacher_user_id, class_id
        )
        AND EXISTS (
            SELECT 1 FROM student_parents sp
            WHERE sp.student_id     = tp_assessments.student_id
              AND sp.parent_user_id = fn_current_user_id()
              AND sp.school_id      = fn_current_school_id()
        )
    );

-- Wali kelas: siswa di kelasnya jika is_published = TRUE
-- (class_id langsung tersedia di tp_assessments — tidak butuh cross-table)
CREATE POLICY rls_tp_assessments_select_wali ON tp_assessments
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND fn_wali_kelas_class_id() IS NOT NULL
        AND class_id = fn_wali_kelas_class_id()
        AND fn_grading_is_published(
            school_id, learning_objective_id, teacher_user_id, class_id
        )
    );

-- Kaprodi: siswa di jurusannya jika is_published = TRUE
CREATE POLICY rls_tp_assessments_select_kaprodi ON tp_assessments
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND fn_kaprodi_program_id() IS NOT NULL
        AND fn_grading_is_published(
            school_id, learning_objective_id, teacher_user_id, class_id
        )
        AND EXISTS (
            SELECT 1 FROM students s
            WHERE s.student_id = tp_assessments.student_id
              AND s.program_id = fn_kaprodi_program_id()
        )
    );

-- Kepsek + Waka Kurikulum: semua nilai termasuk yang belum published
CREATE POLICY rls_tp_assessments_select_kepsek_wakakur ON tp_assessments
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (
            ARRAY['KEPSEK','WAKA_KURIKULUM']::role_type[]
        )
    );

-- Waka Kesiswaan: hanya yang sudah published
CREATE POLICY rls_tp_assessments_select_wakasis ON tp_assessments
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'WAKA_KESISWAAN'::role_type
        AND fn_grading_is_published(
            school_id, learning_objective_id, teacher_user_id, class_id
        )
    );

-- ============================================================
-- grade_summaries
-- ============================================================

CREATE POLICY rls_grade_summaries_insert_guru ON grade_summaries
    FOR INSERT WITH CHECK (
        school_id           = fn_current_school_id()
        AND teacher_user_id = fn_current_user_id()
        AND fn_current_user_role() = 'GURU'::role_type
    );

CREATE POLICY rls_grade_summaries_update_guru ON grade_summaries
    FOR UPDATE USING (
        school_id           = fn_current_school_id()
        AND teacher_user_id = fn_current_user_id()
        AND fn_current_user_role() = 'GURU'::role_type
    ) WITH CHECK (
        school_id           = fn_current_school_id()
        AND teacher_user_id = fn_current_user_id()
    );

CREATE POLICY rls_grade_summaries_select_guru ON grade_summaries
    FOR SELECT USING (
        school_id           = fn_current_school_id()
        AND teacher_user_id = fn_current_user_id()
        AND fn_current_user_role() = 'GURU'::role_type
    );

-- Siswa: miliknya jika published_at IS NOT NULL
-- (published_at ada di baris itu sendiri — tidak butuh cross-table)
CREATE POLICY rls_grade_summaries_select_siswa ON grade_summaries
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'SISWA'::role_type
        AND published_at IS NOT NULL
        AND student_id = (
            SELECT s.student_id FROM students s
            WHERE s.user_id = fn_current_user_id()
            LIMIT 1
        )
    );

-- Ortu: milik anaknya jika published_at IS NOT NULL
CREATE POLICY rls_grade_summaries_select_ortu ON grade_summaries
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ORTU'::role_type
        AND published_at IS NOT NULL
        AND EXISTS (
            SELECT 1 FROM student_parents sp
            WHERE sp.student_id     = grade_summaries.student_id
              AND sp.parent_user_id = fn_current_user_id()
              AND sp.school_id      = fn_current_school_id()
        )
    );

-- Wali kelas: siswa di kelasnya jika published_at IS NOT NULL
-- (class_id langsung tersedia — tidak butuh cross-table)
CREATE POLICY rls_grade_summaries_select_wali ON grade_summaries
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND published_at IS NOT NULL
        AND fn_wali_kelas_class_id() IS NOT NULL
        AND class_id = fn_wali_kelas_class_id()
    );

-- Kaprodi: siswa di jurusannya jika published_at IS NOT NULL
CREATE POLICY rls_grade_summaries_select_kaprodi ON grade_summaries
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND published_at IS NOT NULL
        AND fn_kaprodi_program_id() IS NOT NULL
        AND EXISTS (
            SELECT 1 FROM students s
            WHERE s.student_id = grade_summaries.student_id
              AND s.program_id = fn_kaprodi_program_id()
        )
    );

-- Kepsek/Waka: semua di sekolahnya (termasuk yang belum published — untuk monitoring)
CREATE POLICY rls_grade_summaries_select_kepsek_waka ON grade_summaries
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (
            ARRAY['KEPSEK','WAKA_KURIKULUM','WAKA_KESISWAAN']::role_type[]
        )
    );
