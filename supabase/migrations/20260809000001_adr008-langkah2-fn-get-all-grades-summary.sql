-- ADR-008 Langkah 2 — Tulis ulang fn_get_all_grades_summary
-- Baca dari student_grades + assessments + public.subjects (bukan grade_summaries lama).
-- Signature tidak berubah. Kolom output yang dikonsumsi JS dipertahankan.
-- nilai_akhir, predikat, deskripsi_naratif → NULL per keputusan ADR-008 Langkah 2
-- (kalkulasi nilai akhir akan ditentukan di Langkah 6).
-- grade_summaries (tabel lama) masih hidup — tidak disentuh di langkah ini.

CREATE OR REPLACE FUNCTION public.fn_get_all_grades_summary(
    p_student_id    uuid              DEFAULT NULL,
    p_academic_year character varying DEFAULT NULL,
    p_semester      integer           DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

    -- Pre-aggregate per subject+year+semester di subquery,
    -- lalu jsonb_agg di luar — menghindari nested aggregate (PostgreSQL error 42803).
    SELECT jsonb_build_object(
        'success',    true,
        'student_id', v_student_id,
        'grades', COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'grade_summary_id',  NULL,
                    'subject_id',        grp.subject_id,
                    'subject_name',      grp.subject_name,
                    'academic_year',     grp.academic_year,
                    'semester',          grp.semester,
                    'nilai_akhir',       NULL,
                    'predikat',          NULL,
                    'deskripsi_naratif', NULL,
                    'published_at',      grp.latest_updated_at
                ) ORDER BY grp.academic_year DESC, grp.semester DESC, grp.subject_name
            ),
            '[]'::jsonb
        )
    ) INTO v_result
    FROM (
        SELECT
            a.subject_id,
            sub.name            AS subject_name,
            a.academic_year,
            a.semester,
            MAX(sg.updated_at)  AS latest_updated_at
        FROM student_grades sg
        JOIN assessments     a   ON a.id          = sg.assessment_id
        JOIN public.subjects sub ON sub.subject_id = a.subject_id
        WHERE sg.school_id    = v_school_id
          AND sg.student_id   = v_student_id
          AND sg.is_published = TRUE
          AND (p_academic_year IS NULL OR a.academic_year = p_academic_year)
          AND (p_semester      IS NULL OR a.semester      = p_semester)
        GROUP BY a.subject_id, sub.name, a.academic_year, a.semester
    ) grp;

    RETURN COALESCE(v_result,
        jsonb_build_object('success', true, 'student_id', v_student_id, 'grades', '[]'::jsonb));
END;
$function$;

GRANT  EXECUTE ON FUNCTION public.fn_get_all_grades_summary(uuid, character varying, integer) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_get_all_grades_summary(uuid, character varying, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_get_all_grades_summary(uuid, character varying, integer) FROM PUBLIC;
