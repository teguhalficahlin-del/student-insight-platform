-- ============================================================
-- FILE: 06_rls_policies.sql
-- LAYER: RLS -- Row Level Security
-- LAST SYNCED: 2026-07-24 (sync dari live DB xovvuuwexoweoqyltepq)
-- TOTAL POLICY: 185
-- CATATAN: File ini adalah referensi dokumentasi saja.
--          Sumber kebenaran: supabase/migrations/
-- ============================================================
-- TABLE: academic_periods
CREATE POLICY rls_academic_periods_insert_administrative ON public.academic_periods AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));

-- TABLE: academic_periods
CREATE POLICY rls_academic_periods_read_all ON public.academic_periods AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (auth.uid() IS NOT NULL)));

-- TABLE: academic_periods
CREATE POLICY rls_academic_periods_update_administrative ON public.academic_periods AS PERMISSIVE FOR UPDATE TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));

-- TABLE: attendance
CREATE POLICY rls_attendance_rw_guru ON public.attendance AS PERMISSIVE FOR ALL TO public
  USING (((school_id = fn_current_school_id()) AND (EXISTS ( SELECT 1
   FROM teaching_schedules ts
  WHERE ((ts.schedule_id = attendance.schedule_id) AND ((ts.scheduled_teacher_id = fn_current_user_id()) OR (EXISTS ( SELECT 1
           FROM teaching_assignments ta
          WHERE ((ta.assignment_id = ts.assignment_id) AND (ta.user_id = fn_current_user_id()) AND (ta.is_active = true))))))))))
  WITH CHECK (((school_id = fn_current_school_id()) AND (EXISTS ( SELECT 1
   FROM teaching_schedules ts
  WHERE ((ts.schedule_id = attendance.schedule_id) AND ((ts.scheduled_teacher_id = fn_current_user_id()) OR (EXISTS ( SELECT 1
           FROM teaching_assignments ta
          WHERE ((ta.assignment_id = ts.assignment_id) AND (ta.user_id = fn_current_user_id()) AND (ta.is_active = true))))))))));

-- TABLE: attendance
CREATE POLICY rls_attendance_rw_substitute ON public.attendance AS PERMISSIVE FOR ALL TO public
  USING (((school_id = fn_current_school_id()) AND (EXISTS ( SELECT 1
   FROM substitute_schedules ss
  WHERE ((ss.schedule_id = attendance.schedule_id) AND (ss.substitute_user_id = fn_current_user_id()) AND (ss.sync_token_expires_at > now()))))))
  WITH CHECK (((school_id = fn_current_school_id()) AND (EXISTS ( SELECT 1
   FROM substitute_schedules ss
  WHERE ((ss.schedule_id = attendance.schedule_id) AND (ss.substitute_user_id = fn_current_user_id()) AND (ss.sync_token_expires_at > now()))))));

-- TABLE: attendance
CREATE POLICY rls_attendance_read_parent ON public.attendance AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ORTU'::role_type) AND (is_void = false) AND (EXISTS ( SELECT 1
   FROM student_parents sp
  WHERE ((sp.student_id = attendance.student_id) AND (sp.parent_user_id = fn_current_user_id()))))));

-- TABLE: attendance
CREATE POLICY rls_attendance_read_staff ON public.attendance AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (is_void = false) AND fn_can_see_student(student_id)));

-- TABLE: attendance
CREATE POLICY rls_attendance_read_student ON public.attendance AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'SISWA'::role_type) AND (student_id = ( SELECT s.student_id
   FROM students s
  WHERE (s.user_id = fn_current_user_id()))) AND (is_void = false)));

-- TABLE: attendance
CREATE POLICY rls_attendance_read_tu ON public.attendance AS PERMISSIVE FOR SELECT TO public
  USING (((fn_current_user_role() = 'TU'::role_type) AND (is_void = false) AND (EXISTS ( SELECT 1
   FROM teaching_schedules ts
  WHERE ((ts.schedule_id = attendance.schedule_id) AND (ts.school_id = fn_current_school_id()))))));

-- TABLE: audit_log
CREATE POLICY rls_audit_log_read ON public.audit_log AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['KEPSEK'::role_type, 'WAKA_KESISWAAN'::role_type, 'WAKA_HUMAS'::role_type, 'KAPRODI'::role_type, 'ADMINISTRATIVE'::role_type]))));

-- TABLE: bk_class_assignments
CREATE POLICY rls_bk_class_write ON public.bk_class_assignments AS PERMISSIVE FOR ALL TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['KEPSEK'::role_type, 'WAKA_KESISWAAN'::role_type, 'ADMINISTRATIVE'::role_type]))))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['KEPSEK'::role_type, 'WAKA_KESISWAAN'::role_type, 'ADMINISTRATIVE'::role_type]))));

-- TABLE: bk_class_assignments
CREATE POLICY rls_bk_class_read ON public.bk_class_assignments AS PERMISSIVE FOR SELECT TO public
  USING ((school_id = fn_current_school_id()));

-- TABLE: capaian_pembelajaran
CREATE POLICY rls_cp_write ON public.capaian_pembelajaran AS PERMISSIVE FOR ALL TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['ADMINISTRATIVE'::role_type, 'GURU'::role_type, 'WALI_KELAS'::role_type, 'BK'::role_type, 'KAPRODI'::role_type, 'WAKA_KURIKULUM'::role_type, 'WAKA_KESISWAAN'::role_type, 'WAKA_HUMAS'::role_type, 'KEPSEK'::role_type]))));

-- TABLE: capaian_pembelajaran
CREATE POLICY rls_cp_read ON public.capaian_pembelajaran AS PERMISSIVE FOR SELECT TO public
  USING ((school_id = fn_current_school_id()));

-- TABLE: case_audience_members
CREATE POLICY rls_cam_delete ON public.case_audience_members AS PERMISSIVE FOR DELETE TO public
  USING (((school_id = fn_current_school_id()) AND fn_is_internal_case_actor() AND fn_can_see_case(case_id)));

