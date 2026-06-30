-- ============================================================
-- FASE 1 Multi-tenant — Langkah 4: Tambah filter school_id ke semua RLS policy
-- Strategi: DROP policy lama → CREATE ulang dengan tambahan school_id check
-- ============================================================

-- ════════════════════════════════════════════════════════════
-- USERS
-- ════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS rls_users_read_own            ON users;
DROP POLICY IF EXISTS rls_users_read_staff          ON users;
DROP POLICY IF EXISTS rls_users_read_staff_names    ON users;
DROP POLICY IF EXISTS rls_users_read_waka           ON users;
DROP POLICY IF EXISTS rls_users_read_administrative ON users;
DROP POLICY IF EXISTS rls_users_update_own          ON users;
DROP POLICY IF EXISTS rls_users_write_administrative ON users;

CREATE POLICY rls_users_read_own ON users FOR SELECT
    USING (auth_user_id = auth.uid());

CREATE POLICY rls_users_read_staff ON users FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['GURU','BK','WALI_KELAS','KAPRODI','KEPSEK','DUDI']::role_type[]));

CREATE POLICY rls_users_read_staff_names ON users FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['SISWA','ORTU']::role_type[])
        AND role_type = ANY (ARRAY['GURU','BK','WALI_KELAS','KAPRODI','KEPSEK','WAKA_KURIKULUM','WAKA_KESISWAAN','DUDI']::role_type[]));

CREATE POLICY rls_users_read_waka ON users FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['WAKA_KURIKULUM','WAKA_KESISWAAN']::role_type[]));

CREATE POLICY rls_users_read_administrative ON users FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type);

CREATE POLICY rls_users_update_own ON users FOR UPDATE
    USING (auth_user_id = auth.uid());

CREATE POLICY rls_users_write_administrative ON users FOR ALL
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type)
    WITH CHECK (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type);

-- ════════════════════════════════════════════════════════════
-- STUDENTS
-- ════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS rls_students_read_own           ON students;
DROP POLICY IF EXISTS rls_students_read_parent        ON students;
DROP POLICY IF EXISTS rls_students_read_staff         ON students;
DROP POLICY IF EXISTS rls_students_read_waka          ON students;
DROP POLICY IF EXISTS rls_students_read_administrative ON students;
DROP POLICY IF EXISTS rls_students_read_dudi          ON students;
DROP POLICY IF EXISTS rls_students_write_admin        ON students;
DROP POLICY IF EXISTS rls_students_write_administrative ON students;

CREATE POLICY rls_students_read_own ON students FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'SISWA'::role_type
        AND user_id = fn_current_user_id());

CREATE POLICY rls_students_read_parent ON students FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ORTU'::role_type
        AND EXISTS (SELECT 1 FROM student_parents sp
            WHERE sp.student_id = students.student_id
              AND sp.parent_user_id = fn_current_user_id()));

CREATE POLICY rls_students_read_staff ON students FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['GURU','BK','WALI_KELAS','KAPRODI','KEPSEK']::role_type[]));

CREATE POLICY rls_students_read_waka ON students FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['WAKA_KURIKULUM','WAKA_KESISWAAN']::role_type[]));

CREATE POLICY rls_students_read_administrative ON students FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type);

CREATE POLICY rls_students_read_dudi ON students FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'DUDI'::role_type
        AND fn_dudi_supervises_student(student_id));

CREATE POLICY rls_students_write_admin ON students FOR ALL
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['KEPSEK','KAPRODI']::role_type[]))
    WITH CHECK (school_id = fn_current_school_id());

CREATE POLICY rls_students_write_administrative ON students FOR ALL
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type)
    WITH CHECK (school_id = fn_current_school_id());

-- ════════════════════════════════════════════════════════════
-- CLASSES
-- ════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS rls_classes_read_all   ON classes;
DROP POLICY IF EXISTS rls_classes_write_admin ON classes;

CREATE POLICY rls_classes_read_all ON classes FOR SELECT
    USING (school_id = fn_current_school_id() AND auth.uid() IS NOT NULL);

CREATE POLICY rls_classes_write_admin ON classes FOR ALL
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type)
    WITH CHECK (school_id = fn_current_school_id());

-- ════════════════════════════════════════════════════════════
-- PROGRAMS
-- ════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS rls_programs_read_all   ON programs;
DROP POLICY IF EXISTS rls_programs_write_admin ON programs;

