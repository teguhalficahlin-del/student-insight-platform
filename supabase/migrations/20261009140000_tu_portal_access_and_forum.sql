-- TU sessions lose their tenant scope immediately when disabled/deleted.
-- Other roles retain their existing identity behavior.
BEGIN;

CREATE OR REPLACE FUNCTION public.fn_current_school_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT u.school_id FROM public.users u
    WHERE u.auth_user_id = auth.uid()
      AND (u.role_type <> 'TU'::public.role_type
           OR (u.is_active IS TRUE AND u.deleted_at IS NULL))
    LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.fn_current_school_id() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.fn_current_school_id() FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_current_school_id() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.fn_is_tu()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.auth_user_id = auth.uid()
          AND u.role_type = 'TU'::public.role_type
          AND u.is_active IS TRUE AND u.deleted_at IS NULL
    );
$$;
GRANT EXECUTE ON FUNCTION public.fn_is_tu() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.fn_is_tu() FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_is_tu() FROM PUBLIC;

DROP POLICY IF EXISTS rls_forum_comments_insert ON public.forum_post_comments;
CREATE POLICY rls_forum_comments_insert ON public.forum_post_comments
FOR INSERT TO authenticated
WITH CHECK (
    school_id = public.fn_current_school_id()
    AND author_user_id = public.fn_current_user_id()
    AND public.fn_can_read_forum_post(post_id)
    AND public.fn_current_user_role() = ANY (ARRAY[
        'GURU', 'BK', 'WALI_KELAS', 'KAPRODI', 'KEPSEK',
        'ADMINISTRATIVE', 'WAKA_KURIKULUM', 'WAKA_KESISWAAN', 'WAKA_HUMAS',
        'ORTU', 'TU'
    ]::public.role_type[])
);

