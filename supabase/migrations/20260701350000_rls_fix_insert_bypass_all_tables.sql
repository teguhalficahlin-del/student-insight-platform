-- ============================================================
-- FIX (ditemukan saat verifikasi RESIDUAL-1) — celah sekelas M1
-- tapi menyebar di 19 policy FOR ALL di 14 tabel inti.
-- ============================================================
-- Postgres HANYA mengevaluasi WITH CHECK untuk INSERT (USING/qual
-- diabaikan). 19 policy "FOR ALL" di bawah punya USING yang benar
-- (cek peran/kepemilikan) tapi WITH CHECK cuma "school_id = ..." —
-- artinya untuk INSERT, siapa pun user terautentikasi di sekolah
-- yang sama bisa menambah baris baru ke tabel-tabel ini (kelas,
-- jurusan, pengaturan sekolah, penugasan guru, jadwal, dll),
-- terlepas dari perannya. Perbaikan: WITH CHECK disamakan persis
-- dengan USING yang sudah benar (tak ada perubahan wewenang BACA/
-- UBAH/HAPUS — itu semua sudah tepat sebelum migrasi ini).
-- ============================================================

DROP POLICY IF EXISTS rls_attendance_rw_substitute ON attendance;
CREATE POLICY rls_attendance_rw_substitute ON attendance FOR ALL
    USING (school_id = fn_current_school_id()
        AND EXISTS (SELECT 1 FROM substitute_schedules ss
            WHERE ss.schedule_id = attendance.schedule_id
              AND ss.substitute_user_id = fn_current_user_id()
              AND ss.sync_token_expires_at > now()))
    WITH CHECK (school_id = fn_current_school_id()
        AND EXISTS (SELECT 1 FROM substitute_schedules ss
            WHERE ss.schedule_id = attendance.schedule_id
              AND ss.substitute_user_id = fn_current_user_id()
              AND ss.sync_token_expires_at > now()));

DROP POLICY IF EXISTS rls_enrollments_write_administrative ON class_enrollments;
CREATE POLICY rls_enrollments_write_administrative ON class_enrollments FOR ALL
    USING (school_id = fn_current_school_id() AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type)
    WITH CHECK (school_id = fn_current_school_id() AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type);

DROP POLICY IF EXISTS rls_classes_write_admin ON classes;
CREATE POLICY rls_classes_write_admin ON classes FOR ALL
    USING (school_id = fn_current_school_id() AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type)
    WITH CHECK (school_id = fn_current_school_id() AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type);

DROP POLICY IF EXISTS rls_pkl_attendance_rw_dudi ON pkl_attendance;
CREATE POLICY rls_pkl_attendance_rw_dudi ON pkl_attendance FOR ALL
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'DUDI'::role_type
        AND fn_dudi_supervises_student(student_id))
    WITH CHECK (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'DUDI'::role_type
        AND fn_dudi_supervises_student(student_id));

DROP POLICY IF EXISTS rls_pkl_write_administrative ON pkl_placements;
CREATE POLICY rls_pkl_write_administrative ON pkl_placements FOR ALL
    USING (school_id = fn_current_school_id() AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type)
    WITH CHECK (school_id = fn_current_school_id() AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type);

DROP POLICY IF EXISTS rls_programs_write_admin ON programs;
CREATE POLICY rls_programs_write_admin ON programs FOR ALL
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['KEPSEK','KAPRODI','ADMINISTRATIVE']::role_type[]))
    WITH CHECK (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['KEPSEK','KAPRODI','ADMINISTRATIVE']::role_type[]));

DROP POLICY IF EXISTS rls_schedule_templates_write_administrative ON schedule_templates;
CREATE POLICY rls_schedule_templates_write_administrative ON schedule_templates FOR ALL
    USING (school_id = fn_current_school_id() AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type)
    WITH CHECK (school_id = fn_current_school_id() AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type);

DROP POLICY IF EXISTS rls_time_slots_write ON schedule_time_slots;
CREATE POLICY rls_time_slots_write ON schedule_time_slots FOR ALL
    USING (school_id = fn_current_school_id() AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type)
    WITH CHECK (school_id = fn_current_school_id() AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type);

DROP POLICY IF EXISTS rls_school_config_write_admin ON school_config;
CREATE POLICY rls_school_config_write_admin ON school_config FOR ALL
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['ADMINISTRATIVE','KEPSEK']::role_type[]))
    WITH CHECK (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['ADMINISTRATIVE','KEPSEK']::role_type[]));

DROP POLICY IF EXISTS rls_student_parents_write_administrative ON student_parents;
CREATE POLICY rls_student_parents_write_administrative ON student_parents FOR ALL
    USING (school_id = fn_current_school_id() AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type)
    WITH CHECK (school_id = fn_current_school_id() AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type);

DROP POLICY IF EXISTS rls_students_write_administrative ON students;
CREATE POLICY rls_students_write_administrative ON students FOR ALL
    USING (school_id = fn_current_school_id() AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type)
    WITH CHECK (school_id = fn_current_school_id() AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type);

DROP POLICY IF EXISTS rls_subjects_write_admin ON subjects;
CREATE POLICY rls_subjects_write_admin ON subjects FOR ALL
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['KEPSEK','KAPRODI']::role_type[]))
    WITH CHECK (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['KEPSEK','KAPRODI']::role_type[]));

DROP POLICY IF EXISTS rls_substitute_write_admin ON substitute_schedules;
CREATE POLICY rls_substitute_write_admin ON substitute_schedules FOR ALL
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['KAPRODI','KEPSEK']::role_type[]))
    WITH CHECK (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['KAPRODI','KEPSEK']::role_type[]));

DROP POLICY IF EXISTS rls_substitute_write_administrative ON substitute_schedules;
CREATE POLICY rls_substitute_write_administrative ON substitute_schedules FOR ALL
    USING (school_id = fn_current_school_id() AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type)
    WITH CHECK (school_id = fn_current_school_id() AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type);

DROP POLICY IF EXISTS rls_journals_owner ON teacher_journals;
CREATE POLICY rls_journals_owner ON teacher_journals FOR ALL
    USING (school_id = fn_current_school_id() AND owner_user_id = fn_current_user_id())
    WITH CHECK (school_id = fn_current_school_id() AND owner_user_id = fn_current_user_id());

DROP POLICY IF EXISTS rls_assignments_write_admin ON teaching_assignments;
CREATE POLICY rls_assignments_write_admin ON teaching_assignments FOR ALL
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['KAPRODI','KEPSEK']::role_type[]))
    WITH CHECK (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['KAPRODI','KEPSEK']::role_type[]));

DROP POLICY IF EXISTS rls_assignments_write_administrative ON teaching_assignments;
CREATE POLICY rls_assignments_write_administrative ON teaching_assignments FOR ALL
    USING (school_id = fn_current_school_id() AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type)
    WITH CHECK (school_id = fn_current_school_id() AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type);

DROP POLICY IF EXISTS rls_schedules_write_admin ON teaching_schedules;
CREATE POLICY rls_schedules_write_admin ON teaching_schedules FOR ALL
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['KAPRODI','KEPSEK']::role_type[]))
    WITH CHECK (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['KAPRODI','KEPSEK']::role_type[]));

DROP POLICY IF EXISTS rls_schedules_write_administrative ON teaching_schedules;
CREATE POLICY rls_schedules_write_administrative ON teaching_schedules FOR ALL
    USING (school_id = fn_current_school_id() AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type)
    WITH CHECK (school_id = fn_current_school_id() AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type);