-- TABLE: case_audience_members
CREATE POLICY rls_cam_insert ON public.case_audience_members AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((school_id = fn_current_school_id()) AND (added_by_user_id = fn_current_user_id()) AND fn_is_internal_case_actor() AND fn_can_see_case(case_id) AND ((EXISTS ( SELECT 1
   FROM users u
  WHERE ((u.user_id = case_audience_members.user_id) AND (u.school_id = fn_current_school_id()) AND ((u.role_type = ANY (ARRAY['GURU'::role_type, 'BK'::role_type, 'WALI_KELAS'::role_type, 'KAPRODI'::role_type, 'WAKA_KESISWAAN'::role_type, 'KEPSEK'::role_type])) OR u.is_bk OR u.is_kepsek OR u.is_waka_kesiswaan)))) OR fn_is_case_subject_or_parent(case_id, user_id))));

-- TABLE: case_audience_members
CREATE POLICY rls_cam_read ON public.case_audience_members AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND fn_can_see_case(case_id)));

-- TABLE: case_events
CREATE POLICY rls_case_events_delete_administrative ON public.case_events AS PERMISSIVE FOR DELETE TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));

-- TABLE: case_events
CREATE POLICY rls_case_events_insert_handler ON public.case_events AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((school_id = fn_current_school_id()) AND (author_user_id = fn_current_user_id()) AND (author_role_at_time = fn_current_user_role()) AND (EXISTS ( SELECT 1
   FROM cases c
  WHERE ((c.case_id = case_events.case_id) AND fn_matches_case_handler(c.current_handler_role, c.student_id) AND (c.status <> 'CLOSED'::case_status))))));

-- TABLE: case_events
CREATE POLICY rls_case_events_insert_kepsek ON public.case_events AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((school_id = fn_current_school_id()) AND fn_is_kepsek() AND (author_user_id = fn_current_user_id()) AND (author_role_at_time = fn_current_user_role())));

-- TABLE: case_events
CREATE POLICY rls_case_events_read_parent ON public.case_events AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ORTU'::role_type) AND (privacy_level = 'STUDENT_VISIBLE'::visibility_level) AND fn_can_see_case(case_id)));

-- TABLE: case_events
CREATE POLICY rls_case_events_read_staff ON public.case_events AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() <> ALL (ARRAY['SISWA'::role_type, 'ORTU'::role_type])) AND fn_can_see_case(case_id)));

-- TABLE: case_events
CREATE POLICY rls_case_events_read_student ON public.case_events AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'SISWA'::role_type) AND (privacy_level = 'STUDENT_VISIBLE'::visibility_level) AND fn_can_see_case(case_id)));

-- TABLE: cases
CREATE POLICY rls_cases_delete_administrative ON public.cases AS PERMISSIVE FOR DELETE TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));

-- TABLE: cases
CREATE POLICY rls_cases_insert ON public.cases AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((school_id = fn_current_school_id()) AND fn_student_in_current_school(student_id) AND ((fn_current_user_role() = 'DUDI'::role_type) OR ((fn_current_user_role() = ANY (ARRAY['GURU'::role_type, 'BK'::role_type, 'WALI_KELAS'::role_type, 'KAPRODI'::role_type, 'KEPSEK'::role_type, 'WAKA_KESISWAAN'::role_type, 'WAKA_HUMAS'::role_type])) AND (NOT fn_student_is_on_pkl(student_id))) OR (fn_is_bk() AND (NOT fn_student_is_on_pkl(student_id))) OR (fn_is_kepsek() AND (NOT fn_student_is_on_pkl(student_id))) OR (fn_is_waka_kesiswaan() AND (NOT fn_student_is_on_pkl(student_id))))));

-- TABLE: cases
CREATE POLICY rls_cases_read_dudi ON public.cases AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'DUDI'::role_type) AND fn_dudi_supervises_student(student_id)));

-- TABLE: cases
CREATE POLICY rls_cases_read_staff ON public.cases AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND fn_can_see_case(case_id)));

-- TABLE: cases
CREATE POLICY rls_cases_update_audience ON public.cases AS PERMISSIVE FOR UPDATE TO public
  USING (((school_id = fn_current_school_id()) AND (fn_matches_case_handler(current_handler_role, student_id) OR fn_is_kepsek() OR (created_by_user_id = fn_current_user_id()))))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_matches_case_handler(current_handler_role, student_id) OR fn_is_kepsek() OR (created_by_user_id = fn_current_user_id()))));

-- TABLE: cases
CREATE POLICY rls_cases_update_sync ON public.cases AS PERMISSIVE FOR UPDATE TO public
  USING (((school_id = fn_current_school_id()) AND (fn_matches_case_handler(current_handler_role, student_id) OR (fn_is_kepsek() AND (status <> 'CLOSED'::case_status)) OR (current_setting('app.case_sync_active'::text, true) = 'true'::text))));

-- TABLE: class_enrollments
CREATE POLICY rls_enrollments_write_admin ON public.class_enrollments AS PERMISSIVE FOR ALL TO public
  USING (((school_id = fn_current_school_id()) AND (fn_is_kepsek() OR fn_kaprodi_of_student(student_id))))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_is_kepsek() OR fn_kaprodi_of_student(student_id))));

-- TABLE: class_enrollments
CREATE POLICY rls_enrollments_write_administrative ON public.class_enrollments AS PERMISSIVE FOR ALL TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));

-- TABLE: class_enrollments
CREATE POLICY rls_enrollments_read_administrative ON public.class_enrollments AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));

-- TABLE: class_enrollments
CREATE POLICY rls_enrollments_read_parent ON public.class_enrollments AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ORTU'::role_type) AND (EXISTS ( SELECT 1
   FROM student_parents sp
  WHERE ((sp.student_id = class_enrollments.student_id) AND (sp.parent_user_id = fn_current_user_id()))))));

-- TABLE: class_enrollments
CREATE POLICY rls_enrollments_read_staff ON public.class_enrollments AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND fn_can_see_student(student_id)));

-- TABLE: class_enrollments
CREATE POLICY rls_enrollments_read_student ON public.class_enrollments AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'SISWA'::role_type) AND (student_id = fn_current_student_id())));

-- TABLE: classes
CREATE POLICY rls_classes_write_admin ON public.classes AS PERMISSIVE FOR ALL TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));

-- TABLE: classes
CREATE POLICY rls_classes_read_all ON public.classes AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (auth.uid() IS NOT NULL)));

-- TABLE: communication_categories
CREATE POLICY rls_comm_cat_read ON public.communication_categories AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_active = true));

-- TABLE: duty_schedules
CREATE POLICY rls_duty_schedules_write ON public.duty_schedules AS PERMISSIVE FOR ALL TO public
  USING (((school_id = fn_current_school_id()) AND ((fn_current_user_role() = 'ADMINISTRATIVE'::role_type) OR fn_is_kepsek())));

