-- fix: ADMINISTRATIVE tidak bisa baca class_enrollments
-- Root cause: rls_enrollments_read_staff hanya cover BK/KEPSEK/WAKA via fn_can_see_student
-- fn_is_schoolwide_observer tidak include ADMINISTRATIVE
-- Akibat: dashboard admin panel Orang Tua semua jatuh ke "Tanpa Kelas"
CREATE POLICY rls_enrollments_read_administrative ON class_enrollments
    FOR SELECT
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'
    );