CREATE POLICY rls_programs_read_all ON programs FOR SELECT
    USING (school_id = fn_current_school_id() AND auth.uid() IS NOT NULL);

CREATE POLICY rls_programs_write_admin ON programs FOR ALL
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['KEPSEK','KAPRODI','ADMINISTRATIVE']::role_type[]))
    WITH CHECK (school_id = fn_current_school_id());

-- ════════════════════════════════════════════════════════════
-- SUBJECTS
-- ════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS rls_subjects_read_all   ON subjects;
DROP POLICY IF EXISTS rls_subjects_write_admin ON subjects;

CREATE POLICY rls_subjects_read_all ON subjects FOR SELECT
    USING (school_id = fn_current_school_id() AND auth.uid() IS NOT NULL);

CREATE POLICY rls_subjects_write_admin ON subjects FOR ALL
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['KEPSEK','KAPRODI']::role_type[]))
    WITH CHECK (school_id = fn_current_school_id());

-- ════════════════════════════════════════════════════════════
-- ACADEMIC_PERIODS
-- ════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS rls_academic_periods_read_all              ON academic_periods;
DROP POLICY IF EXISTS rls_academic_periods_insert_administrative  ON academic_periods;
DROP POLICY IF EXISTS rls_academic_periods_update_administrative  ON academic_periods;

CREATE POLICY rls_academic_periods_read_all ON academic_periods FOR SELECT
    USING (school_id = fn_current_school_id() AND auth.uid() IS NOT NULL);

CREATE POLICY rls_academic_periods_insert_administrative ON academic_periods FOR INSERT
    WITH CHECK (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type);

CREATE POLICY rls_academic_periods_update_administrative ON academic_periods FOR UPDATE
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type);

-- ════════════════════════════════════════════════════════════
-- SCHOOL_CONFIG
-- ════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS rls_school_config_read_all    ON school_config;
DROP POLICY IF EXISTS rls_school_config_write_admin ON school_config;

CREATE POLICY rls_school_config_read_all ON school_config FOR SELECT
    USING (school_id = fn_current_school_id() AND auth.uid() IS NOT NULL);

CREATE POLICY rls_school_config_write_admin ON school_config FOR ALL
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['ADMINISTRATIVE','KEPSEK']::role_type[]))
    WITH CHECK (school_id = fn_current_school_id());

-- ════════════════════════════════════════════════════════════
-- CLASS_ENROLLMENTS
-- ════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS rls_enrollments_read_staff          ON class_enrollments;
DROP POLICY IF EXISTS rls_enrollments_read_waka           ON class_enrollments;
DROP POLICY IF EXISTS rls_enrollments_read_student        ON class_enrollments;
DROP POLICY IF EXISTS rls_enrollments_read_parent         ON class_enrollments;
DROP POLICY IF EXISTS rls_enrollments_write_admin         ON class_enrollments;
DROP POLICY IF EXISTS rls_enrollments_write_administrative ON class_enrollments;

CREATE POLICY rls_enrollments_read_staff ON class_enrollments FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['GURU','BK','WALI_KELAS','KAPRODI','KEPSEK']::role_type[]));

CREATE POLICY rls_enrollments_read_waka ON class_enrollments FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['WAKA_KURIKULUM','WAKA_KESISWAAN']::role_type[]));

CREATE POLICY rls_enrollments_read_student ON class_enrollments FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'SISWA'::role_type
        AND student_id = fn_current_student_id());

CREATE POLICY rls_enrollments_read_parent ON class_enrollments FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ORTU'::role_type
        AND EXISTS (SELECT 1 FROM student_parents sp
            WHERE sp.student_id = class_enrollments.student_id
              AND sp.parent_user_id = fn_current_user_id()));

CREATE POLICY rls_enrollments_write_admin ON class_enrollments FOR ALL
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['KAPRODI','KEPSEK']::role_type[]))
    WITH CHECK (school_id = fn_current_school_id());

CREATE POLICY rls_enrollments_write_administrative ON class_enrollments FOR ALL
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type)
    WITH CHECK (school_id = fn_current_school_id());