-- TABLE: duty_schedules
CREATE POLICY rls_duty_schedules_read ON public.duty_schedules AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['GURU'::role_type, 'BK'::role_type, 'WALI_KELAS'::role_type, 'KEPSEK'::role_type, 'WAKA_KURIKULUM'::role_type, 'WAKA_KESISWAAN'::role_type, 'WAKA_HUMAS'::role_type, 'ADMINISTRATIVE'::role_type]))));

-- TABLE: duty_schedules
CREATE POLICY rls_duty_schedules_read_tu ON public.duty_schedules AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'TU'::role_type)));

-- TABLE: evaluation_logs
CREATE POLICY el_insert ON public.evaluation_logs AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((school_id = fn_current_school_id()));

-- TABLE: evaluation_logs
CREATE POLICY el_select ON public.evaluation_logs AS PERMISSIVE FOR SELECT TO public
  USING ((school_id = fn_current_school_id()));

-- TABLE: forum_post_acknowledgements
CREATE POLICY rls_forum_ack_delete ON public.forum_post_acknowledgements AS PERMISSIVE FOR DELETE TO public
  USING (((school_id = fn_current_school_id()) AND (user_id = fn_current_user_id())));

-- TABLE: forum_post_acknowledgements
CREATE POLICY rls_forum_ack_insert ON public.forum_post_acknowledgements AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((school_id = fn_current_school_id()) AND (user_id = fn_current_user_id()) AND fn_can_read_forum_post(post_id)));

-- TABLE: forum_post_acknowledgements
CREATE POLICY rls_forum_ack_read ON public.forum_post_acknowledgements AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND fn_can_read_forum_post(post_id)));

-- TABLE: forum_post_audience
CREATE POLICY rls_forum_aud_read ON public.forum_post_audience AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND fn_can_read_forum_post(post_id)));

-- TABLE: forum_post_audience
CREATE POLICY rls_forum_post_audience_read_tu ON public.forum_post_audience AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'TU'::role_type)));

-- TABLE: forum_post_comments
CREATE POLICY rls_forum_comments_delete ON public.forum_post_comments AS PERMISSIVE FOR DELETE TO public
  USING (((school_id = fn_current_school_id()) AND ((author_user_id = fn_current_user_id()) OR (fn_current_user_role() = ANY (ARRAY['KEPSEK'::role_type, 'WAKA_KESISWAAN'::role_type])))));

-- TABLE: forum_post_comments
CREATE POLICY rls_forum_comments_insert ON public.forum_post_comments AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((school_id = fn_current_school_id()) AND (author_user_id = fn_current_user_id()) AND fn_can_read_forum_post(post_id) AND (fn_current_user_role() = ANY (ARRAY['GURU'::role_type, 'BK'::role_type, 'WALI_KELAS'::role_type, 'KAPRODI'::role_type, 'KEPSEK'::role_type, 'ADMINISTRATIVE'::role_type, 'WAKA_KURIKULUM'::role_type, 'WAKA_KESISWAAN'::role_type, 'WAKA_HUMAS'::role_type, 'ORTU'::role_type]))));

-- TABLE: forum_post_comments
CREATE POLICY rls_forum_comments_read ON public.forum_post_comments AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND fn_can_read_forum_post(post_id)));

-- TABLE: forum_post_comments
CREATE POLICY rls_forum_post_comments_read_tu ON public.forum_post_comments AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'TU'::role_type)));

-- TABLE: forum_post_comments
CREATE POLICY rls_forum_comments_update ON public.forum_post_comments AS PERMISSIVE FOR UPDATE TO public
  USING (((school_id = fn_current_school_id()) AND (author_user_id = fn_current_user_id())))
  WITH CHECK (((school_id = fn_current_school_id()) AND (author_user_id = fn_current_user_id())));

-- TABLE: forum_post_subjects
CREATE POLICY rls_forum_subj_write ON public.forum_post_subjects AS PERMISSIVE FOR ALL TO public
  USING ((school_id = fn_current_school_id()))
  WITH CHECK ((school_id = fn_current_school_id()));

-- TABLE: forum_post_subjects
CREATE POLICY rls_forum_subj_read ON public.forum_post_subjects AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND fn_can_read_forum_post(post_id)));

-- TABLE: forum_posts
CREATE POLICY rls_forum_posts_delete ON public.forum_posts AS PERMISSIVE FOR DELETE TO public
  USING (((school_id = fn_current_school_id()) AND ((author_user_id = fn_current_user_id()) OR (fn_current_user_role() = ANY (ARRAY['KEPSEK'::role_type, 'WAKA_KESISWAAN'::role_type])))));

-- TABLE: forum_posts
CREATE POLICY rls_forum_posts_read ON public.forum_posts AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND fn_can_read_forum_post(post_id)));

-- TABLE: forum_posts
CREATE POLICY rls_forum_posts_read_tu ON public.forum_posts AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'TU'::role_type)));

-- TABLE: forum_posts
CREATE POLICY rls_forum_posts_update ON public.forum_posts AS PERMISSIVE FOR UPDATE TO public
  USING (((school_id = fn_current_school_id()) AND (author_user_id = fn_current_user_id())))
  WITH CHECK (((school_id = fn_current_school_id()) AND (author_user_id = fn_current_user_id()) AND (class_id = ( SELECT fp2.class_id
   FROM forum_posts fp2
  WHERE (fp2.post_id = forum_posts.post_id))) AND (visibility = ( SELECT fp2.visibility
   FROM forum_posts fp2
  WHERE (fp2.post_id = forum_posts.post_id))) AND (academic_year = ( SELECT fp2.academic_year
   FROM forum_posts fp2
  WHERE (fp2.post_id = forum_posts.post_id))) AND (NOT (audience_type IS DISTINCT FROM ( SELECT fp2.audience_type
   FROM forum_posts fp2
  WHERE (fp2.post_id = forum_posts.post_id)))) AND (NOT (audience_type_2 IS DISTINCT FROM ( SELECT fp2.audience_type_2
   FROM forum_posts fp2
  WHERE (fp2.post_id = forum_posts.post_id))))));

-- TABLE: generation_jobs
CREATE POLICY gj_insert ON public.generation_jobs AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((school_id = fn_current_school_id()) AND (teacher_user_id = auth.uid())));

