-- Migration: 20260730120000_rls-staff-names-exists-teaching.sql
-- Ganti policy rls_users_read_staff_names dari whitelist role_type ke
-- EXISTS teaching_schedules — hanya guru yang benar-benar mengajar
-- yang bisa dilihat namanya oleh SISWA dan ORTU.
--
-- Sebelumnya: whitelist role_type (GURU, BK, WALI_KELAS, KAPRODI, KEPSEK,
--   WAKA_KURIKULUM, WAKA_KESISWAAN, DUDI) — WAKA_HUMAS tidak tercakup,
--   DUDI salah masuk padahal 0 slots mengajar.
-- Sesudah: EXISTS ke teaching_schedules — role-agnostic, berbasis fakta jadwal.

DROP POLICY IF EXISTS rls_users_read_staff_names ON users;

CREATE POLICY rls_users_read_staff_names ON users
  FOR SELECT TO authenticated
  USING (
    school_id = fn_current_school_id()
    AND fn_current_user_role() = ANY (ARRAY['SISWA'::role_type, 'ORTU'::role_type])
    AND EXISTS (
      SELECT 1 FROM teaching_schedules ts
      WHERE ts.scheduled_teacher_id = users.user_id
        AND ts.school_id = fn_current_school_id()
    )
  );
