-- ============================================================
-- FUNC-02 — "Tarik posting" seragam untuk scope KELAS dan SEKOLAH
--
-- MASALAH:
--   fn_can_read_forum_post memeriksa is_withdrawn SETELAH short-circuit
--   scope_type = 'SEKOLAH'. Urutan pada HEAD:
--
--       IF NOT FOUND THEN RETURN false; END IF;
--       IF v_scope_type = 'SEKOLAH' THEN ... RETURN EXISTS (audience); END IF;
--       IF v_is_withdrawn THEN ... END IF;      <-- tidak pernah tercapai
--
--   Akibatnya "tarik posting" (is_withdrawn = true) TIDAK berpengaruh
--   sama sekali pada posting scope SEKOLAH: seluruh audience tetap bisa
--   membacanya. Untuk scope KELAS gerbangnya bekerja normal — posting
--   yang ditarik hanya terlihat oleh penulis dan admin sekolah.
--
--   Inkonsistensi ini juga terlihat di dalam scope SEKOLAH itu sendiri:
--   policy rls_forum_aud_sekolah_read (migration 20260729050000) SUDAH
--   menyaring fp.is_withdrawn = false, sehingga baris audience-nya
--   tersembunyi sementara postingnya sendiri tetap terbaca.
--
-- FIX:
--   Pindahkan gerbang is_withdrawn ke ATAS short-circuit SEKOLAH, tepat
--   setelah baris posting ditemukan. Satu gerbang berlaku untuk kedua
--   scope: posting yang ditarik hanya terbaca oleh penulis dan admin
--   sekolah (KEPSEK / WAKA_KESISWAAN / ADMINISTRATIVE, termasuk lewat
--   flag jabatan tambahan is_kepsek / is_waka_kesiswaan).
--
-- DAMPAK:
--   - scope KELAS  : nol perubahan perilaku (gerbang sudah berlaku, isi
--                    gerbang identik, hanya posisinya naik beberapa baris).
--   - scope SEKOLAH: posting dengan is_withdrawn = true kini tersembunyi
--                    dari audience — ini justru perbaikannya. Posting
--                    dengan is_withdrawn = false (seluruh data existing,
--                    kolom DEFAULT false) tidak terpengaruh sama sekali.
--   - Tidak ada perubahan pada policy TU (rls_forum_posts_read_tu): TU
--     tetap setara admin dan boleh melihat posting yang ditarik.
--
-- IDEMPOTEN:
--   CREATE OR REPLACE FUNCTION dengan signature yang sama persis
--   (uuid) -> boolean. Aman dijalankan berulang.
--
-- PRIVILEGE (CLAUDE.md 6c):
--   SECURITY DEFINER — GRANT + dua REVOKE ditegaskan ulang di akhir.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_can_read_forum_post(p_post_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_class_id      UUID;
    v_academic_year TEXT;
    v_visibility    TEXT;
    v_author_id     UUID;
    v_school_id     UUID;
    v_is_withdrawn  BOOLEAN;
    v_scope_type    TEXT;
    v_caller_id     UUID := fn_current_user_id();
BEGIN
    SELECT fp.class_id, fp.academic_year, fp.visibility,
           fp.author_user_id, fp.school_id, fp.is_withdrawn,
           fp.scope_type
    INTO   v_class_id, v_academic_year, v_visibility,
           v_author_id, v_school_id, v_is_withdrawn,
           v_scope_type
    FROM   forum_posts fp
    WHERE  fp.post_id   = p_post_id
      AND  fp.school_id = fn_current_school_id();

    IF NOT FOUND THEN RETURN false; END IF;

    -- FUNC-02: gerbang "tarik posting", berlaku untuk SEMUA scope.
    -- Blok ini sebelumnya berada DI BAWAH short-circuit scope SEKOLAH
    -- sehingga tidak pernah dievaluasi untuk posting sekolah. Isinya
    -- tidak diubah; hanya posisinya dinaikkan agar semantik "tarik
    -- posting" sama persis di scope KELAS maupun SEKOLAH.
    IF v_is_withdrawn THEN
        RETURN v_caller_id = v_author_id
            OR fn_current_user_role() IN ('KEPSEK', 'WAKA_KESISWAAN', 'ADMINISTRATIVE')
            OR EXISTS (
                SELECT 1 FROM users u
                WHERE  u.user_id   = v_caller_id
                  AND  u.school_id = v_school_id
                  AND  (u.is_kepsek = true OR u.is_waka_kesiswaan = true)
                  AND  u.is_active = true AND u.deleted_at IS NULL
            );
    END IF;

    -- Short-circuit untuk scope_type = 'SEKOLAH'
    IF v_scope_type = 'SEKOLAH' THEN
        -- Author selalu bisa baca postingnya sendiri, aktif atau tidak.
        IF v_author_id = v_caller_id THEN RETURN true; END IF;
        -- EDGE-01: cek keanggotaan audience DAN status aktif caller.
        -- Sebelum fix ini cabang SEKOLAH hanya mengecek keberadaan baris
        -- di forum_post_audience — tanpa users.is_active / deleted_at —
        -- sehingga staf yang resign, siswa yang keluar, atau ortu yang
        -- dinonaktifkan tetap bisa membaca pengumuman se-sekolah selama
        -- barisnya tertinggal di audience. Tidak ada trigger di tabel
        -- users maupun migration yang membersihkan forum_post_audience.
        -- Guard is_active + deleted_at dipilih karena berlaku seragam
        -- untuk SEMUA peran; students.student_status hanya menutup siswa.
        -- Bandingkan cabang KELAS (poin 9) yang sudah punya guard serupa.
        RETURN EXISTS (
            SELECT 1
            FROM   public.forum_post_audience fpa
            JOIN   public.users u ON u.user_id = fpa.user_id
            WHERE  fpa.post_id   = p_post_id
              AND  fpa.user_id   = v_caller_id
              AND  u.is_active   = true
              AND  u.deleted_at IS NULL
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
$function$
;

GRANT  EXECUTE ON FUNCTION public.fn_can_read_forum_post(uuid) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_can_read_forum_post(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.fn_can_read_forum_post(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_can_read_forum_post(uuid) FROM PUBLIC;

COMMIT;