-- TABLE: generation_jobs
CREATE POLICY gj_select ON public.generation_jobs AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (teacher_user_id = auth.uid())));

-- TABLE: generation_jobs
CREATE POLICY gj_update ON public.generation_jobs AS PERMISSIVE FOR UPDATE TO public
  USING (((school_id = fn_current_school_id()) AND (teacher_user_id = auth.uid())));

-- TABLE: guru_wali_assignments
CREATE POLICY rls_guru_wali_write ON public.guru_wali_assignments AS PERMISSIVE FOR ALL TO authenticated
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));

-- TABLE: guru_wali_assignments
CREATE POLICY rls_guru_wali_read ON public.guru_wali_assignments AS PERMISSIVE FOR SELECT TO public
  USING ((school_id = fn_current_school_id()));

-- TABLE: late_arrivals
CREATE POLICY rls_late_arrivals_delete_own ON public.late_arrivals AS PERMISSIVE FOR DELETE TO public
  USING (((school_id = fn_current_school_id()) AND (recorded_by = fn_current_user_id()) AND fn_is_on_duty_today()));

-- TABLE: late_arrivals
CREATE POLICY rls_late_arrivals_insert ON public.late_arrivals AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((school_id = fn_current_school_id()) AND fn_is_on_duty_today() AND (recorded_by = fn_current_user_id())));

-- TABLE: late_arrivals
CREATE POLICY rls_late_arrivals_read_parent ON public.late_arrivals AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ORTU'::role_type) AND (EXISTS ( SELECT 1
   FROM student_parents sp
  WHERE ((sp.student_id = late_arrivals.student_id) AND (sp.parent_user_id = fn_current_user_id()))))));

-- TABLE: late_arrivals
CREATE POLICY rls_late_arrivals_read_staff ON public.late_arrivals AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_is_on_duty_today() OR fn_is_kepsek() OR fn_is_waka_kesiswaan() OR (fn_current_user_role() = 'ADMINISTRATIVE'::role_type))));

-- TABLE: late_arrivals
CREATE POLICY rls_late_arrivals_read_student ON public.late_arrivals AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'SISWA'::role_type) AND (EXISTS ( SELECT 1
   FROM students s
  WHERE ((s.student_id = late_arrivals.student_id) AND (s.user_id = fn_current_user_id()) AND (s.school_id = fn_current_school_id()))))));

-- TABLE: late_arrivals
CREATE POLICY rls_late_arrivals_read_tu ON public.late_arrivals AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'TU'::role_type)));

-- TABLE: ld_context_snapshots
CREATE POLICY snapshot_owner_write ON public.ld_context_snapshots AS PERMISSIVE FOR ALL TO public
  USING ((created_by = auth.uid()));

-- TABLE: ld_context_snapshots
CREATE POLICY snapshot_school_read ON public.ld_context_snapshots AS PERMISSIVE FOR SELECT TO public
  USING ((school_id = ( SELECT users.school_id
   FROM users
  WHERE (users.user_id = auth.uid()))));

-- TABLE: ld_document_nodes
CREATE POLICY node_via_document ON public.ld_document_nodes AS PERMISSIVE FOR ALL TO public
  USING ((document_id IN ( SELECT ld_documents.document_id
   FROM ld_documents
  WHERE (ld_documents.created_by = auth.uid()))));

-- TABLE: ld_document_tp_links
CREATE POLICY tp_link_via_document ON public.ld_document_tp_links AS PERMISSIVE FOR ALL TO public
  USING ((document_id IN ( SELECT ld_documents.document_id
   FROM ld_documents
  WHERE (ld_documents.created_by = auth.uid()))));

-- TABLE: ld_document_versions
CREATE POLICY version_owner ON public.ld_document_versions AS PERMISSIVE FOR ALL TO public
  USING ((published_by = auth.uid()));

-- TABLE: ld_documents
CREATE POLICY document_owner ON public.ld_documents AS PERMISSIVE FOR ALL TO public
  USING ((created_by = auth.uid()));

-- TABLE: ld_documents
CREATE POLICY document_school_read ON public.ld_documents AS PERMISSIVE FOR SELECT TO public
  USING ((school_id = ( SELECT users.school_id
   FROM users
  WHERE (users.user_id = auth.uid()))));

-- TABLE: ld_program_knowledge_national
CREATE POLICY national_knowledge_read_all ON public.ld_program_knowledge_national AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

-- TABLE: ld_program_knowledge_school
CREATE POLICY school_knowledge_tenant ON public.ld_program_knowledge_school AS PERMISSIVE FOR ALL TO public
  USING ((school_id = ( SELECT users.school_id
   FROM users
  WHERE (users.user_id = auth.uid()))));

-- TABLE: ld_prompt_templates
CREATE POLICY prompt_templates_read_authenticated ON public.ld_prompt_templates AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

-- TABLE: ld_teacher_knowledge
CREATE POLICY teacher_knowledge_owner ON public.ld_teacher_knowledge AS PERMISSIVE FOR ALL TO public
  USING ((teacher_id = auth.uid()));

-- TABLE: login_devices
CREATE POLICY rls_login_devices_read ON public.login_devices AS PERMISSIVE FOR SELECT TO public
  USING (((user_id = fn_current_user_id()) AND (school_id = fn_current_school_id())));

-- TABLE: notifications
CREATE POLICY rls_notif_read ON public.notifications AS PERMISSIVE FOR SELECT TO public
  USING (((recipient_user_id = fn_current_user_id()) AND (school_id = fn_current_school_id())));

-- TABLE: notifications
CREATE POLICY rls_notif_update_read ON public.notifications AS PERMISSIVE FOR UPDATE TO public
  USING (((recipient_user_id = fn_current_user_id()) AND (school_id = fn_current_school_id())))
  WITH CHECK ((recipient_user_id = fn_current_user_id()));

-- TABLE: observations
CREATE POLICY rls_observations_insert ON public.observations AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'GURU'::role_type) AND (author_user_id = fn_current_user_id()) AND (visibility = ANY (ARRAY['SISWA_SAJA'::visibility_level, 'ORTU_SAJA'::visibility_level, 'SISWA_DAN_ORTU'::visibility_level])) AND fn_guru_teaches_student(student_id)));

-- TABLE: observations
CREATE POLICY rls_observations_read_guru ON public.observations AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'GURU'::role_type) AND (author_user_id = fn_current_user_id())));