-- ════════════════════════════════════════════════════════════
-- TEACHING_ASSIGNMENTS
-- ════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS rls_assignments_read_all_staff     ON teaching_assignments;
DROP POLICY IF EXISTS rls_assignments_read_waka          ON teaching_assignments;
DROP POLICY IF EXISTS rls_assignments_read_administrative ON teaching_assignments;
DROP POLICY IF EXISTS rls_assignments_write_admin        ON teaching_assignments;
DROP POLICY IF EXISTS rls_assignments_write_administrative ON teaching_assignments;

CREATE POLICY rls_assignments_read_all_staff ON teaching_assignments FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['GURU','BK','WALI_KELAS','KAPRODI','KEPSEK']::role_type[]));

CREATE POLICY rls_assignments_read_waka ON teaching_assignments FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['WAKA_KURIKULUM','WAKA_KESISWAAN']::role_type[]));

CREATE POLICY rls_assignments_read_administrative ON teaching_assignments FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type);

CREATE POLICY rls_assignments_write_admin ON teaching_assignments FOR ALL
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['KAPRODI','KEPSEK']::role_type[]))
    WITH CHECK (school_id = fn_current_school_id());

CREATE POLICY rls_assignments_write_administrative ON teaching_assignments FOR ALL
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type)
    WITH CHECK (school_id = fn_current_school_id());

-- ════════════════════════════════════════════════════════════
-- TEACHING_SCHEDULES
-- ════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS rls_schedules_read_staff          ON teaching_schedules;
DROP POLICY IF EXISTS rls_schedules_read_waka           ON teaching_schedules;
DROP POLICY IF EXISTS rls_schedules_read_student        ON teaching_schedules;
DROP POLICY IF EXISTS rls_schedules_read_parent         ON teaching_schedules;
DROP POLICY IF EXISTS rls_schedules_read_administrative ON teaching_schedules;
DROP POLICY IF EXISTS rls_schedules_write_admin         ON teaching_schedules;
DROP POLICY IF EXISTS rls_schedules_write_administrative ON teaching_schedules;

CREATE POLICY rls_schedules_read_staff ON teaching_schedules FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['GURU','BK','WALI_KELAS','KAPRODI','KEPSEK']::role_type[]));

CREATE POLICY rls_schedules_read_waka ON teaching_schedules FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['WAKA_KURIKULUM','WAKA_KESISWAAN']::role_type[]));

CREATE POLICY rls_schedules_read_student ON teaching_schedules FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'SISWA'::role_type
        AND EXISTS (SELECT 1 FROM class_enrollments ce
            WHERE ce.class_id = teaching_schedules.class_id
              AND ce.student_id = fn_current_student_id()
              AND ce.withdrawn_at IS NULL));

CREATE POLICY rls_schedules_read_parent ON teaching_schedules FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ORTU'::role_type
        AND EXISTS (SELECT 1 FROM class_enrollments ce
            JOIN student_parents sp ON sp.student_id = ce.student_id
            WHERE ce.class_id = teaching_schedules.class_id
              AND ce.withdrawn_at IS NULL
              AND sp.parent_user_id = fn_current_user_id()));

CREATE POLICY rls_schedules_read_administrative ON teaching_schedules FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type);

CREATE POLICY rls_schedules_write_admin ON teaching_schedules FOR ALL
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['KAPRODI','KEPSEK']::role_type[]))
    WITH CHECK (school_id = fn_current_school_id());

CREATE POLICY rls_schedules_write_administrative ON teaching_schedules FOR ALL
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type)
    WITH CHECK (school_id = fn_current_school_id());

-- ════════════════════════════════════════════════════════════
-- ATTENDANCE
-- ════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS rls_attendance_rw_guru            ON attendance;
DROP POLICY IF EXISTS rls_attendance_rw_substitute      ON attendance;
DROP POLICY IF EXISTS rls_attendance_read_staff         ON attendance;
DROP POLICY IF EXISTS rls_attendance_read_waka          ON attendance;
DROP POLICY IF EXISTS rls_attendance_read_wali          ON attendance;
DROP POLICY IF EXISTS rls_attendance_read_student       ON attendance;
DROP POLICY IF EXISTS rls_attendance_read_parent        ON attendance;
DROP POLICY IF EXISTS rls_attendance_delete_administrative ON attendance;

