-- ADAPT-D: Perbaiki SELECT policy assessment_results yang terlalu luas
-- Problem: assessment_results_school_read hanya filter school_id
--          tanpa filter role — semua user (termasuk SISWA, ORTU) bisa
--          baca nilai semua siswa via Supabase API langsung.
-- Fix: Drop policy lama, buat 3 policy terpisah per kelompok role.
-- Keputusan Romo (26 Aug 2026):
--   - TU dikecualikan dari array staf
--   - Policy SISWA dan ORTU diimplementasikan sekarang
-- Enum aktual terverifikasi via pg_enum: BK (bukan GURU_BK),
--   WAKA_KESISWAAN ada, GURU_PIKET tidak ada di enum.

BEGIN;

-- ── 1. Drop policy lama yang terlalu luas ──────────────────────────────────
DROP POLICY IF EXISTS assessment_results_school_read ON assessment_results;

-- ── 2a. SELECT untuk staf (role pengajar dan admin — TU dikecualikan) ──────
DROP POLICY IF EXISTS rls_assessment_results_select_staf ON assessment_results;
CREATE POLICY rls_assessment_results_select_staf
  ON assessment_results
  FOR SELECT
  USING (
    school_id = fn_current_school_id()
    AND fn_current_user_role() = ANY (ARRAY[
      'GURU'::role_type,
      'WALI_KELAS'::role_type,
      'BK'::role_type,
      'WAKA_KURIKULUM'::role_type,
      'WAKA_HUMAS'::role_type,
      'WAKA_KESISWAAN'::role_type,
      'KEPSEK'::role_type,
      'KAPRODI'::role_type,
      'ADMINISTRATIVE'::role_type
    ])
  );

-- ── 2b. SELECT untuk SISWA — hanya data diri sendiri ──────────────────────
DROP POLICY IF EXISTS rls_assessment_results_select_siswa ON assessment_results;
CREATE POLICY rls_assessment_results_select_siswa
  ON assessment_results
  FOR SELECT
  USING (
    school_id = fn_current_school_id()
    AND fn_current_user_role() = 'SISWA'::role_type
    AND student_id = fn_current_student_id()
  );

-- ── 2c. SELECT untuk ORTU — hanya data anak mereka ────────────────────────
DROP POLICY IF EXISTS rls_assessment_results_select_ortu ON assessment_results;
CREATE POLICY rls_assessment_results_select_ortu
  ON assessment_results
  FOR SELECT
  USING (
    school_id = fn_current_school_id()
    AND fn_current_user_role() = 'ORTU'::role_type
    AND EXISTS (
      SELECT 1
      FROM student_parents sp
      WHERE sp.parent_user_id = fn_current_user_id()
        AND sp.student_id     = assessment_results.student_id
        AND sp.school_id      = fn_current_school_id()
    )
  );

COMMIT;