-- TABLE: observations
CREATE POLICY rls_observations_read_parent ON public.observations AS PERMISSIVE FOR SELECT TO public
  USING (((fn_current_user_role() = 'ORTU'::role_type) AND (visibility = ANY (ARRAY['ORTU_SAJA'::visibility_level, 'SISWA_DAN_ORTU'::visibility_level])) AND (is_void = false) AND (EXISTS ( SELECT 1
   FROM student_parents sp
  WHERE ((sp.student_id = observations.student_id) AND (sp.parent_user_id = fn_current_user_id()))))));

-- TABLE: observations
CREATE POLICY rls_observations_read_student ON public.observations AS PERMISSIVE FOR SELECT TO public
  USING (((fn_current_user_role() = 'SISWA'::role_type) AND (visibility = ANY (ARRAY['SISWA_SAJA'::visibility_level, 'SISWA_DAN_ORTU'::visibility_level])) AND (is_void = false) AND (EXISTS ( SELECT 1
   FROM students s
  WHERE ((s.student_id = observations.student_id) AND (s.user_id = fn_current_user_id()) AND (s.school_id = fn_current_school_id()))))));

-- TABLE: observations
CREATE POLICY rls_observations_update_author ON public.observations AS PERMISSIVE FOR UPDATE TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'GURU'::role_type) AND (author_user_id = fn_current_user_id())))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'GURU'::role_type) AND (author_user_id = fn_current_user_id()) AND (visibility = ANY (ARRAY['SISWA_SAJA'::visibility_level, 'ORTU_SAJA'::visibility_level, 'SISWA_DAN_ORTU'::visibility_level]))));

-- TABLE: observations
CREATE POLICY rls_observations_void_admin ON public.observations AS PERMISSIVE FOR UPDATE TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));

-- TABLE: pkl_attendance
CREATE POLICY rls_pkl_attendance_rw_dudi ON public.pkl_attendance AS PERMISSIVE FOR ALL TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'DUDI'::role_type) AND fn_dudi_supervises_student(student_id)))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'DUDI'::role_type) AND fn_dudi_supervises_student(student_id) AND (recorded_by_user_id = fn_current_user_id())));

-- TABLE: pkl_attendance
CREATE POLICY rls_pkl_attendance_delete_administrative ON public.pkl_attendance AS PERMISSIVE FOR DELETE TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));

-- TABLE: pkl_attendance
CREATE POLICY rls_pkl_attendance_read_kaprodi ON public.pkl_attendance AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_kaprodi_program_id() IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM students s
  WHERE ((s.student_id = pkl_attendance.student_id) AND (s.program_id = fn_kaprodi_program_id()))))));

-- TABLE: pkl_attendance
CREATE POLICY rls_pkl_attendance_read_ortu ON public.pkl_attendance AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ORTU'::role_type) AND (EXISTS ( SELECT 1
   FROM student_parents sp
  WHERE ((sp.student_id = pkl_attendance.student_id) AND (sp.parent_user_id = fn_current_user_id()))))));

-- TABLE: pkl_attendance
CREATE POLICY rls_pkl_attendance_read_staff ON public.pkl_attendance AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['GURU'::role_type, 'BK'::role_type, 'WALI_KELAS'::role_type, 'KAPRODI'::role_type, 'KEPSEK'::role_type, 'WAKA_HUMAS'::role_type]))));

-- TABLE: pkl_attendance
CREATE POLICY rls_pkl_attendance_read_student ON public.pkl_attendance AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'SISWA'::role_type) AND (student_id = fn_current_student_id())));

-- TABLE: pkl_placements
CREATE POLICY rls_pkl_write_admin ON public.pkl_placements AS PERMISSIVE FOR ALL TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['KAPRODI'::role_type, 'KEPSEK'::role_type, 'WAKA_HUMAS'::role_type]))))
  WITH CHECK ((school_id = fn_current_school_id()));

-- TABLE: pkl_placements
CREATE POLICY rls_pkl_write_administrative ON public.pkl_placements AS PERMISSIVE FOR ALL TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));

-- TABLE: pkl_placements
CREATE POLICY rls_pkl_read_dudi ON public.pkl_placements AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'DUDI'::role_type) AND (dudi_user_id = fn_current_user_id())));

-- TABLE: pkl_placements
CREATE POLICY rls_pkl_read_ortu ON public.pkl_placements AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ORTU'::role_type) AND (EXISTS ( SELECT 1
   FROM student_parents sp
  WHERE ((sp.student_id = pkl_placements.student_id) AND (sp.parent_user_id = fn_current_user_id()))))));

-- TABLE: pkl_placements
CREATE POLICY rls_pkl_read_staff ON public.pkl_placements AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['GURU'::role_type, 'BK'::role_type, 'WALI_KELAS'::role_type, 'KAPRODI'::role_type, 'KEPSEK'::role_type, 'WAKA_HUMAS'::role_type]))));

-- TABLE: pkl_placements
CREATE POLICY rls_pkl_read_student ON public.pkl_placements AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'SISWA'::role_type) AND (student_id = fn_current_student_id())));

-- TABLE: programs
CREATE POLICY rls_programs_write_admin ON public.programs AS PERMISSIVE FOR ALL TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['KEPSEK'::role_type, 'KAPRODI'::role_type, 'ADMINISTRATIVE'::role_type]))))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['KEPSEK'::role_type, 'KAPRODI'::role_type, 'ADMINISTRATIVE'::role_type]))));

-- TABLE: programs
CREATE POLICY rls_programs_read_all ON public.programs AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (auth.uid() IS NOT NULL)));

-- TABLE: prompt_templates
CREATE POLICY pt_select ON public.prompt_templates AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

-- TABLE: schedule_templates
CREATE POLICY rls_schedule_templates_write_administrative ON public.schedule_templates AS PERMISSIVE FOR ALL TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));

-- TABLE: schedule_templates
CREATE POLICY rls_schedule_templates_read_staff ON public.schedule_templates AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['GURU'::role_type, 'BK'::role_type, 'WALI_KELAS'::role_type, 'KAPRODI'::role_type, 'KEPSEK'::role_type]))));

-- TABLE: schedule_time_slots
CREATE POLICY rls_time_slots_write ON public.schedule_time_slots AS PERMISSIVE FOR ALL TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));