CREATE POLICY rls_attendance_rw_guru ON attendance FOR ALL
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['GURU','WALI_KELAS']::role_type[])
        AND EXISTS (SELECT 1 FROM teaching_schedules ts
            JOIN teaching_assignments ta ON ta.assignment_id = ts.assignment_id
            WHERE ts.schedule_id = attendance.schedule_id
              AND ta.user_id = fn_current_user_id()
              AND ta.is_active = true))
    WITH CHECK (school_id = fn_current_school_id());

CREATE POLICY rls_attendance_rw_substitute ON attendance FOR ALL
    USING (school_id = fn_current_school_id()
        AND EXISTS (SELECT 1 FROM substitute_schedules ss
            WHERE ss.schedule_id = attendance.schedule_id
              AND ss.substitute_user_id = fn_current_user_id()
              AND ss.sync_token_expires_at > now()))
    WITH CHECK (school_id = fn_current_school_id());

CREATE POLICY rls_attendance_read_staff ON attendance FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['BK','WALI_KELAS','KAPRODI','KEPSEK']::role_type[]));

CREATE POLICY rls_attendance_read_waka ON attendance FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['WAKA_KURIKULUM','WAKA_KESISWAAN']::role_type[]));

CREATE POLICY rls_attendance_read_wali ON attendance FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_wali_kelas_class_id() IS NOT NULL
        AND is_void = false
        AND EXISTS (SELECT 1 FROM class_enrollments ce
            WHERE ce.student_id = attendance.student_id
              AND ce.class_id = fn_wali_kelas_class_id()
              AND ce.withdrawn_at IS NULL));

CREATE POLICY rls_attendance_read_student ON attendance FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'SISWA'::role_type
        AND student_id = (SELECT s.student_id FROM students s WHERE s.user_id = fn_current_user_id())
        AND is_void = false);

CREATE POLICY rls_attendance_read_parent ON attendance FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ORTU'::role_type
        AND is_void = false
        AND EXISTS (SELECT 1 FROM student_parents sp
            WHERE sp.student_id = attendance.student_id
              AND sp.parent_user_id = fn_current_user_id()));

CREATE POLICY rls_attendance_delete_administrative ON attendance FOR DELETE
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type);

-- ════════════════════════════════════════════════════════════
-- OBSERVATIONS
-- ════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS rls_observations_write              ON observations;
DROP POLICY IF EXISTS rls_observations_write_dudi         ON observations;
DROP POLICY IF EXISTS rls_observations_write_waka_kesiswaan ON observations;
DROP POLICY IF EXISTS rls_observations_read_staff         ON observations;
DROP POLICY IF EXISTS rls_observations_read_waka          ON observations;
DROP POLICY IF EXISTS rls_observations_read_student       ON observations;
DROP POLICY IF EXISTS rls_observations_read_parent        ON observations;
DROP POLICY IF EXISTS rls_observations_read_dudi_own      ON observations;
DROP POLICY IF EXISTS rls_observations_delete_administrative ON observations;

CREATE POLICY rls_observations_write ON observations FOR INSERT
    WITH CHECK (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['GURU','BK','WALI_KELAS','KAPRODI','KEPSEK']::role_type[]));

CREATE POLICY rls_observations_write_dudi ON observations FOR INSERT
    WITH CHECK (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'DUDI'::role_type);

CREATE POLICY rls_observations_write_waka_kesiswaan ON observations FOR INSERT
    WITH CHECK (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'WAKA_KESISWAAN'::role_type);

CREATE POLICY rls_observations_read_staff ON observations FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['GURU','BK','WALI_KELAS','KAPRODI','KEPSEK']::role_type[]));

CREATE POLICY rls_observations_read_waka ON observations FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['WAKA_KURIKULUM','WAKA_KESISWAAN']::role_type[]));

CREATE POLICY rls_observations_read_student ON observations FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'SISWA'::role_type
        AND visibility = 'STUDENT_VISIBLE'::visibility_level
        AND student_id = (SELECT s.student_id FROM students s WHERE s.user_id = fn_current_user_id()));

CREATE POLICY rls_observations_read_parent ON observations FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ORTU'::role_type
        AND visibility = 'STUDENT_VISIBLE'::visibility_level
        AND EXISTS (SELECT 1 FROM student_parents sp
            WHERE sp.student_id = observations.student_id
              AND sp.parent_user_id = fn_current_user_id()));

CREATE POLICY rls_observations_read_dudi_own ON observations FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'DUDI'::role_type
        AND author_user_id = fn_current_user_id());

