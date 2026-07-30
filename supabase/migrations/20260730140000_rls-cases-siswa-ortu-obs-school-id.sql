-- Migration: 20260730140000_rls-cases-siswa-ortu-obs-school-id.sql
-- Fix 3 temuan audit preventif RLS SISWA/ORTU:
--
-- FIX 1: Tambah SELECT policy cases untuk SISWA dan ORTU via fn_can_see_case.
--   Sebelumnya: tidak ada policy SELECT untuk SISWA/ORTU → silent failure.
--   Sesudah: SISWA/ORTU yang tercakup di case_audience_members bisa lihat kasus.
--
-- FIX 2: Tambah SET search_path = public ke fn_can_see_case (SECURITY DEFINER).
--   Sebelumnya: tidak ada SET search_path → potensi search_path injection.
--   Sesudah: search_path dikunci ke public, konsisten dengan fungsi SECURITY DEFINER lain.
--
-- FIX 3: Tambah school_id = fn_current_school_id() ke rls_observations_read_parent.
--   Sebelumnya: tidak ada filter school_id di USING clause → tidak konsisten defensif.
--   Sesudah: isolasi tenant eksplisit di level USING.

-- ===== FIX 2: fn_can_see_case — tambah SET search_path =====
-- Body identik dengan aslinya, hanya ditambah SET search_path = public
CREATE OR REPLACE FUNCTION public.fn_can_see_case(p_case_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM cases c
    WHERE c.case_id   = p_case_id
      AND c.school_id = fn_current_school_id()
      AND (
        fn_involved_in_case(p_case_id)
        OR fn_is_kepsek()
        OR (
          c.audience != 'PRIVATE'
          AND fn_matches_case_handler(c.current_handler_role, c.student_id)
        )
        OR (c.audience = 'PUBLIC' AND fn_is_internal_case_actor())
        OR (c.audience = 'RESTRICTED' AND EXISTS (
          SELECT 1 FROM case_audience_members m
          WHERE m.case_id = p_case_id
            AND m.user_id = fn_current_user_id()
        ))
        OR (
          fn_current_user_role() = 'DUDI'
          AND fn_dudi_supervises_student(c.student_id)
        )
      )
  )
$$;

-- ===== FIX 1: Policy SELECT cases untuk SISWA =====
DROP POLICY IF EXISTS rls_cases_read_student ON cases;

CREATE POLICY rls_cases_read_student ON cases
  FOR SELECT TO authenticated
  USING (
    school_id = fn_current_school_id()
    AND fn_current_user_role() = 'SISWA'::role_type
    AND fn_can_see_case(case_id)
  );

-- ===== FIX 1: Policy SELECT cases untuk ORTU =====
DROP POLICY IF EXISTS rls_cases_read_parent ON cases;

CREATE POLICY rls_cases_read_parent ON cases
  FOR SELECT TO authenticated
  USING (
    school_id = fn_current_school_id()
    AND fn_current_user_role() = 'ORTU'::role_type
    AND fn_can_see_case(case_id)
  );

-- ===== FIX 3: rls_observations_read_parent — tambah school_id guard =====
DROP POLICY IF EXISTS rls_observations_read_parent ON observations;

CREATE POLICY rls_observations_read_parent ON observations
  FOR SELECT TO authenticated
  USING (
    school_id = fn_current_school_id()
    AND fn_current_user_role() = 'ORTU'::role_type
    AND visibility = ANY (ARRAY['ORTU_SAJA'::visibility_level, 'SISWA_DAN_ORTU'::visibility_level])
    AND is_void = false
    AND EXISTS (
      SELECT 1 FROM student_parents sp
      WHERE sp.student_id = observations.student_id
        AND sp.parent_user_id = fn_current_user_id()
    )
  );