-- TABLE: schedule_time_slots
CREATE POLICY rls_time_slots_read ON public.schedule_time_slots AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));

-- TABLE: school_config
CREATE POLICY rls_school_config_write_admin ON public.school_config AS PERMISSIVE FOR ALL TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['ADMINISTRATIVE'::role_type, 'KEPSEK'::role_type]))))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['ADMINISTRATIVE'::role_type, 'KEPSEK'::role_type]))));

-- TABLE: school_config
CREATE POLICY rls_school_config_read_all ON public.school_config AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (auth.uid() IS NOT NULL)));

-- TABLE: schools
CREATE POLICY rls_schools_read_own ON public.schools AS PERMISSIVE FOR SELECT TO authenticated
  USING ((school_id = ( SELECT users.school_id
   FROM users
  WHERE (users.auth_user_id = auth.uid())
 LIMIT 1)));

-- TABLE: student_exits
CREATE POLICY rls_exits_delete_own ON public.student_exits AS PERMISSIVE FOR DELETE TO public
  USING (((school_id = fn_current_school_id()) AND (recorded_by = fn_current_user_id()) AND fn_is_on_duty_today()));

-- TABLE: student_exits
CREATE POLICY rls_exits_insert_piket ON public.student_exits AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((school_id = fn_current_school_id()) AND (recorded_by = fn_current_user_id()) AND fn_is_on_duty_today()));

-- TABLE: student_exits
CREATE POLICY rls_exits_read_parent ON public.student_exits AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (EXISTS ( SELECT 1
   FROM student_parents sp
  WHERE ((sp.student_id = student_exits.student_id) AND (sp.parent_user_id = fn_current_user_id()) AND (sp.school_id = fn_current_school_id()))))));

-- TABLE: student_exits
CREATE POLICY rls_exits_read_piket ON public.student_exits AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (exit_date = ((now() AT TIME ZONE 'Asia/Jakarta'::text))::date) AND fn_is_on_duty_today()));

-- TABLE: student_exits
CREATE POLICY rls_exits_read_student ON public.student_exits AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (student_id = ( SELECT s.student_id
   FROM students s
  WHERE (s.user_id = fn_current_user_id())
 LIMIT 1))));

-- TABLE: student_exits
CREATE POLICY rls_exits_read_tu ON public.student_exits AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'TU'::role_type)));

-- TABLE: student_exits
CREATE POLICY rls_exits_read_waka ON public.student_exits AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['WAKA_KESISWAAN'::role_type, 'KEPSEK'::role_type]))));

-- TABLE: student_exits
CREATE POLICY rls_exits_update_own ON public.student_exits AS PERMISSIVE FOR UPDATE TO public
  USING (((school_id = fn_current_school_id()) AND (recorded_by = fn_current_user_id()) AND fn_is_on_duty_today()))
  WITH CHECK (((school_id = fn_current_school_id()) AND (recorded_by = fn_current_user_id())));

-- TABLE: student_parents
CREATE POLICY rls_student_parents_write_administrative ON public.student_parents AS PERMISSIVE FOR ALL TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));

-- TABLE: student_parents
CREATE POLICY rls_student_parents_read_administrative ON public.student_parents AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));

-- TABLE: student_parents
CREATE POLICY rls_student_parents_read_own ON public.student_parents AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ORTU'::role_type) AND (parent_user_id = fn_current_user_id())));

-- TABLE: student_parents
CREATE POLICY rls_student_parents_read_staff ON public.student_parents AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['GURU'::role_type, 'BK'::role_type, 'WALI_KELAS'::role_type, 'KAPRODI'::role_type, 'KEPSEK'::role_type]))));

-- TABLE: student_updates
CREATE POLICY rls_student_updates_insert ON public.student_updates AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((school_id = fn_current_school_id()) AND (author_user_id = fn_current_user_id()) AND (EXISTS ( SELECT 1
   FROM cases c
  WHERE ((c.case_id = student_updates.case_id) AND fn_matches_case_handler(c.current_handler_role, c.student_id) AND (c.status <> 'CLOSED'::case_status))))));

-- TABLE: student_updates
CREATE POLICY rls_student_updates_read_parent ON public.student_updates AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ORTU'::role_type) AND fn_can_see_case(case_id)));

-- TABLE: student_updates
CREATE POLICY rls_student_updates_read_staff ON public.student_updates AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['GURU'::role_type, 'BK'::role_type, 'WALI_KELAS'::role_type, 'KAPRODI'::role_type, 'KEPSEK'::role_type, 'DUDI'::role_type]))));

-- TABLE: student_updates
CREATE POLICY rls_student_updates_read_student ON public.student_updates AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'SISWA'::role_type) AND fn_can_see_case(case_id)));

-- TABLE: students
CREATE POLICY rls_students_write_admin ON public.students AS PERMISSIVE FOR ALL TO public
  USING (((school_id = fn_current_school_id()) AND (fn_is_kepsek() OR (program_id = fn_kaprodi_program_id()))))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_is_kepsek() OR (program_id = fn_kaprodi_program_id()))));

-- TABLE: students
CREATE POLICY rls_students_write_administrative ON public.students AS PERMISSIVE FOR ALL TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));

-- TABLE: students
CREATE POLICY rls_students_read_administrative ON public.students AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));

-- TABLE: students
CREATE POLICY rls_students_read_dudi ON public.students AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'DUDI'::role_type) AND fn_dudi_supervises_student(student_id)));

-- TABLE: students
CREATE POLICY rls_students_read_own ON public.students AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'SISWA'::role_type) AND (user_id = fn_current_user_id())));

-- TABLE: students
CREATE POLICY rls_students_read_parent ON public.students AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ORTU'::role_type) AND (EXISTS ( SELECT 1
   FROM student_parents sp
  WHERE ((sp.student_id = students.student_id) AND (sp.parent_user_id = fn_current_user_id()))))));

-- TABLE: students
CREATE POLICY rls_students_read_staff ON public.students AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND fn_can_see_student(student_id)));

-- TABLE: students
CREATE POLICY rls_students_read_tu ON public.students AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'TU'::role_type)));

-- TABLE: subject_cp_mapping
CREATE POLICY scm_insert ON public.subject_cp_mapping AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((school_id = fn_current_school_id()));

-- TABLE: subject_cp_mapping
CREATE POLICY scm_select ON public.subject_cp_mapping AS PERMISSIVE FOR SELECT TO authenticated
  USING ((school_id = fn_current_school_id()));