-- Preserve the recipient branches; only authorize their caller.
CREATE OR REPLACE FUNCTION public.fn_get_forum_recipient_candidates(
  p_target_group  text,
  p_program_id    uuid     DEFAULT NULL,
  p_class_id      uuid     DEFAULT NULL,
  p_day_of_week   smallint DEFAULT NULL,
  p_academic_year text     DEFAULT NULL
)
RETURNS TABLE(user_id uuid, full_name text, role_label text, extra_info text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_school_id  uuid        := fn_current_school_id();
  v_acad_year  text        := COALESCE(p_academic_year,
    to_char(now(), 'YYYY') || '/' || to_char(now() + interval '1 year', 'YYYY'));
  v_day_enum   day_of_week;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.auth_user_id = auth.uid()
      AND u.school_id = v_school_id
      AND u.is_active IS TRUE AND u.deleted_at IS NULL
      AND u.role_type IN (
        'GURU', 'BK', 'WALI_KELAS', 'KAPRODI',
        'WAKA_KESISWAAN', 'WAKA_KURIKULUM', 'WAKA_HUMAS',
        'KEPSEK', 'TU', 'ADMINISTRATIVE'
      )
  ) THEN
    RAISE EXCEPTION 'Akses kandidat penerima forum hanya untuk staf aktif.'
      USING ERRCODE = '42501';
  END IF;

  IF p_day_of_week IS NOT NULL THEN
    v_day_enum := CASE p_day_of_week
      WHEN 1 THEN 'SENIN'
      WHEN 2 THEN 'SELASA'
      WHEN 3 THEN 'RABU'
      WHEN 4 THEN 'KAMIS'
      WHEN 5 THEN 'JUMAT'
      WHEN 6 THEN 'SABTU'
    END::day_of_week;
  END IF;

  IF p_target_group = 'SEMUA_GURU' THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'GURU'::text, NULL::text
      FROM public.users u
      WHERE u.school_id = v_school_id
        AND u.is_active = true AND u.deleted_at IS NULL
        AND u.role_type = 'GURU';

  ELSIF p_target_group = 'GURU_MAPEL' THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'GURU'::text, NULL::text
      FROM public.users u
      WHERE u.school_id = v_school_id
        AND u.is_active = true AND u.deleted_at IS NULL
        AND u.role_type = 'GURU';

  ELSIF p_target_group = 'SEMUA_GURU_WALI' THEN
    RETURN QUERY
      SELECT DISTINCT u.user_id, u.full_name::text, 'GURU_WALI'::text, NULL::text
      FROM public.users u
      JOIN public.guru_wali_assignments gwa ON gwa.guru_user_id = u.user_id
      WHERE u.school_id     = v_school_id
        AND u.is_active     = true AND u.deleted_at IS NULL
        AND gwa.school_id   = v_school_id
        AND gwa.is_active   = true
        AND gwa.academic_year = v_acad_year;

  ELSIF p_target_group = 'SEMUA_WALI_KELAS' THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'WALI_KELAS'::text, c.name::text
      FROM public.users u
      JOIN public.classes c ON c.class_id = u.wali_kelas_class_id
      WHERE u.school_id = v_school_id
        AND u.is_active = true AND u.deleted_at IS NULL
        AND u.wali_kelas_class_id IS NOT NULL
        AND c.is_active = true;

  ELSIF p_target_group = 'WALI_KELAS_JURUSAN' THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'WALI_KELAS'::text, c.name::text
      FROM public.users u
      JOIN public.classes c ON c.class_id = u.wali_kelas_class_id
      WHERE u.school_id = v_school_id
        AND u.is_active = true AND u.deleted_at IS NULL
        AND u.wali_kelas_class_id IS NOT NULL
        AND c.program_id = p_program_id
        AND c.is_active = true;

  ELSIF p_target_group = 'SEMUA_KAPRODI' THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'KAPRODI'::text, pr.name::text
      FROM public.users u
      JOIN public.programs pr ON pr.program_id = u.kaprodi_program_id
      WHERE u.school_id = v_school_id
        AND u.is_active = true AND u.deleted_at IS NULL
        AND u.kaprodi_program_id IS NOT NULL;

  ELSIF p_target_group = 'KAPRODI_JURUSAN' THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'KAPRODI'::text, pr.name::text
      FROM public.users u
      JOIN public.programs pr ON pr.program_id = u.kaprodi_program_id
      WHERE u.school_id = v_school_id
        AND u.is_active = true AND u.deleted_at IS NULL
        AND u.kaprodi_program_id = p_program_id;

  ELSIF p_target_group = 'SEMUA_BK' THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'BK'::text, NULL::text
      FROM public.users u
      WHERE u.school_id = v_school_id
        AND u.is_active = true AND u.deleted_at IS NULL
        AND u.is_bk = true;

  ELSIF p_target_group = 'SEMUA_WAKA' THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text,
             CASE
               WHEN u.is_waka_kurikulum THEN 'WAKA_KURIKULUM'
               WHEN u.is_waka_kesiswaan THEN 'WAKA_KESISWAAN'
               WHEN u.is_waka_humas     THEN 'WAKA_HUMAS'
               ELSE u.role_type
             END::text,
             NULL::text
      FROM public.users u
      WHERE u.school_id = v_school_id
        AND u.is_active = true AND u.deleted_at IS NULL
        AND (u.is_waka_kurikulum = true OR u.is_waka_kesiswaan = true
          OR u.is_waka_humas = true
          OR u.role_type IN ('WAKA_KURIKULUM','WAKA_KESISWAAN','WAKA_HUMAS'));

  ELSIF p_target_group = 'KEPSEK' THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'KEPSEK'::text, NULL::text
      FROM public.users u
      WHERE u.school_id = v_school_id
        AND u.is_active = true AND u.deleted_at IS NULL
        AND (u.is_kepsek = true OR u.role_type = 'KEPSEK');

  ELSIF p_target_group = 'SEMUA_TU' THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'TU'::text, NULL::text
      FROM public.users u
      WHERE u.school_id = v_school_id
        AND u.is_active = true AND u.deleted_at IS NULL
        AND u.role_type IN ('TU','ADMINISTRATIVE');

  ELSIF p_target_group = 'SEMUA_SISWA' THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'SISWA'::text, NULL::text
      FROM public.users u
      JOIN public.students s ON s.user_id = u.user_id
      WHERE u.school_id = v_school_id
        AND u.is_active = true AND u.deleted_at IS NULL
        AND s.student_status = 'AKTIF';

  -- SISWA_KELAS & SISWA_PER_KELAS: siswa dalam kelas tertentu
  ELSIF p_target_group IN ('SISWA_KELAS', 'SISWA_PER_KELAS') THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'SISWA'::text, c.name::text
      FROM public.users u
      JOIN public.students s ON s.user_id = u.user_id
      JOIN public.class_enrollments ce ON ce.student_id = s.student_id
      JOIN public.classes c ON c.class_id = ce.class_id
      WHERE u.school_id = v_school_id
        AND u.is_active = true AND u.deleted_at IS NULL
        AND s.student_status = 'AKTIF'
        AND ce.class_id = p_class_id
        AND ce.academic_year = v_acad_year
        AND ce.withdrawn_at IS NULL;

  -- SISWA_JURUSAN & SISWA_PER_JURUSAN: siswa dalam program/jurusan tertentu
  ELSIF p_target_group IN ('SISWA_JURUSAN', 'SISWA_PER_JURUSAN') THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'SISWA'::text, pr.name::text
      FROM public.users u
      JOIN public.students s ON s.user_id = u.user_id
      JOIN public.programs pr ON pr.program_id = s.program_id
      WHERE u.school_id = v_school_id
        AND u.is_active = true AND u.deleted_at IS NULL
        AND s.student_status = 'AKTIF'
        AND s.program_id = p_program_id;

  ELSIF p_target_group = 'SEMUA_ORTU' THEN
    RETURN QUERY
      SELECT DISTINCT u.user_id, u.full_name::text, 'ORTU'::text, NULL::text
      FROM public.users u
      JOIN public.student_parents sp ON sp.parent_user_id = u.user_id
      JOIN public.students s ON s.student_id = sp.student_id
      WHERE u.school_id = v_school_id
        AND u.is_active = true AND u.deleted_at IS NULL
        AND s.student_status = 'AKTIF'
        AND sp.school_id = v_school_id;

  -- ORTU_KELAS & ORTU_PER_KELAS: ortu siswa dalam kelas tertentu
  ELSIF p_target_group IN ('ORTU_KELAS', 'ORTU_PER_KELAS') THEN
    RETURN QUERY
      SELECT DISTINCT u.user_id, u.full_name::text, 'ORTU'::text, c.name::text
      FROM public.users u
      JOIN public.student_parents sp ON sp.parent_user_id = u.user_id
      JOIN public.students s ON s.student_id = sp.student_id
      JOIN public.class_enrollments ce ON ce.student_id = s.student_id
      JOIN public.classes c ON c.class_id = ce.class_id
      WHERE u.school_id = v_school_id
        AND u.is_active = true AND u.deleted_at IS NULL
        AND s.student_status = 'AKTIF'
        AND ce.class_id = p_class_id
        AND ce.academic_year = v_acad_year
        AND ce.withdrawn_at IS NULL
        AND sp.school_id = v_school_id;

  -- ORTU_JURUSAN & ORTU_PER_JURUSAN: ortu siswa dalam program/jurusan tertentu
  ELSIF p_target_group IN ('ORTU_JURUSAN', 'ORTU_PER_JURUSAN') THEN
    RETURN QUERY
      SELECT DISTINCT u.user_id, u.full_name::text, 'ORTU'::text, pr.name::text
      FROM public.users u
      JOIN public.student_parents sp ON sp.parent_user_id = u.user_id
      JOIN public.students s ON s.student_id = sp.student_id
      JOIN public.programs pr ON pr.program_id = s.program_id
      WHERE u.school_id = v_school_id
        AND u.is_active = true AND u.deleted_at IS NULL
        AND s.student_status = 'AKTIF'
        AND s.program_id = p_program_id
        AND sp.school_id = v_school_id;

  ELSIF p_target_group = 'GURU_PIKET' THEN
    RETURN QUERY
      SELECT DISTINCT u.user_id, u.full_name::text, 'GURU_PIKET'::text,
             ds.day_of_week::text
      FROM public.users u
      JOIN public.duty_schedules ds ON ds.user_id = u.user_id
      WHERE u.school_id    = v_school_id
        AND u.is_active    = true AND u.deleted_at IS NULL
        AND ds.school_id   = v_school_id
        AND ds.academic_year = v_acad_year
        AND ds.is_active   = true
        AND (v_day_enum IS NULL OR ds.day_of_week = v_day_enum);

  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_get_forum_recipient_candidates(text, uuid, uuid, smallint, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.fn_get_forum_recipient_candidates(text, uuid, uuid, smallint, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_get_forum_recipient_candidates(text, uuid, uuid, smallint, text) FROM PUBLIC;

COMMIT;

