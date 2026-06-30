-- ============================================================
-- Migration: 20260630210000_rls_audit_fixes_wali_waka_names.sql
-- Perbaikan 3 temuan audit RLS (lihat memory project-rls-audit):
--   F2 — Rekap kehadiran tab Wali Kelas tak lengkap.
--   F3 — Dashboard /guru/ untuk role WAKA_* kosong.
--   F4 — Nama guru/penulis/DUDI tampil "—" untuk SISWA & ORTU.
--
-- AKAR MASALAH
-- Policy read di contracts/06_rls_policies.sql mengunci ke role_type,
-- padahal model "1 login multi-jabatan" menyimpan jabatan sebagai flag
-- (wali_kelas_class_id, is_waka_*) pada baris role_type='GURU', dan
-- enum WAKA_* baru ditambah belakangan (migrasi …110000) tanpa ikut
-- masuk ke array role policy.
--
-- PENDEKATAN: ADITIF (hanya CREATE POLICY permissive baru). Policy RLS
-- di-OR — menambah policy hanya MEMBUKA akses, tak pernah mempersempit.
-- Tidak ada policy lama yang diubah/dihapus → nol risiko regresi.
-- Hanya BACA (SELECT). Tidak ada akses tulis yang ditambahkan.
-- ============================================================

-- ── F2: Wali Kelas baca kehadiran kelas waliannya ────────────
-- Wali = GURU + wali_kelas_class_id (flag), tapi rls_attendance_read_staff
-- minta role_type='WALI_KELAS'. Tanpa policy ini, wali hanya melihat
-- attendance sesi yang ia ajar sendiri (rls_attendance_rw_guru) → rekap
-- per-siswa di tab Wali Kelas kehilangan sesi guru lain. Scope via
-- fn_wali_kelas_class_id() + class_enrollments aktif.
DROP POLICY IF EXISTS rls_attendance_read_wali ON attendance;
CREATE POLICY rls_attendance_read_wali ON attendance
    FOR SELECT USING (
        fn_wali_kelas_class_id() IS NOT NULL
        AND is_void = FALSE
        AND EXISTS (
            SELECT 1 FROM class_enrollments ce
            WHERE ce.student_id   = attendance.student_id
              AND ce.class_id     = fn_wali_kelas_class_id()
              AND ce.withdrawn_at IS NULL
        )
    );


-- ── F3: Waka Kurikulum & Waka Kesiswaan = staf kepemimpinan ──
-- Beri akses baca sekolah-wide setara KEPSEK pada tabel yang dipakai
-- dashboard /guru/. role_type primer WAKA_* sebelumnya tak ada di array
-- read staf mana pun → seluruh tab kosong/—.
DROP POLICY IF EXISTS rls_users_read_waka ON users;
CREATE POLICY rls_users_read_waka ON users
    FOR SELECT USING (fn_current_user_role() IN ('WAKA_KURIKULUM','WAKA_KESISWAAN'));

DROP POLICY IF EXISTS rls_students_read_waka ON students;
CREATE POLICY rls_students_read_waka ON students
    FOR SELECT USING (fn_current_user_role() IN ('WAKA_KURIKULUM','WAKA_KESISWAAN'));

DROP POLICY IF EXISTS rls_observations_read_waka ON observations;
CREATE POLICY rls_observations_read_waka ON observations
    FOR SELECT USING (fn_current_user_role() IN ('WAKA_KURIKULUM','WAKA_KESISWAAN'));

DROP POLICY IF EXISTS rls_attendance_read_waka ON attendance;
CREATE POLICY rls_attendance_read_waka ON attendance
    FOR SELECT USING (fn_current_user_role() IN ('WAKA_KURIKULUM','WAKA_KESISWAAN'));

DROP POLICY IF EXISTS rls_schedules_read_waka ON teaching_schedules;
CREATE POLICY rls_schedules_read_waka ON teaching_schedules
    FOR SELECT USING (fn_current_user_role() IN ('WAKA_KURIKULUM','WAKA_KESISWAAN'));

DROP POLICY IF EXISTS rls_assignments_read_waka ON teaching_assignments;
CREATE POLICY rls_assignments_read_waka ON teaching_assignments
    FOR SELECT USING (fn_current_user_role() IN ('WAKA_KURIKULUM','WAKA_KESISWAAN'));

DROP POLICY IF EXISTS rls_enrollments_read_waka ON class_enrollments;
CREATE POLICY rls_enrollments_read_waka ON class_enrollments
    FOR SELECT USING (fn_current_user_role() IN ('WAKA_KURIKULUM','WAKA_KESISWAAN'));


-- ── F4: SISWA & ORTU baca baris users ber-role staf+DUDI ─────
-- Agar embed teacher:users / author:users / dudi:users terisi (nama
-- guru di jadwal, penulis observasi, nama DUDI di PKL). Hanya baris
-- ber-role staf/DUDI — siswa/ortu TETAP tak bisa melihat baris siswa
-- atau orang tua lain. Setara akses yang DUDI sudah punya ke baris staf.
DROP POLICY IF EXISTS rls_users_read_staff_names ON users;
CREATE POLICY rls_users_read_staff_names ON users
    FOR SELECT USING (
        fn_current_user_role() IN ('SISWA','ORTU')
        AND role_type IN ('GURU','BK','WALI_KELAS','KAPRODI','KEPSEK','WAKA_KURIKULUM','WAKA_KESISWAAN','DUDI')
    );
