-- fn_get_all_grades_summary
-- Mengembalikan semua nilai akhir yang sudah dipublikasi untuk satu siswa.
-- Role SISWA  : student_id diambil otomatis dari sesi login (p_student_id diabaikan).
-- Role ORTU   : p_student_id wajib diisi; divalidasi via student_parents + school_id.
-- Hanya baris dengan published_at IS NOT NULL yang dikembalikan.

CREATE OR REPLACE FUNCTION fn_get_all_grades_summary(
    p_student_id    UUID    DEFAULT NULL,
    p_academic_year VARCHAR(9) DEFAULT NULL,
    p_semester      INTEGER DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role       role_type;
    v_user_id    UUID;
    v_school_id  UUID;
    v_student_id UUID;
    v_result     JSONB;
BEGIN
    v_role      := fn_current_user_role();
    v_user_id   := fn_current_user_id();
    v_school_id := fn_current_school_id();

    CASE v_role
        WHEN 'SISWA'::role_type THEN
            SELECT s.student_id INTO v_student_id
            FROM students s
            WHERE s.school_id = v_school_id
              AND s.user_id   = v_user_id
            LIMIT 1;
            IF v_student_id IS NULL THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'error',   'Profil siswa tidak ditemukan'
                );
            END IF;

        WHEN 'ORTU'::role_type THEN
            IF p_student_id IS NULL THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'error',   'p_student_id wajib diisi untuk role ORTU'
                );
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM student_parents sp
                WHERE sp.parent_user_id = v_user_id
                  AND sp.student_id     = p_student_id
                  AND sp.school_id      = v_school_id
            ) THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'error',   'Akses tidak diizinkan'
                );
            END IF;
            v_student_id := p_student_id;

        ELSE
            RETURN jsonb_build_object(
                'success', false,
                'error',   'Role tidak memiliki akses ke data ini'
            );
    END CASE;

    SELECT jsonb_build_object(
        'success',    true,
        'student_id', v_student_id,
        'grades', COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'grade_summary_id',  gs.grade_summary_id,
                    'subject_id',        gs.subject_id,
                    'subject_name',      sub.name,
                    'academic_year',     gs.academic_year,
                    'semester',          gs.semester,
                    'nilai_akhir',       gs.nilai_akhir,
                    'predikat',          gs.predikat,
                    'deskripsi_naratif', gs.deskripsi_naratif,
                    'published_at',      gs.published_at
                ) ORDER BY gs.semester, sub.name
            ),
            '[]'::jsonb
        )
    ) INTO v_result
    FROM grade_summaries gs
    LEFT JOIN subjects sub ON sub.subject_id = gs.subject_id
    WHERE gs.school_id    = v_school_id
      AND gs.student_id   = v_student_id
      AND gs.published_at IS NOT NULL
      AND (p_academic_year IS NULL OR gs.academic_year = p_academic_year)
      AND (p_semester      IS NULL OR gs.semester      = p_semester);

    RETURN COALESCE(v_result,
        jsonb_build_object('success', true, 'student_id', v_student_id, 'grades', '[]'::jsonb));
END;
$$;

REVOKE EXECUTE ON FUNCTION fn_get_all_grades_summary(UUID, VARCHAR, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_get_all_grades_summary(UUID, VARCHAR, INTEGER) FROM anon;
GRANT  EXECUTE ON FUNCTION fn_get_all_grades_summary(UUID, VARCHAR, INTEGER) TO authenticated;