-- TABLE: subject_cp_mapping
CREATE POLICY scm_update ON public.subject_cp_mapping AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((school_id = fn_current_school_id()));

-- TABLE: subjects
CREATE POLICY rls_subjects_write_admin ON public.subjects AS PERMISSIVE FOR ALL TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['KEPSEK'::role_type, 'KAPRODI'::role_type]))))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['KEPSEK'::role_type, 'KAPRODI'::role_type]))));

-- TABLE: subjects
CREATE POLICY rls_subjects_read_all ON public.subjects AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (auth.uid() IS NOT NULL)));

-- TABLE: substitute_schedules
CREATE POLICY rls_substitute_write_admin ON public.substitute_schedules AS PERMISSIVE FOR ALL TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['KAPRODI'::role_type, 'KEPSEK'::role_type]))))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['KAPRODI'::role_type, 'KEPSEK'::role_type]))));

-- TABLE: substitute_schedules
CREATE POLICY rls_substitute_write_administrative ON public.substitute_schedules AS PERMISSIVE FOR ALL TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));

-- TABLE: substitute_schedules
CREATE POLICY rls_substitute_read_own ON public.substitute_schedules AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (substitute_user_id = fn_current_user_id())));

-- TABLE: teacher_attendance_log
CREATE POLICY rls_teacher_att_log_read_own ON public.teacher_attendance_log AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND ((user_id = fn_current_user_id()) OR (fn_current_user_role() = 'KEPSEK'::role_type))));

-- TABLE: teacher_document_approvals
CREATE POLICY tda_delete ON public.teacher_document_approvals AS PERMISSIVE FOR DELETE TO authenticated
  USING (((school_id = fn_current_school_id()) AND (doc_id IN ( SELECT teacher_documents.doc_id
   FROM teacher_documents
  WHERE ((teacher_documents.teacher_user_id = auth.uid()) AND ((teacher_documents.status)::text <> 'DISAHKAN_WAKA'::text))))));

-- TABLE: teacher_document_approvals
CREATE POLICY tda_insert ON public.teacher_document_approvals AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((school_id = fn_current_school_id()) AND fn_is_kepsek()));

-- TABLE: teacher_document_approvals
CREATE POLICY tda_select ON public.teacher_document_approvals AS PERMISSIVE FOR SELECT TO public
  USING ((school_id = fn_current_school_id()));

-- TABLE: teacher_document_classes
CREATE POLICY tdc_delete ON public.teacher_document_classes AS PERMISSIVE FOR DELETE TO public
  USING ((school_id = fn_current_school_id()));

-- TABLE: teacher_document_classes
CREATE POLICY tdc_insert ON public.teacher_document_classes AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((school_id = fn_current_school_id()));

-- TABLE: teacher_document_classes
CREATE POLICY tdc_select ON public.teacher_document_classes AS PERMISSIVE FOR SELECT TO public
  USING ((school_id = fn_current_school_id()));

-- TABLE: teacher_documents
CREATE POLICY td_delete ON public.teacher_documents AS PERMISSIVE FOR DELETE TO authenticated
  USING (((school_id = fn_current_school_id()) AND (teacher_user_id = auth.uid()) AND ((status)::text <> 'DISAHKAN_WAKA'::text)));

-- TABLE: teacher_documents
CREATE POLICY td_insert ON public.teacher_documents AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((school_id = fn_current_school_id()) AND (teacher_user_id = auth.uid())));

-- TABLE: teacher_documents
CREATE POLICY td_select ON public.teacher_documents AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND ((teacher_user_id = auth.uid()) OR fn_is_kepsek() OR fn_is_waka_kurikulum())));

-- TABLE: teacher_documents
CREATE POLICY td_update ON public.teacher_documents AS PERMISSIVE FOR UPDATE TO public
  USING (((school_id = fn_current_school_id()) AND (teacher_user_id = auth.uid())));

-- TABLE: teacher_journals
CREATE POLICY rls_journals_owner ON public.teacher_journals AS PERMISSIVE FOR ALL TO public
  USING (((school_id = fn_current_school_id()) AND (owner_user_id = fn_current_user_id())))
  WITH CHECK (((school_id = fn_current_school_id()) AND (owner_user_id = fn_current_user_id())));

-- TABLE: teacher_profiles
CREATE POLICY tp_insert ON public.teacher_profiles AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((school_id = fn_current_school_id()) AND (teacher_user_id = auth.uid())));

-- TABLE: teacher_profiles
CREATE POLICY tp_select ON public.teacher_profiles AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (teacher_user_id = auth.uid())));

-- TABLE: teacher_profiles
CREATE POLICY tp_update ON public.teacher_profiles AS PERMISSIVE FOR UPDATE TO public
  USING (((school_id = fn_current_school_id()) AND (teacher_user_id = auth.uid())));

-- TABLE: teaching_assignments
CREATE POLICY rls_assignments_write_admin ON public.teaching_assignments AS PERMISSIVE FOR ALL TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['KAPRODI'::role_type, 'KEPSEK'::role_type]))))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['KAPRODI'::role_type, 'KEPSEK'::role_type]))));

-- TABLE: teaching_assignments
CREATE POLICY rls_assignments_write_administrative ON public.teaching_assignments AS PERMISSIVE FOR ALL TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));

-- TABLE: teaching_assignments
CREATE POLICY rls_assignments_read_administrative ON public.teaching_assignments AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));

-- TABLE: teaching_assignments
CREATE POLICY rls_assignments_read_all_staff ON public.teaching_assignments AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['GURU'::role_type, 'BK'::role_type, 'WALI_KELAS'::role_type, 'KAPRODI'::role_type, 'KEPSEK'::role_type]))));

-- TABLE: teaching_assignments
CREATE POLICY rls_assignments_read_waka ON public.teaching_assignments AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['WAKA_KURIKULUM'::role_type, 'WAKA_KESISWAAN'::role_type]))));

-- TABLE: teaching_contexts
CREATE POLICY tc_insert ON public.teaching_contexts AS PERMISSIVE FOR INSERT TO public
  WITH CHECK (((school_id = fn_current_school_id()) AND (teacher_user_id = auth.uid())));

-- TABLE: teaching_contexts
CREATE POLICY tc_select ON public.teaching_contexts AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (teacher_user_id = auth.uid())));

