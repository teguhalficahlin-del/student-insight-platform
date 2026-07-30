-- Migration: 20260730130000_fn-has-teaching-schedule.sql
-- Fix infinite recursion (42P17) di policy rls_users_read_staff_names.
--
-- Root cause: rls_users_read_staff_names EXISTS ke teaching_schedules,
-- dan rls_schedules_read_own (policy teaching_schedules) EXISTS balik ke users
-- → PostgreSQL terjebak loop saat SISWA/ORTU query users.
--
-- Fix: fn_has_teaching_schedule SECURITY DEFINER query teaching_schedules
-- langsung (bypass RLS) → rls_schedules_read_own tidak dievaluasi → loop terputus.

-- Step 1: Buat fungsi SECURITY DEFINER pemutus loop
CREATE OR REPLACE FUNCTION fn_has_teaching_schedule(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM teaching_schedules
    WHERE scheduled_teacher_id = p_user_id
      AND school_id = fn_current_school_id()
  );
$$;

-- Step 2: REVOKE dua lapis wajib (CLAUDE.md §6c)
REVOKE EXECUTE ON FUNCTION fn_has_teaching_schedule(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_has_teaching_schedule(uuid) FROM anon;

-- Step 3: Grant hanya ke authenticated
GRANT EXECUTE ON FUNCTION fn_has_teaching_schedule(uuid) TO authenticated;

-- Step 4: Ganti policy rekursif dengan versi aman via fungsi
DROP POLICY IF EXISTS rls_users_read_staff_names ON users;

CREATE POLICY rls_users_read_staff_names ON users
  FOR SELECT TO authenticated
  USING (
    school_id = fn_current_school_id()
    AND fn_current_user_role() = ANY (ARRAY['SISWA'::role_type, 'ORTU'::role_type])
    AND fn_has_teaching_schedule(users.user_id)
  );
