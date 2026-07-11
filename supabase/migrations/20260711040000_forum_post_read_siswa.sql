-- Migration: forum_post_read_siswa
-- Tujuan: tambah cabang SISWA ke fn_can_read_forum_post
-- agar siswa yang ada di forum_post_audience bisa membaca
-- posting forum kelasnya sendiri.

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
BEGIN
    SELECT fp.class_id, fp.academic_year, fp.visibility,
           fp.author_user_id, fp.school_id
    INTO   v_class_id, v_academic_year, v_visibility,
           v_author_id, v_school_id
    FROM   forum_posts fp
    WHERE  fp.post_id   = p_post_id
      AND  fp.school_id = fn_current_school_id();

    IF NOT FOUND THEN RETURN false; END IF;

    -- 1. Penulis selalu bisa baca posting sendiri
    IF fn_current_user_id() = v_author_id THEN RETURN true; END IF;

    -- 2. Wali Kelas untuk kelas ini
    IF EXISTS (
        SELECT 1 FROM users u
        WHERE  u.user_id             = fn_current_user_id()
          AND  u.wali_kelas_class_id = v_class_id
          AND  u.school_id           = v_school_id
          AND  u.is_active = true AND u.deleted_at IS NULL
    ) THEN RETURN true; END IF;

    -- 3. Guru Mapel yang mengajar kelas ini
    IF EXISTS (
        SELECT 1 FROM teaching_assignments ta
        WHERE  ta.user_id       = fn_current_user_id()
          AND  ta.class_id      = v_class_id
          AND  ta.academic_year = v_academic_year
          AND  ta.is_active     = true
          AND  ta.school_id     = v_school_id
    ) THEN RETURN true; END IF;

    -- 4. Guru Wali yang menangani siswa aktif di kelas ini
    IF EXISTS (
        SELECT 1
        FROM   guru_wali_assignments gwa
        WHERE  gwa.guru_user_id  = fn_current_user_id()
          AND  gwa.academic_year = v_academic_year
          AND  gwa.is_active     = true
          AND  gwa.school_id     = v_school_id
          AND  gwa.student_id IN (
                   SELECT ce.student_id FROM class_enrollments ce
                   WHERE  ce.class_id      = v_class_id
                     AND  ce.academic_year = v_academic_year
                     AND  ce.withdrawn_at  IS NULL
                     AND  ce.school_id     = v_school_id
               )
    ) THEN RETURN true; END IF;

    -- 5. BK yang ditugaskan ke kelas ini
    IF EXISTS (
        SELECT 1 FROM bk_class_assignments bca
        WHERE  bca.bk_user_id    = fn_current_user_id()
          AND  bca.class_id      = v_class_id
          AND  bca.academic_year = v_academic_year
          AND  bca.is_active     = true
          AND  bca.school_id     = v_school_id
    ) THEN RETURN true; END IF;

    -- 6. Ortu siswa aktif di kelas (hanya jika PARENT_VISIBLE)
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

    -- 7. SISWA: terdaftar aktif di kelas ini DAN ada di
    --    forum_post_audience posting ini
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

-- REVOKE/GRANT tidak perlu diubah — fungsi ini REPLACE
-- fungsi lama yang sudah punya grant yang benar.
