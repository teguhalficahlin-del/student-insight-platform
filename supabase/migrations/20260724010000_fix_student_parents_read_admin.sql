-- fix: ADMINISTRATIVE tidak bisa baca student_parents via SELECT
-- Root cause: rls_student_parents_write_administrative hanya FOR ALL (write),
-- tidak ada policy SELECT untuk ADMINISTRATIVE.
-- Akibat: fetchAllRows('student_parents') mengembalikan 0 baris →
-- childMap kosong → semua ortu jatuh ke "Tanpa Kelas" di dashboard admin.
CREATE POLICY rls_student_parents_read_administrative ON student_parents
    FOR SELECT
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'
    );
