-- ============================================================
-- Migration: 20260630180000_student_read_schedules_pkl.sql
-- Buka akses BACA (SELECT) untuk role SISWA ke data yang
-- dibutuhkan Portal Siswa (/student/) tapi belum punya policy
-- self-scoped: teaching_schedules, class_enrollments,
-- pkl_placements, pkl_attendance.
--
-- LATAR BELAKANG
-- contracts/06_rls_policies.sql sudah memberi SISWA akses baca
-- ke records dirinya pada:
--   * students        — rls_students_read_own
--   * attendance      — rls_attendance_read_student
--   * observations    — rls_observations_read_student (STUDENT_VISIBLE)
-- dan tabel referensi (programs/subjects/classes/school_config)
-- terbuka untuk semua user terautentikasi.
--
-- Namun tab "Jadwal Hari Ini" dan "Status PKL" pada Portal Siswa
-- butuh membaca teaching_schedules + class_enrollments (untuk
-- resolusi kelas) dan pkl_placements + pkl_attendance. Tabel-tabel
-- itu sebelum migrasi ini hanya punya policy staf/DUDI, sehingga
-- RLS menolak SISWA secara default → query mengembalikan kosong.
--
-- POLA
-- Sama persis dengan rls_attendance_read_student: cakupan
-- diresolusikan via students.user_id = fn_current_user_id().
-- Helper fn_current_student_id() dibuat agar policy ringkas dan
-- konsisten (mirror fn_current_user_id / fn_wali_kelas_class_id).
--
-- CATATAN VISIBILITAS
-- Hanya BACA, scoped ke siswa itu sendiri. Tidak ada akses tulis
-- yang ditambahkan. Tidak menyentuh observasi INTERNAL_SCHOOL.
-- ============================================================

-- ── Helper: student_id milik user yang sedang login ──────────
CREATE OR REPLACE FUNCTION fn_current_student_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT student_id FROM students WHERE user_id = fn_current_user_id();
$$;

GRANT EXECUTE ON FUNCTION fn_current_student_id TO authenticated;

COMMENT ON FUNCTION fn_current_student_id IS
    'student_id yang tertaut ke user SISWA yang sedang login '
    '(students.user_id = fn_current_user_id()). NULL jika bukan siswa '
    'atau akun belum tertaut ke data siswa.';


-- ── CLASS_ENROLLMENTS: siswa membaca enrollment dirinya ──────
-- Dipakai Portal Siswa untuk resolusi kelas (class_id) pada tahun
-- ajaran berjalan sebelum mengambil jadwal.
DROP POLICY IF EXISTS rls_enrollments_read_student ON class_enrollments;

CREATE POLICY rls_enrollments_read_student ON class_enrollments
    FOR SELECT USING (
        fn_current_user_role() = 'SISWA'
        AND student_id = fn_current_student_id()
    );


-- ── TEACHING_SCHEDULES: siswa membaca jadwal kelasnya ────────
-- Siswa hanya boleh melihat jadwal untuk kelas yang ia ikuti
-- (enrollment aktif / belum withdrawn). Tidak melihat jadwal
-- kelas lain.
DROP POLICY IF EXISTS rls_schedules_read_student ON teaching_schedules;

CREATE POLICY rls_schedules_read_student ON teaching_schedules
    FOR SELECT USING (
        fn_current_user_role() = 'SISWA'
        AND EXISTS (
            SELECT 1 FROM class_enrollments ce
            WHERE ce.class_id      = teaching_schedules.class_id
              AND ce.student_id    = fn_current_student_id()
              AND ce.withdrawn_at IS NULL
        )
    );


-- ── PKL_PLACEMENTS: siswa membaca penempatan PKL dirinya ─────
DROP POLICY IF EXISTS rls_pkl_read_student ON pkl_placements;

CREATE POLICY rls_pkl_read_student ON pkl_placements
    FOR SELECT USING (
        fn_current_user_role() = 'SISWA'
        AND student_id = fn_current_student_id()
    );


-- ── PKL_ATTENDANCE: siswa membaca absensi PKL dirinya ────────
-- student_id sudah didenormalkan di pkl_attendance (lihat migrasi
-- 20260630130000_pkl_attendance.sql), jadi filter langsung.
DROP POLICY IF EXISTS rls_pkl_attendance_read_student ON pkl_attendance;

CREATE POLICY rls_pkl_attendance_read_student ON pkl_attendance
    FOR SELECT USING (
        fn_current_user_role() = 'SISWA'
        AND student_id = fn_current_student_id()
    );
