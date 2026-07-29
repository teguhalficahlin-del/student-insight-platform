-- Tambah branch GURU_MAPEL ke fn_get_forum_recipient_candidates
-- Branch baru ini mengembalikan hanya staf dengan role_type='GURU'
-- (berbeda dengan SEMUA_GURU yang mengembalikan semua role staf)

CREATE OR REPLACE FUNCTION public.fn_get_forum_recipient_candidates(
  p_target_group  text,
  p_program_id    uuid    DEFAULT NULL,
  p_class_id      uuid    DEFAULT NULL,
  p_day_of_week   smallint DEFAULT NULL,
  p_academic_year text    DEFAULT NULL
)
RETURNS TABLE(user_id uuid, full_name text, role_label text, extra_info text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  v_school_id uuid := fn_current_school_id();
  v_acad_year text := COALESCE(p_academic_year,
    to_char(now(), 'YYYY') || '/' || to_char(now() + interval '1 year', 'YY'));
BEGIN
  IF p_target_group = 'SEMUA_GURU' THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, u.role_type::text, NULL::text
      FROM public.users u
      WHERE u.school_id = v_school_id
        AND u.is_active = true
        AND u.deleted_at IS NULL
        AND u.role_type IN ('GURU','BK','WAKA_KURIKULUM','WAKA_KESISWAAN',
                            'WAKA_HUMAS','KAPRODI','KEPSEK','ADMINISTRATIVE','TU');

  ELSIF p_target_group = 'GURU_MAPEL' THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'GURU'::text, NULL::text
      FROM public.users u
      WHERE u.school_id = v_school_id
        AND u.is_active = true
        AND u.deleted_at IS NULL
        AND u.role_type = 'GURU';

  ELSIF p_target_group = 'SEMUA_WALI_KELAS' THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'WALI_KELAS'::text,
             c.name::text
      FROM public.users u
      JOIN public.classes c ON c.class_id = u.wali_kelas_class_id
      WHERE u.school_id = v_school_id
        AND u.is_active = true
        AND u.deleted_at IS NULL
        AND u.wali_kelas_class_id IS NOT NULL
        AND c.is_active = true;

  ELSIF p_target_group = 'WALI_KELAS_JURUSAN' THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'WALI_KELAS'::text,
             c.name::text
      FROM public.users u
      JOIN public.classes c ON c.class_id = u.wali_kelas_class_id
      WHERE u.school_id = v_school_id
        AND u.is_active = true
        AND u.deleted_at IS NULL
        AND u.wali_kelas_class_id IS NOT NULL
        AND c.program_id = p_program_id
        AND c.is_active = true;

  ELSIF p_target_group = 'SEMUA_KAPRODI' THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'KAPRODI'::text,
             pr.name::text
      FROM public.users u
      JOIN public.programs pr ON pr.program_id = u.kaprodi_program_id
      WHERE u.school_id = v_school_id
        AND u.is_active = true
        AND u.deleted_at IS NULL
        AND u.kaprodi_program_id IS NOT NULL;

  ELSIF p_target_group = 'KAPRODI_JURUSAN' THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'KAPRODI'::text,
             pr.name::text
      FROM public.users u
      JOIN public.programs pr ON pr.program_id = u.kaprodi_program_id
      WHERE u.school_id = v_school_id
        AND u.is_active = true
        AND u.deleted_at IS NULL
        AND u.kaprodi_program_id = p_program_id;

  ELSIF p_target_group = 'SEMUA_BK' THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'BK'::text, NULL::text
      FROM public.users u
      WHERE u.school_id = v_school_id
        AND u.is_active = true
        AND u.deleted_at IS NULL
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
        AND u.is_active = true
        AND u.deleted_at IS NULL
        AND (u.is_waka_kurikulum = true
          OR u.is_waka_kesiswaan = true
          OR u.is_waka_humas = true
          OR u.role_type IN ('WAKA_KURIKULUM','WAKA_KESISWAAN','WAKA_HUMAS'));

  ELSIF p_target_group = 'KEPSEK' THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'KEPSEK'::text, NULL::text
      FROM public.users u
      WHERE u.school_id = v_school_id
        AND u.is_active = true
        AND u.deleted_at IS NULL
        AND (u.is_kepsek = true OR u.role_type = 'KEPSEK');

  ELSIF p_target_group = 'SEMUA_TU' THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'TU'::text, NULL::text
      FROM public.users u
      WHERE u.school_id = v_school_id
        AND u.is_active = true
        AND u.deleted_at IS NULL
        AND u.role_type IN ('TU','ADMINISTRATIVE');

  ELSIF p_target_group = 'SEMUA_SISWA' THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'SISWA'::text, NULL::text
      FROM public.users u
      JOIN public.students s ON s.user_id = u.user_id
      WHERE u.school_id = v_school_id
        AND u.is_active = true
        AND u.deleted_at IS NULL
        AND s.student_status = 'AKTIF';

  ELSIF p_target_group = 'SISWA_KELAS' THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'SISWA'::text,
             c.name::text
      FROM public.users u
      JOIN public.students s ON s.user_id = u.user_id
      JOIN public.class_enrollments ce ON ce.student_id = s.student_id
      JOIN public.classes c ON c.class_id = ce.class_id
      WHERE u.school_id = v_school_id
        AND u.is_active = true
        AND u.deleted_at IS NULL
        AND s.student_status = 'AKTIF'
        AND ce.class_id = p_class_id
        AND ce.academic_year = v_acad_year
        AND ce.withdrawn_at IS NULL;

  ELSIF p_target_group = 'SISWA_JURUSAN' THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'SISWA'::text,
             pr.name::text
      FROM public.users u
      JOIN public.students s ON s.user_id = u.user_id
      JOIN public.programs pr ON pr.program_id = s.program_id
      WHERE u.school_id = v_school_id
        AND u.is_active = true
        AND u.deleted_at IS NULL
        AND s.student_status = 'AKTIF'
        AND s.program_id = p_program_id;

  ELSIF p_target_group = 'SEMUA_ORTU' THEN
    RETURN QUERY
      SELECT DISTINCT u.user_id, u.full_name::text, 'ORTU'::text, NULL::text
      FROM public.users u
      JOIN public.student_parents sp ON sp.parent_user_id = u.user_id
      JOIN public.students s ON s.student_id = sp.student_id
      WHERE u.school_id = v_school_id
        AND u.is_active = true
        AND u.deleted_at IS NULL
        AND s.student_status = 'AKTIF'
        AND sp.school_id = v_school_id;

  ELSIF p_target_group = 'ORTU_KELAS' THEN
    RETURN QUERY
      SELECT DISTINCT u.user_id, u.full_name::text, 'ORTU'::text,
             c.name::text
      FROM public.users u
      JOIN public.student_parents sp ON sp.parent_user_id = u.user_id
      JOIN public.students s ON s.student_id = sp.student_id
      JOIN public.class_enrollments ce ON ce.student_id = s.student_id
      JOIN public.classes c ON c.class_id = ce.class_id
      WHERE u.school_id = v_school_id
        AND u.is_active = true
        AND u.deleted_at IS NULL
        AND s.student_status = 'AKTIF'
        AND ce.class_id = p_class_id
        AND ce.academic_year = v_acad_year
        AND ce.withdrawn_at IS NULL
        AND sp.school_id = v_school_id;

  ELSIF p_target_group = 'ORTU_JURUSAN' THEN
    RETURN QUERY
      SELECT DISTINCT u.user_id, u.full_name::text, 'ORTU'::text,
             pr.name::text
      FROM public.users u
      JOIN public.student_parents sp ON sp.parent_user_id = u.user_id
      JOIN public.students s ON s.student_id = sp.student_id
      JOIN public.programs pr ON pr.program_id = s.program_id
      WHERE u.school_id = v_school_id
        AND u.is_active = true
        AND u.deleted_at IS NULL
        AND s.student_status = 'AKTIF'
        AND s.program_id = p_program_id
        AND sp.school_id = v_school_id;

  ELSIF p_target_group = 'GURU_PIKET' THEN
    RETURN QUERY
      SELECT u.user_id, u.full_name::text, 'GURU_PIKET'::text,
             p_day_of_week::text
      FROM public.users u
      JOIN public.teacher_piket_assignments tpa ON tpa.user_id = u.user_id
      WHERE u.school_id = v_school_id
        AND u.is_active = true
        AND u.deleted_at IS NULL
        AND tpa.school_id = v_school_id
        AND tpa.day_of_week = p_day_of_week
        AND tpa.academic_year = v_acad_year
        AND tpa.is_active = true;

  END IF;
END;
$function$;

GRANT  EXECUTE ON FUNCTION public.fn_get_forum_recipient_candidates TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_get_forum_recipient_candidates FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_get_forum_recipient_candidates FROM PUBLIC;
