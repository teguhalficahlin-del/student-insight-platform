-- Tambah kolom student_name ke return type fn_get_forum_member_details
-- Untuk baris ORTU: diisi nama siswa yang bersangkutan
-- Untuk non-ORTU: NULL
-- DROP dulu karena PostgreSQL tidak izinkan OR REPLACE jika return type berubah

DROP FUNCTION IF EXISTS fn_get_forum_member_details(uuid, text);

CREATE FUNCTION fn_get_forum_member_details(
    p_class_id      uuid,
    p_academic_year text
)
RETURNS TABLE (
    user_id      uuid,
    full_name    text,
    role_type    text,
    student_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_school_id  UUID;
    v_program_id UUID;
BEGIN
    SELECT c.school_id, c.program_id
    INTO   v_school_id, v_program_id
    FROM   classes c
    WHERE  c.class_id = p_class_id;

    IF v_school_id IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY

    -- Wali kelas
    SELECT DISTINCT u.user_id, u.full_name::text, u.role_type::text,
                    NULL::text AS student_name
    FROM users u
    WHERE u.wali_kelas_class_id = p_class_id
      AND u.school_id           = v_school_id
      AND u.is_active           = true
      AND u.deleted_at          IS NULL

    UNION

    -- Guru mapel aktif di kelas ini
    SELECT DISTINCT u.user_id, u.full_name::text, u.role_type::text,
                    NULL::text AS student_name
    FROM teaching_assignments ta
    JOIN users u ON u.user_id   = ta.user_id
    WHERE ta.class_id           = p_class_id
      AND ta.academic_year      = p_academic_year
      AND ta.is_active          = true
      AND ta.school_id          = v_school_id
      AND u.is_active           = true
      AND u.deleted_at          IS NULL

    UNION

    -- Guru wali aktif yang menangani siswa di kelas ini
    SELECT DISTINCT u.user_id, u.full_name::text, u.role_type::text,
                    NULL::text AS student_name
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

    -- BK aktif di kelas ini
    SELECT DISTINCT u.user_id, u.full_name::text, u.role_type::text,
                    NULL::text AS student_name
    FROM bk_class_assignments bca
    JOIN users u ON u.user_id   = bca.bk_user_id
    WHERE bca.class_id          = p_class_id
      AND bca.academic_year     = p_academic_year
      AND bca.is_active         = true
      AND bca.school_id         = v_school_id
      AND u.is_active           = true
      AND u.deleted_at          IS NULL

    UNION

    -- Waka Kesiswaan dan Kepsek (seluruh sekolah)
    SELECT DISTINCT u.user_id, u.full_name::text, u.role_type::text,
                    NULL::text AS student_name
    FROM users u
    WHERE u.school_id  = v_school_id
      AND u.is_active  = true
      AND u.deleted_at IS NULL
      AND (
              u.role_type IN ('WAKA_KESISWAAN', 'KEPSEK', 'ADMINISTRATIVE')
              OR u.is_waka_kesiswaan = true
              OR u.is_kepsek        = true
          )

    UNION

    -- Kaprodi yang mengelola program kelas ini
    SELECT DISTINCT u.user_id, u.full_name::text, u.role_type::text,
                    NULL::text AS student_name
    FROM users u
    WHERE u.school_id  = v_school_id
      AND u.is_active  = true
      AND u.deleted_at IS NULL
      AND v_program_id IS NOT NULL
      AND (
              u.program_id           = v_program_id
              OR u.kaprodi_program_id = v_program_id
          )

    UNION

    -- Ortu siswa aktif di kelas ini (student_name diisi nama siswa)
    SELECT DISTINCT
        u.user_id,
        u.full_name::text,
        u.role_type::text,
        s.full_name::text AS student_name
    FROM student_parents sp
    JOIN students s            ON s.student_id  = sp.student_id
    JOIN class_enrollments ce  ON ce.student_id = s.student_id
    JOIN users u               ON u.user_id     = sp.parent_user_id
    WHERE ce.class_id          = p_class_id
      AND ce.academic_year     = p_academic_year
      AND ce.withdrawn_at      IS NULL
      AND ce.school_id         = v_school_id
      AND sp.school_id         = v_school_id
      AND s.student_status     = 'AKTIF'
      AND u.is_active          = true
      AND u.deleted_at         IS NULL

    ORDER BY full_name;
END;
$$;

REVOKE EXECUTE ON FUNCTION fn_get_forum_member_details(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_get_forum_member_details(uuid, text) FROM anon;
