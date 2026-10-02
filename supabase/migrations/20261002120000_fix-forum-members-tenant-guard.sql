-- ============================================================
-- Migration: 20261002120000_fix-forum-members-tenant-guard.sql
--
-- TEMUAN AUDIT CODEX #1 (KRITIS) — kebocoran lintas-tenant.
--   fn_get_forum_members mengambil v_school_id dari kelas yang dioper
--   (p_class_id), lalu TIDAK memeriksa sekolah pemanggil. Pengguna
--   terautentikasi sekolah A dapat memanggil dengan class_id sekolah B
--   dan menerima daftar user_id (wali kelas, guru, BK, kaprodi, kepsek,
--   ortu) milik kelas sekolah B.
--
-- FIX: satu guard — pemanggil harus se-tenant dengan kelas. Diverifikasi
--   dari source (badan fungsi disalin apa adanya dari migration
--   20260714040000, hanya blok IF penjaga yang diganti).
--
-- Tidak memblokir alur sah: pemanggil selalu menyusun forum untuk kelas
-- di sekolahnya sendiri. fn_current_school_id() = helper tenant standar
-- yang dipakai di seluruh RLS repo ini.
--
-- Tanda tangan fungsi tidak berubah (UUID, TEXT, TEXT) -> tidak perlu DROP.
-- ============================================================

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

    -- GUARD TENANT (fix audit Codex #1, 2 Okt 2026): v_school_id diambil dari
    -- p_class_id, BUKAN dari pemanggil. Tanpa guard ini, pengguna sekolah A bisa
    -- memanggil dengan class_id sekolah B dan menerima daftar user_id anggotanya.
    -- Pemanggil sah selalu menyusun forum untuk kelas sekolahnya sendiri, jadi
    -- guard ini tidak memblokir alur normal.
    IF v_school_id IS NULL OR v_school_id <> fn_current_school_id() THEN
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

REVOKE ALL    ON FUNCTION fn_get_forum_members(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fn_get_forum_members(UUID, TEXT, TEXT) TO authenticated;