CREATE POLICY rls_observations_delete_administrative ON observations FOR DELETE
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type);

-- ════════════════════════════════════════════════════════════
-- CASES & CASE_EVENTS
-- ════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS rls_cases_insert            ON cases;
DROP POLICY IF EXISTS rls_cases_read_admin        ON cases;
DROP POLICY IF EXISTS rls_cases_read_guru         ON cases;
DROP POLICY IF EXISTS rls_cases_read_dudi         ON cases;
DROP POLICY IF EXISTS rls_cases_read_student      ON cases;
DROP POLICY IF EXISTS rls_cases_update_sync       ON cases;
DROP POLICY IF EXISTS rls_cases_delete_administrative ON cases;

CREATE POLICY rls_cases_insert ON cases FOR INSERT
    WITH CHECK (school_id = fn_current_school_id());

CREATE POLICY rls_cases_read_admin ON cases FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['BK','WALI_KELAS','KAPRODI','KEPSEK']::role_type[]));

CREATE POLICY rls_cases_read_guru ON cases FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['GURU','WALI_KELAS']::role_type[])
        AND (fn_involved_in_case(case_id) OR EXISTS (
            SELECT 1 FROM class_enrollments ce
            JOIN teaching_assignments ta ON ta.class_id = ce.class_id
            WHERE ce.student_id = cases.student_id
              AND ta.user_id = fn_current_user_id()
              AND ta.is_active = true
              AND ce.withdrawn_at IS NULL)));

CREATE POLICY rls_cases_read_dudi ON cases FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'DUDI'::role_type
        AND fn_dudi_supervises_student(student_id));

CREATE POLICY rls_cases_read_student ON cases FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'SISWA'::role_type
        AND student_id = (SELECT s.student_id FROM students s WHERE s.user_id = fn_current_user_id()));

CREATE POLICY rls_cases_update_sync ON cases FOR UPDATE
    USING (school_id = fn_current_school_id()
        AND ((fn_current_user_role() = current_handler_role)
          OR (fn_current_user_role() = 'KEPSEK'::role_type AND status <> 'CLOSED'::case_status)
          OR (current_setting('app.case_sync_active', true) = 'true')));

CREATE POLICY rls_cases_delete_administrative ON cases FOR DELETE
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type);

DROP POLICY IF EXISTS rls_case_events_insert_handler       ON case_events;
DROP POLICY IF EXISTS rls_case_events_insert_kepsek        ON case_events;
DROP POLICY IF EXISTS rls_case_events_read_staff           ON case_events;
DROP POLICY IF EXISTS rls_case_events_read_student         ON case_events;
DROP POLICY IF EXISTS rls_case_events_delete_administrative ON case_events;

CREATE POLICY rls_case_events_insert_handler ON case_events FOR INSERT
    WITH CHECK (school_id = fn_current_school_id());

CREATE POLICY rls_case_events_insert_kepsek ON case_events FOR INSERT
    WITH CHECK (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'KEPSEK'::role_type);

CREATE POLICY rls_case_events_read_staff ON case_events FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['GURU','BK','WALI_KELAS','KAPRODI','KEPSEK','DUDI']::role_type[])
        AND EXISTS (SELECT 1 FROM cases c WHERE c.case_id = case_events.case_id));

CREATE POLICY rls_case_events_read_student ON case_events FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'SISWA'::role_type
        AND privacy_level = 'STUDENT_VISIBLE'::visibility_level
        AND EXISTS (SELECT 1 FROM cases c
            WHERE c.case_id = case_events.case_id
              AND c.student_id = (SELECT s.student_id FROM students s WHERE s.user_id = fn_current_user_id())));

CREATE POLICY rls_case_events_delete_administrative ON case_events FOR DELETE
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type);

-- ════════════════════════════════════════════════════════════
-- ACHIEVEMENTS
-- ════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS rls_achievements_write       ON achievements;
DROP POLICY IF EXISTS rls_achievements_read_staff  ON achievements;
DROP POLICY IF EXISTS rls_achievements_read_student ON achievements;
DROP POLICY IF EXISTS rls_achievements_void        ON achievements;

CREATE POLICY rls_achievements_write ON achievements FOR INSERT
    WITH CHECK (school_id = fn_current_school_id());

