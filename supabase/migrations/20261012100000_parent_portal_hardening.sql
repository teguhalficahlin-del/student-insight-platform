BEGIN;

-- Parent forum posts must not deliver a private message to staff assigned to
-- unrelated students. The client narrows the list to the selected child; this
-- trigger is the server-side backstop for direct RPC callers and stale clients.
CREATE OR REPLACE FUNCTION public.fn_validate_parent_forum_audience()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_author_id     uuid;
    v_school_id     uuid;
    v_academic_year text;
    v_subject_student_ids uuid[];
BEGIN
    SELECT fp.author_user_id, fp.school_id, fp.academic_year
      INTO v_author_id, v_school_id, v_academic_year
    FROM public.forum_posts fp
    WHERE fp.post_id = NEW.post_id;

    SELECT array_agg(fps.student_id)
      INTO v_subject_student_ids
    FROM public.forum_post_subjects fps
    WHERE fps.post_id = NEW.post_id;

    IF v_author_id IS NULL
       OR public.fn_current_user_role() IS DISTINCT FROM 'ORTU'
       OR v_author_id <> public.fn_current_user_id()
       OR NEW.user_id = v_author_id
    THEN
        RETURN NEW;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM (
            SELECT u.user_id
            FROM public.student_parents sp
            JOIN public.class_enrollments ce
              ON ce.student_id = sp.student_id
             AND ce.school_id = v_school_id
             AND ce.academic_year = v_academic_year
             AND ce.withdrawn_at IS NULL
            JOIN public.users u
              ON u.school_id = v_school_id
             AND u.wali_kelas_class_id = ce.class_id
             AND u.is_active IS TRUE
             AND u.deleted_at IS NULL
            WHERE sp.parent_user_id = v_author_id
              AND sp.school_id = v_school_id
              AND (v_subject_student_ids IS NULL OR sp.student_id = ANY(v_subject_student_ids))

            UNION

            SELECT bca.bk_user_id
            FROM public.student_parents sp
            JOIN public.class_enrollments ce
              ON ce.student_id = sp.student_id
             AND ce.school_id = v_school_id
             AND ce.academic_year = v_academic_year
             AND ce.withdrawn_at IS NULL
            JOIN public.bk_class_assignments bca
              ON bca.class_id = ce.class_id
             AND bca.school_id = v_school_id
             AND bca.is_active IS TRUE
            JOIN public.users u
              ON u.user_id = bca.bk_user_id
             AND u.school_id = v_school_id
             AND u.is_active IS TRUE
             AND u.deleted_at IS NULL
            WHERE sp.parent_user_id = v_author_id
              AND sp.school_id = v_school_id
              AND (v_subject_student_ids IS NULL OR sp.student_id = ANY(v_subject_student_ids))

            UNION

            SELECT gwa.guru_user_id
            FROM public.student_parents sp
            JOIN public.guru_wali_assignments gwa
              ON gwa.student_id = sp.student_id
             AND gwa.school_id = v_school_id
             AND gwa.academic_year = v_academic_year
             AND gwa.is_active IS TRUE
            JOIN public.users u
              ON u.user_id = gwa.guru_user_id
             AND u.school_id = v_school_id
             AND u.is_active IS TRUE
             AND u.deleted_at IS NULL
            WHERE sp.parent_user_id = v_author_id
              AND sp.school_id = v_school_id
              AND (v_subject_student_ids IS NULL OR sp.student_id = ANY(v_subject_student_ids))

            UNION

            SELECT ts.scheduled_teacher_id
            FROM public.student_parents sp
            JOIN public.class_enrollments ce
              ON ce.student_id = sp.student_id
             AND ce.school_id = v_school_id
             AND ce.academic_year = v_academic_year
             AND ce.withdrawn_at IS NULL
            JOIN public.teaching_schedules ts
              ON ts.class_id = ce.class_id
             AND ts.school_id = v_school_id
             AND ts.session_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta')::date
            JOIN public.users u
              ON u.user_id = ts.scheduled_teacher_id
             AND u.school_id = v_school_id
             AND u.is_active IS TRUE
             AND u.deleted_at IS NULL
            WHERE sp.parent_user_id = v_author_id
              AND sp.school_id = v_school_id
              AND (v_subject_student_ids IS NULL OR sp.student_id = ANY(v_subject_student_ids))
        ) allowed
        WHERE allowed.user_id = NEW.user_id
    ) THEN
        RAISE EXCEPTION 'Penerima forum orang tua tidak terkait dengan anak pengirim.'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_parent_forum_audience ON public.forum_post_audience;
CREATE TRIGGER trg_validate_parent_forum_audience
    BEFORE INSERT ON public.forum_post_audience
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_validate_parent_forum_audience();

GRANT EXECUTE ON FUNCTION public.fn_validate_parent_forum_audience() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_validate_parent_forum_audience() FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_validate_parent_forum_audience() FROM PUBLIC;

COMMIT;
