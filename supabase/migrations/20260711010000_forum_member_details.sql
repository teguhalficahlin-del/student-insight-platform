-- Migration: fn_get_forum_member_details
-- Tujuan: return user_id + full_name + role_type semua anggota forum aktif
-- (staf + ortu, tidak termasuk siswa) untuk keperluan picker "orang tertentu"
-- di modal buat posting Forum Kelas.

CREATE OR REPLACE FUNCTION public.fn_get_forum_member_details(
    p_class_id      uuid,
    p_academic_year text
)
RETURNS TABLE(
    user_id   uuid,
    full_name text,
    role_type text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_school_id UUID;
BEGIN
    SELECT c.school_id INTO v_school_id
    FROM   classes c
    WHERE  c.class_id = p_class_id;

    IF v_school_id IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY

    -- Staf: wali kelas
    SELECT DISTINCT
        u.user_id,
        u.full_name::text,
        u.role_type::text
    FROM users u
    WHERE u.wali_kelas_class_id = p_class_id
      AND u.school_id           = v_school_id
      AND u.is_active           = true
      AND u.deleted_at          IS NULL

    UNION

    -- Staf: guru mapel aktif di kelas ini
    SELECT DISTINCT
        u.user_id,
        u.full_name::text,
        u.role_type::text
    FROM teaching_assignments ta
    JOIN users u ON u.user_id   = ta.user_id
    WHERE ta.class_id           = p_class_id
      AND ta.academic_year      = p_academic_year
      AND ta.is_active          = true
      AND ta.school_id          = v_school_id
      AND u.is_active           = true
      AND u.deleted_at          IS NULL

    UNION

    -- Staf: guru wali aktif yang menangani siswa di kelas ini
    SELECT DISTINCT
        u.user_id,
        u.full_name::text,
        u.role_type::text
    FROM guru_wali_assignments gwa
    JOIN users u ON u.user_id   = gwa.guru_user_id
    WHERE gwa.academic_year     = p_academic_year
      AND gwa.is_active         = true
      AND gwa.school_id         = v_school_id
      AND u.is_active           = true
      AND u.deleted_at          IS NULL
      AND gwa.student_id IN (
          SELECT ce.student_id
          FROM   class_enrollments ce
          WHERE  ce.class_id      = p_class_id
            AND  ce.academic_year = p_academic_year
            AND  ce.withdrawn_at  IS NULL
            AND  ce.school_id     = v_school_id
      )

    UNION

    -- Staf: BK aktif di kelas ini
    SELECT DISTINCT
        u.user_id,
        u.full_name::text,
        u.role_type::text
    FROM bk_class_assignments bca
    JOIN users u ON u.user_id   = bca.bk_user_id
    WHERE bca.class_id          = p_class_id
      AND bca.academic_year     = p_academic_year
      AND bca.is_active         = true
      AND bca.school_id         = v_school_id
      AND u.is_active           = true
      AND u.deleted_at          IS NULL

    UNION

    -- Ortu: orang tua siswa aktif di kelas ini
    SELECT DISTINCT
        u.user_id,
        u.full_name::text,
        u.role_type::text
    FROM student_parents sp
    JOIN class_enrollments ce ON ce.student_id = sp.student_id
    JOIN users u              ON u.user_id      = sp.parent_user_id
    WHERE ce.class_id         = p_class_id
      AND ce.academic_year    = p_academic_year
      AND ce.withdrawn_at     IS NULL
      AND ce.school_id        = v_school_id
      AND sp.school_id        = v_school_id
      AND u.is_active         = true
      AND u.deleted_at        IS NULL

    ORDER BY full_name;
END;
$$;

-- Wajib: REVOKE dua lapis (Rule 1 standing rules audit)
REVOKE EXECUTE ON FUNCTION public.fn_get_forum_member_details(uuid, text)
    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_get_forum_member_details(uuid, text)
    FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_get_forum_member_details(uuid, text)
    TO authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_get_forum_member_details(uuid, text)
    TO service_role;