CREATE POLICY rls_achievements_read_staff ON achievements FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['GURU','BK','WALI_KELAS','KAPRODI','KEPSEK']::role_type[]));

CREATE POLICY rls_achievements_read_student ON achievements FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'SISWA'::role_type
        AND is_voided = false
        AND student_id = (SELECT s.student_id FROM students s WHERE s.user_id = fn_current_user_id()));

CREATE POLICY rls_achievements_void ON achievements FOR UPDATE
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['KAPRODI','KEPSEK']::role_type[]));

-- ════════════════════════════════════════════════════════════
-- STUDENT_PARENTS
-- ════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS rls_student_parents_read_own           ON student_parents;
DROP POLICY IF EXISTS rls_student_parents_read_staff         ON student_parents;
DROP POLICY IF EXISTS rls_student_parents_write_administrative ON student_parents;

CREATE POLICY rls_student_parents_read_own ON student_parents FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ORTU'::role_type
        AND parent_user_id = fn_current_user_id());

CREATE POLICY rls_student_parents_read_staff ON student_parents FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['GURU','BK','WALI_KELAS','KAPRODI','KEPSEK']::role_type[]));

CREATE POLICY rls_student_parents_write_administrative ON student_parents FOR ALL
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type)
    WITH CHECK (school_id = fn_current_school_id());

-- ════════════════════════════════════════════════════════════
-- PARENT_MESSAGES
-- ════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS rls_parent_msg_insert_ortu        ON parent_messages;
DROP POLICY IF EXISTS rls_parent_msg_reply_staff        ON parent_messages;
DROP POLICY IF EXISTS rls_parent_msg_read               ON parent_messages;
DROP POLICY IF EXISTS rls_parent_msg_delete_administrative ON parent_messages;

CREATE POLICY rls_parent_msg_insert_ortu ON parent_messages FOR INSERT
    WITH CHECK (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ORTU'::role_type);

CREATE POLICY rls_parent_msg_reply_staff ON parent_messages FOR INSERT
    WITH CHECK (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['BK','WALI_KELAS','KEPSEK']::role_type[]));

CREATE POLICY rls_parent_msg_read ON parent_messages FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_id() = ANY (visible_to_user_ids));

CREATE POLICY rls_parent_msg_delete_administrative ON parent_messages FOR DELETE
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type);

-- ════════════════════════════════════════════════════════════
-- PKL_PLACEMENTS & PKL_ATTENDANCE
-- ════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS rls_pkl_read_staff           ON pkl_placements;
DROP POLICY IF EXISTS rls_pkl_read_dudi            ON pkl_placements;
DROP POLICY IF EXISTS rls_pkl_read_student         ON pkl_placements;
DROP POLICY IF EXISTS rls_pkl_write_admin          ON pkl_placements;
DROP POLICY IF EXISTS rls_pkl_write_administrative ON pkl_placements;

CREATE POLICY rls_pkl_read_staff ON pkl_placements FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['GURU','BK','WALI_KELAS','KAPRODI','KEPSEK']::role_type[]));

CREATE POLICY rls_pkl_read_dudi ON pkl_placements FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'DUDI'::role_type
        AND dudi_user_id = fn_current_user_id());

CREATE POLICY rls_pkl_read_student ON pkl_placements FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'SISWA'::role_type
        AND student_id = fn_current_student_id());

CREATE POLICY rls_pkl_write_admin ON pkl_placements FOR ALL
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['KAPRODI','KEPSEK']::role_type[]))
    WITH CHECK (school_id = fn_current_school_id());

CREATE POLICY rls_pkl_write_administrative ON pkl_placements FOR ALL
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type)
    WITH CHECK (school_id = fn_current_school_id());

DROP POLICY IF EXISTS rls_pkl_attendance_read_staff   ON pkl_attendance;
DROP POLICY IF EXISTS rls_pkl_attendance_read_student ON pkl_attendance;
DROP POLICY IF EXISTS rls_pkl_attendance_rw_dudi      ON pkl_attendance;
DROP POLICY IF EXISTS rls_pkl_attendance_delete_administrative ON pkl_attendance;

CREATE POLICY rls_pkl_attendance_read_staff ON pkl_attendance FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['GURU','BK','WALI_KELAS','KAPRODI','KEPSEK','WAKA_KESISWAAN']::role_type[]));

