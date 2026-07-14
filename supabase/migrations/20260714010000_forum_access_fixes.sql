-- ============================================================
-- Migration 20260714010000: Forum Kelas — perbaikan akses
--
-- Tiga perbaikan backend:
--
-- §1. fn_can_read_forum_post
--     a. Tambah akses Waka Kesiswaan / Kepsek / Administrative
--        (sebelumnya: hanya boleh lihat posting yang ditarik)
--     b. Tambah akses Kaprodi ke seluruh forum kelas di
--        program yang dikelolanya
--     c. FIX Guru Wali: sebelumnya akses ke semua posting di kelas
--        selama punya satu siswa aktif di sana. Diperbaiki: hanya
--        posting yang subjeknya adalah siswa tanggungannya.
--     d. FIX BK: sebelumnya akses ke semua posting kelas.
--        Diperbaiki: hanya posting yang punya setidaknya satu
--        subjek siswa (bukan pengumuman kelas murni).
--
-- §2. fn_get_forum_members
--     Tambah Waka Kesiswaan / Kepsek dan Kaprodi ke daftar anggota
--     forum agar mereka masuk ke forum_post_audience (notifikasi)
--     dan lolos validasi keanggotaan di fn_create_forum_post.
--
-- §3. fn_get_forum_member_details
--     Tambah Waka Kesiswaan / Kepsek dan Kaprodi ke picker
--     "orang tertentu" di modal buat posting.
-- ============================================================