-- TABLE: teaching_contexts
CREATE POLICY tc_update ON public.teaching_contexts AS PERMISSIVE FOR UPDATE TO public
  USING (((school_id = fn_current_school_id()) AND (teacher_user_id = auth.uid())));

-- TABLE: teaching_schedules
CREATE POLICY rls_schedules_write_admin ON public.teaching_schedules AS PERMISSIVE FOR ALL TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['KAPRODI'::role_type, 'KEPSEK'::role_type]))))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['KAPRODI'::role_type, 'KEPSEK'::role_type]))));

-- TABLE: teaching_schedules
CREATE POLICY rls_schedules_write_administrative ON public.teaching_schedules AS PERMISSIVE FOR ALL TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));

-- TABLE: teaching_schedules
CREATE POLICY rls_schedules_read_administrative ON public.teaching_schedules AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));

-- TABLE: teaching_schedules
CREATE POLICY rls_schedules_read_parent ON public.teaching_schedules AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ORTU'::role_type) AND (EXISTS ( SELECT 1
   FROM (class_enrollments ce
     JOIN student_parents sp ON ((sp.student_id = ce.student_id)))
  WHERE ((ce.class_id = teaching_schedules.class_id) AND (ce.school_id = fn_current_school_id()) AND (ce.withdrawn_at IS NULL) AND (sp.parent_user_id = fn_current_user_id()))))));

-- TABLE: teaching_schedules
CREATE POLICY rls_schedules_read_staff ON public.teaching_schedules AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['GURU'::role_type, 'BK'::role_type, 'WALI_KELAS'::role_type, 'KAPRODI'::role_type, 'KEPSEK'::role_type]))));

-- TABLE: teaching_schedules
CREATE POLICY rls_schedules_read_student ON public.teaching_schedules AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'SISWA'::role_type) AND (EXISTS ( SELECT 1
   FROM class_enrollments ce
  WHERE ((ce.class_id = teaching_schedules.class_id) AND (ce.student_id = fn_current_student_id()) AND (ce.school_id = fn_current_school_id()) AND (ce.withdrawn_at IS NULL))))));

-- TABLE: teaching_schedules
CREATE POLICY rls_schedules_read_tu ON public.teaching_schedules AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'TU'::role_type)));

-- TABLE: teaching_schedules
CREATE POLICY rls_schedules_read_waka ON public.teaching_schedules AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['WAKA_KURIKULUM'::role_type, 'WAKA_KESISWAAN'::role_type]))));

-- TABLE: tujuan_pembelajaran
CREATE POLICY rls_tp_write ON public.tujuan_pembelajaran AS PERMISSIVE FOR ALL TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['ADMINISTRATIVE'::role_type, 'GURU'::role_type, 'WALI_KELAS'::role_type, 'BK'::role_type, 'KAPRODI'::role_type, 'WAKA_KURIKULUM'::role_type, 'WAKA_KESISWAAN'::role_type, 'WAKA_HUMAS'::role_type, 'KEPSEK'::role_type]))));

-- TABLE: tujuan_pembelajaran
CREATE POLICY rls_tp_read ON public.tujuan_pembelajaran AS PERMISSIVE FOR SELECT TO public
  USING ((school_id = fn_current_school_id()));

-- TABLE: users
CREATE POLICY rls_users_write_administrative ON public.users AS PERMISSIVE FOR ALL TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)))
  WITH CHECK (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));

-- TABLE: users
CREATE POLICY rls_users_read_administrative ON public.users AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'ADMINISTRATIVE'::role_type)));

-- TABLE: users
CREATE POLICY rls_users_read_own ON public.users AS PERMISSIVE FOR SELECT TO public
  USING ((auth_user_id = auth.uid()));

-- TABLE: users
CREATE POLICY rls_users_read_staff ON public.users AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (((fn_current_user_role() = ANY (ARRAY['GURU'::role_type, 'BK'::role_type, 'WALI_KELAS'::role_type, 'KAPRODI'::role_type, 'KEPSEK'::role_type, 'WAKA_KURIKULUM'::role_type, 'WAKA_KESISWAAN'::role_type, 'WAKA_HUMAS'::role_type, 'ADMINISTRATIVE'::role_type])) AND (role_type = ANY (ARRAY['GURU'::role_type, 'BK'::role_type, 'WALI_KELAS'::role_type, 'KAPRODI'::role_type, 'KEPSEK'::role_type, 'WAKA_KURIKULUM'::role_type, 'WAKA_KESISWAAN'::role_type, 'WAKA_HUMAS'::role_type, 'DUDI'::role_type, 'ADMINISTRATIVE'::role_type]))) OR (auth_user_id = auth.uid()) OR ((fn_current_user_role() = ANY (ARRAY['GURU'::role_type, 'BK'::role_type, 'WALI_KELAS'::role_type, 'KAPRODI'::role_type, 'KEPSEK'::role_type, 'WAKA_KURIKULUM'::role_type, 'WAKA_KESISWAAN'::role_type, 'WAKA_HUMAS'::role_type, 'ADMINISTRATIVE'::role_type])) AND (role_type = ANY (ARRAY['SISWA'::role_type, 'ORTU'::role_type]))))));

-- TABLE: users
CREATE POLICY rls_users_read_staff_names ON public.users AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['SISWA'::role_type, 'ORTU'::role_type])) AND (role_type = ANY (ARRAY['GURU'::role_type, 'BK'::role_type, 'WALI_KELAS'::role_type, 'KAPRODI'::role_type, 'KEPSEK'::role_type, 'WAKA_KURIKULUM'::role_type, 'WAKA_KESISWAAN'::role_type, 'DUDI'::role_type]))));

-- TABLE: users
CREATE POLICY rls_users_read_tu ON public.users AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = 'TU'::role_type)));

-- TABLE: users
CREATE POLICY rls_users_read_waka ON public.users AS PERMISSIVE FOR SELECT TO public
  USING (((school_id = fn_current_school_id()) AND (fn_current_user_role() = ANY (ARRAY['WAKA_KURIKULUM'::role_type, 'WAKA_KESISWAAN'::role_type]))));

-- TABLE: users
CREATE POLICY rls_users_update_own ON public.users AS PERMISSIVE FOR UPDATE TO public
  USING ((auth_user_id = auth.uid()))
  WITH CHECK (((auth_user_id = auth.uid()) AND (school_id = fn_current_school_id())));