CREATE POLICY rls_pkl_attendance_read_student ON pkl_attendance FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'SISWA'::role_type
        AND student_id = fn_current_student_id());

CREATE POLICY rls_pkl_attendance_rw_dudi ON pkl_attendance FOR ALL
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'DUDI'::role_type
        AND fn_dudi_supervises_student(student_id))
    WITH CHECK (school_id = fn_current_school_id());

CREATE POLICY rls_pkl_attendance_delete_administrative ON pkl_attendance FOR DELETE
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type);

-- ════════════════════════════════════════════════════════════
-- SCHEDULE_TEMPLATES & TIME_SLOTS
-- ════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS rls_schedule_templates_read_staff          ON schedule_templates;
DROP POLICY IF EXISTS rls_schedule_templates_write_administrative ON schedule_templates;

CREATE POLICY rls_schedule_templates_read_staff ON schedule_templates FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['GURU','BK','WALI_KELAS','KAPRODI','KEPSEK']::role_type[]));

CREATE POLICY rls_schedule_templates_write_administrative ON schedule_templates FOR ALL
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type)
    WITH CHECK (school_id = fn_current_school_id());

DROP POLICY IF EXISTS rls_time_slots_read  ON schedule_time_slots;
DROP POLICY IF EXISTS rls_time_slots_write ON schedule_time_slots;

CREATE POLICY rls_time_slots_read ON schedule_time_slots FOR SELECT
    USING (school_id = fn_current_school_id());

CREATE POLICY rls_time_slots_write ON schedule_time_slots FOR ALL
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type)
    WITH CHECK (school_id = fn_current_school_id());

-- ════════════════════════════════════════════════════════════
-- SUBSTITUTE_SCHEDULES
-- ════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS rls_substitute_read_own        ON substitute_schedules;
DROP POLICY IF EXISTS rls_substitute_write_admin     ON substitute_schedules;
DROP POLICY IF EXISTS rls_substitute_write_administrative ON substitute_schedules;

CREATE POLICY rls_substitute_read_own ON substitute_schedules FOR SELECT
    USING (school_id = fn_current_school_id()
        AND substitute_user_id = fn_current_user_id());

CREATE POLICY rls_substitute_write_admin ON substitute_schedules FOR ALL
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['KAPRODI','KEPSEK']::role_type[]))
    WITH CHECK (school_id = fn_current_school_id());

CREATE POLICY rls_substitute_write_administrative ON substitute_schedules FOR ALL
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type)
    WITH CHECK (school_id = fn_current_school_id());

-- ════════════════════════════════════════════════════════════
-- TEACHER_JOURNALS, TEACHER_ATTENDANCE_LOG, STUDENT_UPDATES
-- ════════════════════════════════════════════════════════════
DROP POLICY IF EXISTS rls_journals_owner ON teacher_journals;

CREATE POLICY rls_journals_owner ON teacher_journals FOR ALL
    USING (school_id = fn_current_school_id()
        AND owner_user_id = fn_current_user_id())
    WITH CHECK (school_id = fn_current_school_id());

DROP POLICY IF EXISTS rls_teacher_att_log_read_own ON teacher_attendance_log;

CREATE POLICY rls_teacher_att_log_read_own ON teacher_attendance_log FOR SELECT
    USING (school_id = fn_current_school_id()
        AND (user_id = fn_current_user_id()
          OR fn_current_user_role() = 'KEPSEK'::role_type));

DROP POLICY IF EXISTS rls_student_updates_insert    ON student_updates;
DROP POLICY IF EXISTS rls_student_updates_read_staff ON student_updates;
DROP POLICY IF EXISTS rls_student_updates_read_student ON student_updates;

CREATE POLICY rls_student_updates_insert ON student_updates FOR INSERT
    WITH CHECK (school_id = fn_current_school_id());

CREATE POLICY rls_student_updates_read_staff ON student_updates FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['GURU','BK','WALI_KELAS','KAPRODI','KEPSEK','DUDI']::role_type[]));

CREATE POLICY rls_student_updates_read_student ON student_updates FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'SISWA'::role_type
        AND EXISTS (SELECT 1 FROM cases c
            WHERE c.case_id = student_updates.case_id
              AND c.student_id = (SELECT s.student_id FROM students s WHERE s.user_id = fn_current_user_id())));
