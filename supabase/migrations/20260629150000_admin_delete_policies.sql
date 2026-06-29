-- Tambah policy DELETE untuk ADMINISTRATIVE pada tabel-tabel transaksional.
-- Tanpa ini, "Hapus Semua" siswa di wizard gagal karena cascade delete
-- tidak bisa menghapus data dependen (attendance, observations, dll)
-- lewat client-side RLS.

-- ATTENDANCE
DROP POLICY IF EXISTS rls_attendance_delete_administrative ON attendance;
CREATE POLICY rls_attendance_delete_administrative ON attendance
    FOR DELETE USING (fn_current_user_role() = 'ADMINISTRATIVE');

-- OBSERVATIONS
DROP POLICY IF EXISTS rls_observations_delete_administrative ON observations;
CREATE POLICY rls_observations_delete_administrative ON observations
    FOR DELETE USING (fn_current_user_role() = 'ADMINISTRATIVE');

-- CASES
DROP POLICY IF EXISTS rls_cases_delete_administrative ON cases;
CREATE POLICY rls_cases_delete_administrative ON cases
    FOR DELETE USING (fn_current_user_role() = 'ADMINISTRATIVE');

-- CASE_EVENTS
DROP POLICY IF EXISTS rls_case_events_delete_administrative ON case_events;
CREATE POLICY rls_case_events_delete_administrative ON case_events
    FOR DELETE USING (fn_current_user_role() = 'ADMINISTRATIVE');

-- PARENT_MESSAGES
DROP POLICY IF EXISTS rls_parent_msg_delete_administrative ON parent_messages;
CREATE POLICY rls_parent_msg_delete_administrative ON parent_messages
    FOR DELETE USING (fn_current_user_role() = 'ADMINISTRATIVE');