-- ─── §1. fn_can_read_forum_post ──────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_can_read_forum_post(
    p_post_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_class_id      UUID;
    v_academic_year TEXT;
    v_visibility    TEXT;
    v_author_id     UUID;
    v_school_id     UUID;
    v_is_withdrawn  BOOLEAN;
BEGIN
    SELECT fp.class_id, fp.academic_year, fp.visibility,
           fp.author_user_id, fp.school_id, fp.is_withdrawn
    INTO   v_class_id, v_academic_year, v_visibility,
           v_author_id, v_school_id, v_is_withdrawn
    FROM   forum_posts fp
    WHERE  fp.post_id   = p_post_id
      AND  fp.school_id = fn_current_school_id();

    IF NOT FOUND THEN RETURN false; END IF;

    -- Posting ditarik: hanya author dan admin sekolah yang masih bisa lihat
    IF v_is_withdrawn THEN
        RETURN fn_current_user_id() = v_author_id
            OR fn_current_user_role() IN ('KEPSEK', 'WAKA_KESISWAAN', 'ADMINISTRATIVE')
            OR EXISTS (
                SELECT 1 FROM users u
                WHERE  u.user_id   = fn_current_user_id()
                  AND  u.school_id = v_school_id
                  AND  (u.is_kepsek = true OR u.is_waka_kesiswaan = true)
                  AND  u.is_active = true AND u.deleted_at IS NULL
            );
    END IF;

    -- 1. Penulis selalu bisa baca posting sendiri
    IF fn_current_user_id() = v_author_id THEN RETURN true; END IF;

    -- 2. Waka Kesiswaan / Kepsek / Administrative: akses ke seluruh forum
    --    Cek role_type PLUS flag jabatan tambahan (multi-role)
    IF fn_current_user_role() IN ('KEPSEK', 'WAKA_KESISWAAN', 'ADMINISTRATIVE')
       OR EXISTS (
           SELECT 1 FROM users u
           WHERE  u.user_id   = fn_current_user_id()
             AND  u.school_id = v_school_id
             AND  (u.is_waka_kesiswaan = true OR u.is_kepsek = true)
             AND  u.is_active = true AND u.deleted_at IS NULL
       )
    THEN RETURN true; END IF;

    -- 3. Kaprodi yang mengelola program kelas ini
    --    Cek users.program_id (primary kaprodi) ATAU
    --    users.kaprodi_program_id (jabatan tambahan)
    IF EXISTS (
        SELECT 1
        FROM   users u
        JOIN   classes c ON c.class_id = v_class_id
        WHERE  u.user_id   = fn_current_user_id()
          AND  u.school_id = v_school_id
          AND  u.is_active = true
          AND  u.deleted_at IS NULL
          AND  (u.program_id = c.program_id
                OR u.kaprodi_program_id = c.program_id)
          AND  c.program_id IS NOT NULL
    ) THEN RETURN true; END IF;

    -- 4. Wali Kelas untuk kelas ini
    IF EXISTS (
        SELECT 1 FROM users u
        WHERE  u.user_id             = fn_current_user_id()
          AND  u.wali_kelas_class_id = v_class_id
          AND  u.school_id           = v_school_id
          AND  u.is_active = true AND u.deleted_at IS NULL
    ) THEN RETURN true; END IF;

    -- 5. Guru Mapel yang mengajar kelas ini
    IF EXISTS (
        SELECT 1 FROM teaching_assignments ta
        WHERE  ta.user_id       = fn_current_user_id()
          AND  ta.class_id      = v_class_id
          AND  ta.academic_year = v_academic_year
          AND  ta.is_active     = true
          AND  ta.school_id     = v_school_id
    ) THEN RETURN true; END IF;

    -- 6. Guru Wali: HANYA posting yang subjeknya adalah siswa tanggungannya
    --    (FIX: sebelumnya akses ke semua posting kelas)
    IF EXISTS (
        SELECT 1
        FROM   guru_wali_assignments gwa
        JOIN   forum_post_subjects fps
               ON  fps.student_id = gwa.student_id
               AND fps.post_id    = p_post_id
               AND fps.school_id  = v_school_id
        WHERE  gwa.guru_user_id  = fn_current_user_id()
          AND  gwa.academic_year = v_academic_year
          AND  gwa.is_active     = true
          AND  gwa.school_id     = v_school_id
    ) THEN RETURN true; END IF;

    -- 7. BK: HANYA posting yang punya setidaknya satu subjek siswa
    --    (FIX: sebelumnya akses ke semua posting termasuk pengumuman)
    IF EXISTS (
        SELECT 1 FROM bk_class_assignments bca
        WHERE  bca.bk_user_id    = fn_current_user_id()
          AND  bca.class_id      = v_class_id
          AND  bca.academic_year = v_academic_year
          AND  bca.is_active     = true
          AND  bca.school_id     = v_school_id
    ) AND EXISTS (
        SELECT 1 FROM forum_post_subjects fps
        WHERE  fps.post_id   = p_post_id
          AND  fps.school_id = v_school_id
    ) THEN RETURN true; END IF;

    -- 8. Ortu siswa aktif di kelas (hanya PARENT_VISIBLE)
    IF v_visibility = 'PARENT_VISIBLE' AND EXISTS (
        SELECT 1
        FROM   student_parents sp
        JOIN   class_enrollments ce ON ce.student_id = sp.student_id
        WHERE  sp.parent_user_id = fn_current_user_id()
          AND  sp.school_id      = v_school_id
          AND  ce.class_id       = v_class_id
          AND  ce.academic_year  = v_academic_year
          AND  ce.withdrawn_at   IS NULL
          AND  ce.school_id      = v_school_id
    ) THEN RETURN true; END IF;

    -- 9. Siswa: terdaftar aktif di kelas DAN ada di audience posting ini
    IF EXISTS (
        SELECT 1
        FROM   students s
        JOIN   class_enrollments ce ON ce.student_id = s.student_id
        WHERE  s.user_id        = fn_current_user_id()
          AND  s.school_id      = v_school_id
          AND  s.student_status = 'AKTIF'
          AND  ce.class_id      = v_class_id
          AND  ce.academic_year = v_academic_year
          AND  ce.withdrawn_at  IS NULL
          AND  ce.school_id     = v_school_id
          AND  EXISTS (
                   SELECT 1 FROM forum_post_audience fpa
                   WHERE  fpa.post_id = p_post_id
                     AND  fpa.user_id = fn_current_user_id()
               )
    ) THEN RETURN true; END IF;

    RETURN false;
END;
$$;

REVOKE ALL    ON FUNCTION public.fn_can_read_forum_post(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_can_read_forum_post(uuid) TO authenticated;


-- ─── §2. fn_get_forum_members ────────────────────────────────
CREATE OR REPLACE FUNCTION fn_get_forum_members(
    p_class_id      UUID,
    p_academic_year TEXT,
    p_visibility    TEXT DEFAULT 'INTERNAL'
)
RETURNS TABLE (user_id UUID)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
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

    -- 1. Wali Kelas
    SELECT DISTINCT u.user_id
    FROM   users u
    WHERE  u.wali_kelas_class_id = p_class_id
      AND  u.school_id            = v_school_id
      AND  u.is_active            = true
      AND  u.deleted_at           IS NULL

    UNION

    -- 2. Guru Mapel yang mengajar kelas ini
    SELECT DISTINCT ta.user_id
    FROM   teaching_assignments ta
    WHERE  ta.class_id      = p_class_id
      AND  ta.academic_year = p_academic_year
      AND  ta.is_active     = true
      AND  ta.school_id     = v_school_id

    UNION

    -- 3. Guru Wali yang menangani siswa aktif di kelas ini
    SELECT DISTINCT gwa.guru_user_id
    FROM   guru_wali_assignments gwa
    WHERE  gwa.academic_year = p_academic_year
      AND  gwa.is_active     = true
      AND  gwa.school_id     = v_school_id
      AND  gwa.student_id IN (
               SELECT ce.student_id
               FROM   class_enrollments ce
               WHERE  ce.class_id      = p_class_id
                 AND  ce.academic_year = p_academic_year
                 AND  ce.withdrawn_at  IS NULL
                 AND  ce.school_id     = v_school_id
           )

    UNION

    -- 4. BK yang ditugaskan ke kelas ini
    SELECT DISTINCT bca.bk_user_id
    FROM   bk_class_assignments bca
    WHERE  bca.class_id      = p_class_id
      AND  bca.academic_year = p_academic_year
      AND  bca.is_active     = true
      AND  bca.school_id     = v_school_id

    UNION

    -- 5. Waka Kesiswaan dan Kepsek (seluruh sekolah)
    --    role_type ATAU jabatan tambahan (multi-role)
    SELECT DISTINCT u.user_id
    FROM   users u
    WHERE  u.school_id  = v_school_id
      AND  u.is_active  = true
      AND  u.deleted_at IS NULL
      AND  (
               u.role_type IN ('WAKA_KESISWAAN', 'KEPSEK', 'ADMINISTRATIVE')
               OR u.is_waka_kesiswaan = true
               OR u.is_kepsek        = true
           )

    UNION

    -- 6. Kaprodi yang mengelola program kelas ini
    --    program_id (primary) ATAU kaprodi_program_id (jabatan tambahan)
    SELECT DISTINCT u.user_id
    FROM   users u
    WHERE  u.school_id  = v_school_id
      AND  u.is_active  = true
      AND  u.deleted_at IS NULL
      AND  v_program_id IS NOT NULL
      AND  (
               u.program_id        = v_program_id
               OR u.kaprodi_program_id = v_program_id
           )

    UNION

    -- 7. Ortu siswa aktif di kelas (hanya jika PARENT_VISIBLE)
    SELECT DISTINCT sp.parent_user_id
    FROM   student_parents sp
    JOIN   class_enrollments ce ON ce.student_id = sp.student_id
    WHERE  p_visibility       = 'PARENT_VISIBLE'
      AND  ce.class_id        = p_class_id
      AND  ce.academic_year   = p_academic_year
      AND  ce.withdrawn_at    IS NULL
      AND  ce.school_id       = v_school_id
      AND  sp.school_id       = v_school_id;
END;
$$;

REVOKE ALL    ON FUNCTION fn_get_forum_members(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fn_get_forum_members(UUID, TEXT, TEXT) TO authenticated;


-- ─── §3. fn_get_forum_member_details ─────────────────────────
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
    SELECT DISTINCT u.user_id, u.full_name::text, u.role_type::text
    FROM users u
    WHERE u.wali_kelas_class_id = p_class_id
      AND u.school_id           = v_school_id
      AND u.is_active           = true
      AND u.deleted_at          IS NULL

    UNION

    -- Guru mapel aktif di kelas ini
    SELECT DISTINCT u.user_id, u.full_name::text, u.role_type::text
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
    SELECT DISTINCT u.user_id, u.full_name::text, u.role_type::text
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
    SELECT DISTINCT u.user_id, u.full_name::text, u.role_type::text
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
    SELECT DISTINCT u.user_id, u.full_name::text, u.role_type::text
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
    SELECT DISTINCT u.user_id, u.full_name::text, u.role_type::text
    FROM users u
    WHERE u.school_id  = v_school_id
      AND u.is_active  = true
      AND u.deleted_at IS NULL
      AND v_program_id IS NOT NULL
      AND (
              u.program_id        = v_program_id
              OR u.kaprodi_program_id = v_program_id
          )

    UNION

    -- Ortu siswa aktif di kelas ini
    SELECT DISTINCT u.user_id, u.full_name::text, u.role_type::text
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

REVOKE EXECUTE ON FUNCTION public.fn_get_forum_member_details(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_get_forum_member_details(uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_get_forum_member_details(uuid, text) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_get_forum_member_details(uuid, text) TO service_role;
