-- Fix fn_get_grade_summary: tambah branch WALI_KELAS dan BK
-- yang sebelumnya jatuh ke ELSE dan diblokir

CREATE OR REPLACE FUNCTION fn_get_grade_summary(
    p_subject_id    UUID,
    p_class_id      UUID,
    p_academic_year VARCHAR(9),
    p_semester      INTEGER
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role           role_type;
    v_user_id        UUID;
    v_school_id      UUID;
    v_teacher_id     UUID;
    v_student_ids    UUID[];
    v_published_only BOOLEAN;
    v_result         JSONB;
BEGIN
    v_role      := fn_current_user_role();
    v_user_id   := fn_current_user_id();
    v_school_id := fn_current_school_id();

    CASE v_role
        WHEN 'GURU'::role_type THEN
            IF fn_wali_kelas_class_id() IS NOT NULL
               AND fn_wali_kelas_class_id() = p_class_id THEN
                v_teacher_id     := NULL;
                v_published_only := FALSE;
            ELSE
                v_teacher_id     := v_user_id;
                v_published_only := FALSE;
            END IF;

        WHEN 'WALI_KELAS'::role_type THEN
            v_teacher_id     := NULL;
            v_published_only := FALSE;

        WHEN 'KEPSEK'::role_type, 'WAKA_KURIKULUM'::role_type THEN
            v_teacher_id     := NULL;
            v_published_only := FALSE;

        WHEN 'KAPRODI'::role_type THEN
            v_teacher_id     := NULL;
            v_published_only := TRUE;

        WHEN 'WAKA_KESISWAAN'::role_type THEN
            v_teacher_id     := NULL;
            v_published_only := TRUE;

        WHEN 'BK'::role_type THEN
            v_teacher_id     := NULL;
            v_published_only := TRUE;

        WHEN 'SISWA'::role_type THEN
            v_teacher_id     := NULL;
            v_published_only := TRUE;
            SELECT ARRAY[s.student_id] INTO v_student_ids
            FROM students s
            WHERE s.user_id   = v_user_id
              AND s.school_id = v_school_id;

        WHEN 'ORTU'::role_type THEN
            v_teacher_id     := NULL;
            v_published_only := TRUE;
            SELECT ARRAY_AGG(sp.student_id) INTO v_student_ids
            FROM student_parents sp
            WHERE sp.parent_user_id = v_user_id
              AND sp.school_id      = v_school_id;

        ELSE
            RETURN jsonb_build_object(
                'success', false,
                'error',   'Role tidak memiliki akses ke data penilaian'
            );
    END CASE;

    -- Guard wali kelas: hanya boleh query kelas miliknya
    IF v_role = 'WALI_KELAS'::role_type
       AND fn_wali_kelas_class_id() IS NOT NULL
       AND p_class_id <> fn_wali_kelas_class_id() THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',   'Wali kelas hanya dapat melihat data kelasnya sendiri'
        );
    END IF;

    SELECT jsonb_build_object(
        'grading_settings', (
            SELECT to_jsonb(gs) - 'school_id' - 'teacher_user_id'
            FROM grading_settings gs
            WHERE gs.school_id     = v_school_id
              AND gs.subject_id    = p_subject_id
              AND gs.class_id      = p_class_id
              AND gs.academic_year = p_academic_year
              AND gs.semester      = p_semester
              AND (v_teacher_id IS NULL OR gs.teacher_user_id = v_teacher_id)
            LIMIT 1
        ),
        'students', (
            SELECT COALESCE(
                jsonb_agg(
                    jsonb_build_object(
                        'student_id',    gs.student_id,
                        'grade_summary', jsonb_build_object(
                            'grade_summary_id',   gs.grade_summary_id,
                            'nilai_akhir',        gs.nilai_akhir,
                            'predikat',           gs.predikat,
                            'deskripsi_naratif',  gs.deskripsi_naratif,
                            'is_auto_calculate',  gs.is_auto_calculate,
                            'last_calculated_at', gs.last_calculated_at,
                            'published_at',       gs.published_at
                        ),
                        'tp_breakdown', (
                            SELECT COALESCE(
                                jsonb_agg(
                                    jsonb_build_object(
                                        'learning_objective_id', lo.learning_objective_id,
                                        'kode_tp',               lo.kode_tp,
                                        'deskripsi_tp',          lo.deskripsi_tp,
                                        'urutan',                lo.urutan,
                                        'avg_sumatif', (
                                            SELECT AVG(tpa.nilai_angka)
                                            FROM tp_assessments tpa
                                            WHERE tpa.learning_objective_id = lo.learning_objective_id
                                              AND tpa.student_id            = gs.student_id
                                              AND tpa.class_id              = p_class_id
                                              AND tpa.tipe                  = 'SUMATIF'
                                              AND NOT tpa.is_void
                                        ),
                                        'avg_formatif', (
                                            SELECT AVG(tpa.nilai_angka)
                                            FROM tp_assessments tpa
                                            WHERE tpa.learning_objective_id = lo.learning_objective_id
                                              AND tpa.student_id            = gs.student_id
                                              AND tpa.class_id              = p_class_id
                                              AND tpa.tipe                  = 'FORMATIF'
                                              AND NOT tpa.is_void
                                        ),
                                        'assessments', (
                                            SELECT COALESCE(
                                                jsonb_agg(
                                                    jsonb_build_object(
                                                        'assessment_id',    tpa.assessment_id,
                                                        'tipe',             tpa.tipe,
                                                        'judul',            tpa.judul,
                                                        'nilai_angka',      tpa.nilai_angka,
                                                        'nilai_kualitatif', tpa.nilai_kualitatif,
                                                        'tanggal',          tpa.tanggal,
                                                        'is_void',          tpa.is_void
                                                    ) ORDER BY tpa.tanggal, tpa.created_at
                                                ),
                                                '[]'::jsonb
                                            )
                                            FROM tp_assessments tpa
                                            WHERE tpa.learning_objective_id = lo.learning_objective_id
                                              AND tpa.student_id            = gs.student_id
                                              AND tpa.class_id              = p_class_id
                                        )
                                    ) ORDER BY lo.urutan
                                ),
                                '[]'::jsonb
                            )
                            FROM learning_objectives lo
                            WHERE lo.school_id       = v_school_id
                              AND lo.subject_id      = p_subject_id
                              AND lo.academic_year   = p_academic_year
                              AND lo.semester        = p_semester
                              AND (v_teacher_id IS NULL OR lo.teacher_user_id = v_teacher_id)
                        )
                    ) ORDER BY gs.student_id
                ),
                '[]'::jsonb
            )
            FROM grade_summaries gs
            WHERE gs.school_id     = v_school_id
              AND gs.subject_id    = p_subject_id
              AND gs.class_id      = p_class_id
              AND gs.academic_year = p_academic_year
              AND gs.semester      = p_semester
              AND (v_teacher_id IS NULL OR gs.teacher_user_id = v_teacher_id)
              AND (v_student_ids IS NULL OR gs.student_id = ANY(v_student_ids))
              AND (NOT v_published_only OR gs.published_at IS NOT NULL)
        )
    ) INTO v_result;

    RETURN COALESCE(v_result,
        jsonb_build_object('grading_settings', NULL, 'students', '[]'::jsonb));
END;
$$;

REVOKE EXECUTE ON FUNCTION fn_get_grade_summary(UUID,UUID,VARCHAR,INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_get_grade_summary(UUID,UUID,VARCHAR,INTEGER) FROM anon;
GRANT  EXECUTE ON FUNCTION fn_get_grade_summary(UUID,UUID,VARCHAR,INTEGER) TO authenticated;
