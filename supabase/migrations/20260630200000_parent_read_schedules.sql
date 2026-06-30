-- ============================================================
-- Migration: 20260630200000_parent_read_schedules.sql
-- Buka akses BACA (SELECT) untuk role ORTU ke class_enrollments
-- dan teaching_schedules anak yang tertaut lewat student_parents.
--
-- LATAR BELAKANG (memperbaiki bug + fitur baru)
-- contracts/06_rls_policies.sql memberi ORTU baca students/attendance/
-- observations milik anaknya, TAPI tidak pernah memberi ORTU baca
-- class_enrollments maupun teaching_schedules. Akibatnya:
--   * fetchChildren (parent/js/api.js) meng-embed class_enrollments →
--     nama kelas selalu kosong ("-") untuk orang tua.
--   * fetchAttendance memulai query dari teaching_schedules (lalu
--     attendance!inner) → karena teaching_schedules ditolak RLS untuk
--     ORTU, SEMUA baris hilang → section "Kehadiran" diam-diam kosong.
-- Migrasi ini memperbaiki kedua hal itu sekaligus mengaktifkan fitur
-- baru "Jadwal Anak" di portal orang tua.
--
-- POLA
-- Cakupan diresolusikan via student_parents (parent_user_id =
-- fn_current_user_id()), sama persis dengan rls_attendance_read_parent
-- dan rls_students_read_parent. Mirror dari pasangan SISWA di migrasi
-- 20260630180000. Hanya BACA, scoped ke anak yang tertaut.
-- ============================================================

-- ── CLASS_ENROLLMENTS: orang tua membaca enrollment anaknya ──
DROP POLICY IF EXISTS rls_enrollments_read_parent ON class_enrollments;

CREATE POLICY rls_enrollments_read_parent ON class_enrollments
    FOR SELECT USING (
        fn_current_user_role() = 'ORTU'
        AND EXISTS (
            SELECT 1 FROM student_parents sp
            WHERE sp.student_id     = class_enrollments.student_id
              AND sp.parent_user_id = fn_current_user_id()
        )
    );


-- ── TEACHING_SCHEDULES: orang tua membaca jadwal kelas anaknya ──
-- Hanya jadwal untuk kelas yang anaknya ikuti (enrollment aktif).
DROP POLICY IF EXISTS rls_schedules_read_parent ON teaching_schedules;

CREATE POLICY rls_schedules_read_parent ON teaching_schedules
    FOR SELECT USING (
        fn_current_user_role() = 'ORTU'
        AND EXISTS (
            SELECT 1
            FROM class_enrollments ce
            JOIN student_parents sp ON sp.student_id = ce.student_id
            WHERE ce.class_id       = teaching_schedules.class_id
              AND ce.withdrawn_at  IS NULL
              AND sp.parent_user_id = fn_current_user_id()
        )
    );
