-- Read boundaries for student/parent portals; no existing data is rewritten.
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_portal_can_read_student(p_student_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT auth.uid() IS NOT NULL AND EXISTS (
        SELECT 1 FROM students s
        WHERE s.student_id = p_student_id AND s.school_id = fn_current_school_id()
          AND ((fn_current_user_role() = 'SISWA' AND s.user_id = fn_current_user_id())
            OR (fn_current_user_role() = 'ORTU' AND EXISTS (
                SELECT 1 FROM student_parents sp WHERE sp.student_id = s.student_id
                  AND sp.school_id = s.school_id AND sp.parent_user_id = fn_current_user_id()
            )))
    );
$$;
GRANT EXECUTE ON FUNCTION public.fn_portal_can_read_student(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_portal_can_read_student(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_portal_can_read_student(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.fn_portal_user_labels(p_user_ids uuid[])
RETURNS TABLE(user_id uuid, full_name text, role_type text, dudi_org_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT u.user_id, u.full_name::text, u.role_type::text, u.dudi_org_name::text
    FROM users u
    WHERE auth.uid() IS NOT NULL AND u.school_id = fn_current_school_id()
      AND cardinality(p_user_ids) <= 100 AND u.user_id = ANY(p_user_ids)
      AND fn_current_user_role() IN ('SISWA', 'ORTU')
      AND (
        u.user_id = fn_current_user_id()
        OR u.role_type NOT IN ('SISWA', 'ORTU', 'DUDI')
        OR EXISTS (SELECT 1 FROM pkl_placements pp
                   WHERE pp.dudi_user_id = u.user_id AND pp.school_id = u.school_id
                     AND fn_portal_can_read_student(pp.student_id))
        OR EXISTS (SELECT 1 FROM forum_posts fp
                   WHERE fp.author_user_id = u.user_id AND fp.school_id = u.school_id
                     AND fp.deleted_at IS NULL AND fn_can_read_forum_post(fp.post_id))
      );
$$;
GRANT EXECUTE ON FUNCTION public.fn_portal_user_labels(uuid[]) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_portal_user_labels(uuid[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_portal_user_labels(uuid[]) FROM PUBLIC;
DROP POLICY IF EXISTS rls_users_read_staff_names ON public.users;

CREATE OR REPLACE FUNCTION public.fn_portal_assessment_visible(p_assessment_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT auth.uid() IS NOT NULL AND EXISTS (
        SELECT 1 FROM assessments a
        WHERE a.id = p_assessment_id AND a.school_id = fn_current_school_id()
          AND ((fn_current_user_role() = 'SISWA' AND a.is_visible_siswa IS TRUE)
            OR (fn_current_user_role() = 'ORTU' AND a.is_visible_ortu IS TRUE))
    );
$$;
GRANT EXECUTE ON FUNCTION public.fn_portal_assessment_visible(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_portal_assessment_visible(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_portal_assessment_visible(uuid) FROM PUBLIC;

DROP POLICY IF EXISTS rls_assessment_results_select_siswa ON public.assessment_results;
CREATE POLICY rls_assessment_results_select_siswa ON public.assessment_results FOR SELECT TO authenticated
USING (school_id = fn_current_school_id() AND fn_current_user_role() = 'SISWA'
    AND student_id = fn_current_student_id() AND fn_portal_assessment_visible(assessment_id));
DROP POLICY IF EXISTS rls_assessment_results_select_ortu ON public.assessment_results;
CREATE POLICY rls_assessment_results_select_ortu ON public.assessment_results FOR SELECT TO authenticated
USING (school_id = fn_current_school_id() AND fn_current_user_role() = 'ORTU'
    AND fn_portal_can_read_student(student_id) AND fn_portal_assessment_visible(assessment_id));

-- Teacher recap can combine all SUMATIF assessments, even when anchored to one TP.
-- Without contributor metadata, require the whole subject/class/period to be published.
CREATE OR REPLACE FUNCTION public.fn_portal_recap_visible(p_learning_objective_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT auth.uid() IS NOT NULL AND EXISTS (
        SELECT 1 FROM learning_objectives lo
        WHERE lo.id = p_learning_objective_id AND lo.school_id = fn_current_school_id()
          AND fn_current_user_role() IN ('SISWA', 'ORTU')
          AND EXISTS (SELECT 1 FROM assessments a
              WHERE a.school_id = lo.school_id AND a.class_id = lo.class_id
                AND a.subject_id = lo.subject_id AND a.academic_year = lo.academic_year
                AND a.semester = lo.semester AND a.jenis = 'SUMATIF')
          AND NOT EXISTS (SELECT 1 FROM assessments a
              WHERE a.school_id = lo.school_id AND a.class_id = lo.class_id
                AND a.subject_id = lo.subject_id AND a.academic_year = lo.academic_year
                AND a.semester = lo.semester AND a.jenis = 'SUMATIF'
                AND NOT fn_portal_assessment_visible(a.id))
    );
$$;
GRANT EXECUTE ON FUNCTION public.fn_portal_recap_visible(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_portal_recap_visible(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_portal_recap_visible(uuid) FROM PUBLIC;
DROP POLICY IF EXISTS rls_grade_recap_select_siswa ON public.grade_recap;
CREATE POLICY rls_grade_recap_select_siswa ON public.grade_recap FOR SELECT TO authenticated
USING (school_id = fn_current_school_id() AND fn_current_user_role() = 'SISWA'
    AND student_id = fn_current_student_id() AND fn_portal_recap_visible(learning_objective_id));
DROP POLICY IF EXISTS rls_grade_recap_select_ortu ON public.grade_recap;
CREATE POLICY rls_grade_recap_select_ortu ON public.grade_recap FOR SELECT TO authenticated
USING (school_id = fn_current_school_id() AND fn_current_user_role() = 'ORTU'
    AND fn_portal_can_read_student(student_id) AND fn_portal_recap_visible(learning_objective_id));

CREATE OR REPLACE FUNCTION public.fn_portal_attendance(
    p_student_id uuid, p_date_start date DEFAULT NULL, p_date_end date DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT COALESCE(jsonb_agg(row_data ORDER BY session_date DESC, session_start), '[]'::jsonb)
    FROM (
        SELECT ts.session_date, ts.session_start, jsonb_build_object(
            'schedule_id', ts.schedule_id, 'block_group_id', ts.block_group_id,
            'session_date', ts.session_date, 'session_start', ts.session_start, 'session_end', ts.session_end,
            'subject', jsonb_build_object('name', sub.name),
            'teacher', jsonb_build_object('full_name', u.full_name),
            'attendance', jsonb_build_array(jsonb_build_object(
                'attendance_id', att.attendance_id, 'status', att.status, 'is_void', att.is_void, 'notes', att.notes))
        ) AS row_data
        FROM attendance att
        JOIN teaching_schedules ts ON ts.schedule_id = att.schedule_id AND ts.school_id = att.school_id
        LEFT JOIN subjects sub ON sub.subject_id = ts.subject_id AND sub.school_id = ts.school_id
        LEFT JOIN users u ON u.user_id = ts.scheduled_teacher_id AND u.school_id = ts.school_id
        WHERE fn_portal_can_read_student(p_student_id)
          AND att.school_id = fn_current_school_id() AND att.student_id = p_student_id
          AND att.is_void IS FALSE
          AND (p_date_start IS NULL OR ts.session_date >= p_date_start)
          AND (p_date_end IS NULL OR ts.session_date <= p_date_end)
    ) history;
$$;
GRANT EXECUTE ON FUNCTION public.fn_portal_attendance(uuid, date, date) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_portal_attendance(uuid, date, date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_portal_attendance(uuid, date, date) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.fn_get_all_grades_summary(
    p_student_id uuid DEFAULT NULL, p_academic_year character varying DEFAULT NULL, p_semester integer DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_student_id uuid;
    v_school_id uuid := fn_current_school_id();
    v_grades jsonb;
BEGIN
    v_student_id := CASE WHEN fn_current_user_role() = 'SISWA' THEN fn_current_student_id() ELSE p_student_id END;
    IF NOT fn_portal_can_read_student(v_student_id)
       OR (p_student_id IS NOT NULL AND p_student_id IS DISTINCT FROM v_student_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Akses tidak diizinkan');
    END IF;
    SELECT COALESCE(jsonb_agg(g.row_data ORDER BY g.academic_year DESC, g.semester DESC, g.subject_name, g.kind, g.id), '[]'::jsonb)
    INTO v_grades FROM (
        SELECT a.academic_year, a.semester, sub.name AS subject_name, 'ASESMEN' AS kind, ar.id,
            jsonb_build_object('grade_summary_id', ar.id, 'subject_id', a.subject_id,
                'subject_name', sub.name, 'academic_year', a.academic_year, 'semester', a.semester,
                'nilai_akhir', ar.nilai, 'predikat', ar.status, 'deskripsi_naratif', ar.umpan_balik,
                'published_at', ar.updated_at, 'kind', 'ASESMEN',
                'label', concat_ws(' - ', a.jenis, a.instrumen, a.tanggal::text)) AS row_data
        FROM assessment_results ar
        JOIN assessments a ON a.id = ar.assessment_id AND a.school_id = ar.school_id AND a.class_id = ar.class_id
        JOIN subjects sub ON sub.subject_id = a.subject_id AND sub.school_id = a.school_id
        WHERE ar.school_id = v_school_id AND ar.student_id = v_student_id
          AND fn_portal_assessment_visible(a.id)
          AND (p_academic_year IS NULL OR a.academic_year = p_academic_year)
          AND (p_semester IS NULL OR a.semester = p_semester)
        UNION ALL
        SELECT gr.academic_year, gr.semester, sub.name, 'REKAP', gr.id,
            jsonb_build_object('grade_summary_id', gr.id, 'subject_id', lo.subject_id,
                'subject_name', sub.name, 'academic_year', gr.academic_year, 'semester', gr.semester,
                'nilai_akhir', gr.nilai_akhir, 'predikat', NULL, 'deskripsi_naratif', gr.deskripsi_capaian,
                'published_at', gr.updated_at, 'kind', 'REKAP', 'label', 'Rekap tersimpan')
        FROM grade_recap gr
        JOIN learning_objectives lo ON lo.id = gr.learning_objective_id AND lo.school_id = gr.school_id
            AND lo.class_id = gr.class_id AND lo.academic_year = gr.academic_year AND lo.semester = gr.semester
        JOIN subjects sub ON sub.subject_id = lo.subject_id AND sub.school_id = lo.school_id
        WHERE gr.school_id = v_school_id AND gr.student_id = v_student_id
          AND fn_portal_recap_visible(lo.id)
          AND (p_academic_year IS NULL OR gr.academic_year = p_academic_year)
          AND (p_semester IS NULL OR gr.semester = p_semester)
    ) g;
    RETURN jsonb_build_object('success', true, 'student_id', v_student_id, 'grades', v_grades);
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_get_all_grades_summary(uuid, character varying, integer) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_get_all_grades_summary(uuid, character varying, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_get_all_grades_summary(uuid, character varying, integer) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.fn_forum_attachment_moderator()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM users u
        WHERE u.user_id = fn_current_user_id() AND u.school_id = fn_current_school_id()
          AND u.is_active IS TRUE AND u.deleted_at IS NULL
          AND (u.role_type IN ('KEPSEK', 'WAKA_KESISWAAN', 'ADMINISTRATIVE')
            OR u.is_kepsek IS TRUE OR u.is_waka_kesiswaan IS TRUE));
$$;
GRANT EXECUTE ON FUNCTION public.fn_forum_attachment_moderator() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_forum_attachment_moderator() FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_forum_attachment_moderator() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.fn_forum_attachment_readable(p_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM forum_posts fp
        WHERE fp.school_id = fn_current_school_id() AND fp.attachment_path = p_path
          AND fp.deleted_at IS NULL AND fn_can_read_forum_post(fp.post_id));
$$;
GRANT EXECUTE ON FUNCTION public.fn_forum_attachment_readable(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_forum_attachment_readable(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_forum_attachment_readable(text) FROM PUBLIC;

DROP POLICY IF EXISTS forum_attachments_download ON storage.objects;
CREATE POLICY forum_attachments_download ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'forum-attachments' AND (storage.foldername(name))[1] = fn_current_school_id()::text
    AND (owner_id = auth.uid()::text OR fn_forum_attachment_moderator() OR fn_forum_attachment_readable(name)));
DROP POLICY IF EXISTS forum_attachments_delete ON storage.objects;
CREATE POLICY forum_attachments_delete ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'forum-attachments' AND (storage.foldername(name))[1] = fn_current_school_id()::text
    AND (owner_id = auth.uid()::text OR fn_forum_attachment_moderator()));

COMMIT;
