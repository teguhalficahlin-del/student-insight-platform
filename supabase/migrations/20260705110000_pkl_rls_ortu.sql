-- ============================================================
-- Migrasi: RLS baca PKL untuk ORTU
--
-- Orang tua perlu melihat penempatan PKL dan absensi PKL anak
-- mereka di portal orang tua (P1-B audit kelengkapan fitur).
--
-- Tabel yang diubah: pkl_placements, pkl_attendance
-- ============================================================

BEGIN;

DROP POLICY IF EXISTS rls_pkl_read_ortu ON pkl_placements;
CREATE POLICY rls_pkl_read_ortu ON pkl_placements
    FOR SELECT USING (
        fn_current_user_role() = 'ORTU'
        AND EXISTS (
            SELECT 1 FROM student_parents sp
            WHERE sp.student_id     = pkl_placements.student_id
              AND sp.parent_user_id = fn_current_user_id()
        )
    );

DROP POLICY IF EXISTS rls_pkl_attendance_read_ortu ON pkl_attendance;
CREATE POLICY rls_pkl_attendance_read_ortu ON pkl_attendance
    FOR SELECT USING (
        fn_current_user_role() = 'ORTU'
        AND EXISTS (
            SELECT 1 FROM student_parents sp
            WHERE sp.student_id     = pkl_attendance.student_id
              AND sp.parent_user_id = fn_current_user_id()
        )
    );

COMMIT;
