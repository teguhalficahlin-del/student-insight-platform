-- Migration: fn_get_escalation_candidates
-- Dipanggil UI saat panel Eskalasi dibuka.
-- Mengembalikan staf yang punya relasi struktural dengan siswa kasus,
-- sesuai track (SEKOLAH/PKL), deduplikat per user (prioritas terkecil),
-- handler aktif dikecualikan.

CREATE OR REPLACE FUNCTION fn_get_escalation_candidates(
    p_case_id UUID
)
RETURNS TABLE (
    user_id         UUID,
    full_name       TEXT,
    role_type       role_type,
    relation_label  TEXT
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
    v_student_id         UUID;
    v_track              case_track;
    v_current_handler    UUID;
    v_school_id          UUID;
    v_student_program_id UUID;
    v_student_class_id   UUID;
    v_academic_year      VARCHAR(9);
    v_semester           semester;
BEGIN
    -- Validasi: caller harus bisa lihat kasus ini
    IF NOT fn_can_see_coaching_case(p_case_id) THEN
        RAISE EXCEPTION 'permission_denied: tidak dapat melihat kasus ini'
            USING ERRCODE = 'P0001';
    END IF;

    -- Ambil metadata kasus
    SELECT c.student_id, c.track, c.current_handler_user_id, c.school_id
    INTO   v_student_id, v_track, v_current_handler, v_school_id
    FROM   coaching_cases c
    WHERE  c.case_id = p_case_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found: kasus tidak ditemukan. case_id=%', p_case_id
            USING ERRCODE = 'P0004';
    END IF;

    -- Ambil program studi siswa
    SELECT s.program_id
    INTO   v_student_program_id
    FROM   students s
    WHERE  s.student_id = v_student_id;

    -- Ambil tahun ajaran dan semester berjalan (dari school_config tenant ini)
    -- Bisa NULL jika school belum konfigurasi — semua lookup yang butuh nilai ini
    -- sudah dilindungi oleh guard IS NOT NULL di level WHERE clause.
    SELECT sc.current_academic_year, sc.current_semester
    INTO   v_academic_year, v_semester
    FROM   school_config sc
    WHERE  sc.school_id = v_school_id
    LIMIT  1;

    -- Ambil kelas aktif siswa pada semester berjalan
    -- NULL jika siswa PKL dan tidak punya enrollment aktif, atau school_config belum diset.
    SELECT ce.class_id
    INTO   v_student_class_id
    FROM   class_enrollments ce
    WHERE  ce.student_id    = v_student_id
      AND  ce.academic_year = v_academic_year
      AND  ce.semester      = v_semester
      AND  ce.withdrawn_at  IS NULL
    LIMIT  1;

    -- ─────────────────────────────────────────────────────────────────────────
    IF v_track = 'SEKOLAH' THEN

        RETURN QUERY
        WITH candidates AS (

            -- 1. Wali Kelas (priority 1 — relasi paling langsung dengan kelas siswa)
            SELECT u.user_id,
                   u.full_name::TEXT,
                   u.role_type,
                   'Wali Kelas'::TEXT AS relation_label,
                   1                  AS priority
            FROM   users u
            WHERE  u.school_id           = v_school_id
              AND  u.is_active           = TRUE
              AND  u.wali_kelas_class_id = v_student_class_id
              AND  v_student_class_id    IS NOT NULL

            UNION ALL

            -- 2. Kaprodi program studi siswa
            SELECT u.user_id, u.full_name::TEXT, u.role_type,
                   'Kaprodi'::TEXT, 2
            FROM   users u
            WHERE  u.school_id          = v_school_id
              AND  u.is_active          = TRUE
              AND  u.kaprodi_program_id = v_student_program_id
              AND  v_student_program_id IS NOT NULL

            UNION ALL

            -- 3. Guru BK
            SELECT u.user_id, u.full_name::TEXT, u.role_type,
                   'Guru BK'::TEXT, 3
            FROM   users u
            WHERE  u.school_id = v_school_id
              AND  u.is_active = TRUE
              AND  u.is_bk     = TRUE

            UNION ALL

            -- 4. Guru Mapel yang mengajar kelas siswa semester berjalan
            SELECT DISTINCT
                   u.user_id, u.full_name::TEXT, u.role_type,
                   'Guru Mapel'::TEXT, 4
            FROM   teaching_assignments ta
            JOIN   users u ON u.user_id = ta.user_id
            WHERE  ta.class_id      = v_student_class_id
              AND  ta.academic_year = v_academic_year
              AND  ta.semester      = v_semester
              AND  ta.is_active     = TRUE
              AND  u.school_id      = v_school_id
              AND  u.is_active      = TRUE
              AND  v_student_class_id IS NOT NULL

            UNION ALL

            -- 5. Waka Kesiswaan
            SELECT u.user_id, u.full_name::TEXT, u.role_type,
                   'Waka Kesiswaan'::TEXT, 5
            FROM   users u
            WHERE  u.school_id         = v_school_id
              AND  u.is_active         = TRUE
              AND  u.is_waka_kesiswaan = TRUE

            UNION ALL

            -- 6. Kepsek
            SELECT u.user_id, u.full_name::TEXT, u.role_type,
                   'Kepala Sekolah'::TEXT, 6
            FROM   users u
            WHERE  u.school_id = v_school_id
              AND  u.is_active = TRUE
              AND  u.is_kepsek = TRUE

        ),
        -- Deduplikat: satu baris per user, ambil relation_label dengan priority terkecil
        deduped AS (
            SELECT DISTINCT ON (c.user_id)
                c.user_id, c.full_name, c.role_type, c.relation_label
            FROM candidates c
            ORDER BY c.user_id, c.priority
        )
        SELECT d.user_id, d.full_name, d.role_type, d.relation_label
        FROM   deduped d
        -- Exclude handler aktif — tidak bisa eskalasi ke diri sendiri
        WHERE  d.user_id != v_current_handler
        ORDER  BY d.relation_label, d.full_name;

    -- ─────────────────────────────────────────────────────────────────────────
    ELSIF v_track = 'PKL' THEN

        RETURN QUERY
        WITH candidates AS (

            -- 1. DUDI Supervisor (penempatan PKL aktif siswa)
            SELECT u.user_id, u.full_name::TEXT, u.role_type,
                   'DUDI Supervisor'::TEXT AS relation_label,
                   1                       AS priority
            FROM   pkl_placements pp
            JOIN   users u ON u.user_id = pp.dudi_user_id
            WHERE  pp.student_id = v_student_id
              AND  pp.is_active  = TRUE
              AND  u.school_id   = v_school_id
              AND  u.is_active   = TRUE

            UNION ALL

            -- 2. Guru Pembimbing PKL (guru internal pendamping PKL)
            SELECT u.user_id, u.full_name::TEXT, u.role_type,
                   'Guru Pembimbing PKL'::TEXT, 2
            FROM   pkl_placements pp
            JOIN   users u ON u.user_id = pp.guru_pembimbing_user_id
            WHERE  pp.student_id              = v_student_id
              AND  pp.is_active               = TRUE
              AND  u.school_id                = v_school_id
              AND  u.is_active                = TRUE
              AND  pp.guru_pembimbing_user_id IS NOT NULL

            UNION ALL

            -- 3. Wali Kelas (dari kelas asal siswa, sebelum/selama PKL)
            SELECT u.user_id, u.full_name::TEXT, u.role_type,
                   'Wali Kelas'::TEXT, 3
            FROM   users u
            WHERE  u.school_id           = v_school_id
              AND  u.is_active           = TRUE
              AND  u.wali_kelas_class_id = v_student_class_id
              AND  v_student_class_id    IS NOT NULL

            UNION ALL

            -- 4. Kaprodi program studi siswa
            SELECT u.user_id, u.full_name::TEXT, u.role_type,
                   'Kaprodi'::TEXT, 4
            FROM   users u
            WHERE  u.school_id          = v_school_id
              AND  u.is_active          = TRUE
              AND  u.kaprodi_program_id = v_student_program_id
              AND  v_student_program_id IS NOT NULL

            UNION ALL

            -- 5. Waka Humas (koordinator PKL di level sekolah)
            SELECT u.user_id, u.full_name::TEXT, u.role_type,
                   'Waka Humas'::TEXT, 5
            FROM   users u
            WHERE  u.school_id     = v_school_id
              AND  u.is_active     = TRUE
              AND  u.is_waka_humas = TRUE

            UNION ALL

            -- 6. Kepsek
            SELECT u.user_id, u.full_name::TEXT, u.role_type,
                   'Kepala Sekolah'::TEXT, 6
            FROM   users u
            WHERE  u.school_id = v_school_id
              AND  u.is_active = TRUE
              AND  u.is_kepsek = TRUE

        ),
        deduped AS (
            SELECT DISTINCT ON (c.user_id)
                c.user_id, c.full_name, c.role_type, c.relation_label
            FROM candidates c
            ORDER BY c.user_id, c.priority
        )
        SELECT d.user_id, d.full_name, d.role_type, d.relation_label
        FROM   deduped d
        WHERE  d.user_id != v_current_handler
        ORDER  BY d.relation_label, d.full_name;

    END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION fn_get_escalation_candidates(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_get_escalation_candidates(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION fn_get_escalation_candidates(uuid) TO authenticated;
GRANT  EXECUTE ON FUNCTION fn_get_escalation_candidates(uuid) TO service_role;
