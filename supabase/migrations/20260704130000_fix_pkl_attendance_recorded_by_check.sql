-- ============================================================
-- Migration 20260704130000: tambah recorded_by guard ke WITH CHECK PKL attendance
-- ROLLBACK:
--   DROP POLICY IF EXISTS rls_pkl_attendance_rw_dudi ON pkl_attendance;
--   CREATE POLICY rls_pkl_attendance_rw_dudi ON pkl_attendance FOR ALL
--       USING (school_id = fn_current_school_id()
--           AND fn_current_user_role() = 'DUDI'::role_type
--           AND fn_dudi_supervises_student(student_id))
--       WITH CHECK (school_id = fn_current_school_id()
--           AND fn_current_user_role() = 'DUDI'::role_type
--           AND fn_dudi_supervises_student(student_id));
-- SNAPSHOT PRA-APPLY: lihat 20260701350000_rls_fix_insert_bypass_all_tables.sql:39-46
-- ============================================================

-- P2-A: WITH CHECK sebelumnya tidak memvalidasi recorded_by_user_id,
-- sehingga pembimbing DUDI bisa menyisipkan baris dengan recorded_by_user_id
-- milik orang lain. Klausa ini memastikan setiap absensi wajib tercatat
-- atas nama pembimbing yang sedang login.

DROP POLICY IF EXISTS rls_pkl_attendance_rw_dudi ON pkl_attendance;
CREATE POLICY rls_pkl_attendance_rw_dudi ON pkl_attendance FOR ALL
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'DUDI'::role_type
        AND fn_dudi_supervises_student(student_id))
    WITH CHECK (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'DUDI'::role_type
        AND fn_dudi_supervises_student(student_id)
        AND recorded_by_user_id = fn_current_user_id());
