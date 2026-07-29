-- ============================================================
-- Forum Sekolah — RPC Extension
-- Extend/tambah fungsi untuk mendukung scope_type='SEKOLAH'
-- ============================================================

-- ════════════════════════════════════════════════════════════
-- BAGIAN A — Extend fn_get_user_forum_scope
--   Tambah 3 kolom: is_waka_kurikulum, is_waka_humas, is_bk
-- ════════════════════════════════════════════════════════════

-- DROP diperlukan karena PostgreSQL tidak izinkan CREATE OR REPLACE
-- jika return type berubah (jumlah kolom bertambah 6 → 9)
DROP FUNCTION IF EXISTS public.fn_get_user_forum_scope(uuid);

CREATE OR REPLACE FUNCTION public.fn_get_user_forum_scope(p_user_id uuid)
RETURNS TABLE (
    wali_kelas_class_id  uuid,
    role_type            text,
    program_id           uuid,
    kaprodi_program_id   uuid,
    is_waka_kesiswaan    boolean,
    is_kepsek            boolean,
    is_waka_kurikulum    boolean,
    is_waka_humas        boolean,
    is_bk                boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        wali_kelas_class_id,
        role_type,
        program_id,
        kaprodi_program_id,
        is_waka_kesiswaan,
        is_kepsek,
        is_waka_kurikulum,
        is_waka_humas,
        is_bk
    FROM public.users
    WHERE user_id  = p_user_id
      AND school_id = fn_current_school_id()
    LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_get_user_forum_scope(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_get_user_forum_scope(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_get_user_forum_scope(uuid) TO authenticated;


-- ════════════════════════════════════════════════════════════
-- BAGIAN B — Extend fn_can_read_forum_post
--   Tambah short-circuit untuk scope_type = 'SEKOLAH'
-- ════════════════════════════════════════════════════════════

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

    -- Short-circuit untuk scope_type = 'SEKOLAH'
    IF v_scope_type = 'SEKOLAH' THEN
        -- Author selalu bisa baca
        IF v_author_id = v_caller_id THEN RETURN true; END IF;
        -- Cek apakah caller ada di forum_post_audience
        RETURN EXISTS (
            SELECT 1 FROM public.forum_post_audience
            WHERE post_id = p_post_id
              AND user_id = v_caller_id
        );
    END IF;

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
$function$;


-- ════════════════════════════════════════════════════════════
-- BAGIAN C — Extend fn_create_forum_post
--   Tambah p_scope_type + p_title, handle path SEKOLAH
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_create_forum_post(
    p_class_id             uuid,
    p_academic_year        text,
    p_content              text,
    p_category_code        text    DEFAULT NULL,
    p_subject_student_ids  uuid[]  DEFAULT '{}',
    p_audience_type        text    DEFAULT 'STAF_SAJA',
    p_specific_user_ids    uuid[]  DEFAULT '{}',
    p_audience_type_2      text    DEFAULT NULL,
    p_specific_user_ids_2  uuid[]  DEFAULT '{}',
    p_scope_type           text    DEFAULT 'KELAS',
    p_title                text    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_caller_id      UUID   := fn_current_user_id();
    v_school_id      UUID   := fn_current_school_id();
    v_post_id        UUID   := gen_random_uuid();
    v_category_id    UUID;
    v_visibility     TEXT;
    v_title          TEXT;
    v_author_name    TEXT;
    v_class_name     TEXT;
    v_audience_ids   UUID[] := ARRAY[]::UUID[];
    v_audience_ids_2 UUID[] := ARRAY[]::UUID[];
BEGIN
    -- ── Validasi konten ───────────────────────────────────────
    IF p_content IS NULL OR length(trim(p_content)) < 3 THEN
        RAISE EXCEPTION 'Isi posting minimal 3 karakter.';
    END IF;

    -- ════════════════════════════════════════════════════════
    -- PATH A: scope_type = 'SEKOLAH'
    -- ════════════════════════════════════════════════════════
    IF p_scope_type = 'SEKOLAH' THEN

        -- Judul wajib untuk forum sekolah
        IF p_title IS NULL OR length(trim(p_title)) = 0 THEN
            RAISE EXCEPTION 'Judul posting wajib diisi untuk forum sekolah.';
        END IF;

        v_title      := trim(p_title);
        v_visibility := 'INTERNAL';

        -- Resolve category_id
        IF p_category_code IS NOT NULL AND trim(p_category_code) <> '' THEN
            SELECT category_id INTO v_category_id
            FROM   communication_categories
            WHERE  category_code = p_category_code AND is_active = true;
        END IF;

        -- INSERT forum_posts (class_id = NULL, scope_type = 'SEKOLAH')
        INSERT INTO forum_posts (
            post_id, school_id, class_id, category_id, author_user_id,
            academic_year, title, body, visibility,
            audience_type, audience_type_2, scope_type
        ) VALUES (
            v_post_id, v_school_id, NULL, v_category_id, v_caller_id,
            p_academic_year, v_title, p_content, v_visibility,
            p_audience_type, p_audience_type_2, 'SEKOLAH'
        );

        -- Audience: gabungan p_specific_user_ids + p_specific_user_ids_2 + author
        v_audience_ids :=
            COALESCE(p_specific_user_ids,   ARRAY[]::UUID[]) ||
            COALESCE(p_specific_user_ids_2, ARRAY[]::UUID[]) ||
            ARRAY[v_caller_id];

        -- INSERT forum_post_audience
        INSERT INTO forum_post_audience (post_id, user_id, school_id)
        SELECT DISTINCT v_post_id, uid, v_school_id
        FROM   unnest(v_audience_ids) uid
        WHERE  uid IS NOT NULL
        ON CONFLICT DO NOTHING;

        -- Kirim notifikasi
        SELECT full_name INTO v_author_name FROM users WHERE user_id = v_caller_id;

        INSERT INTO notifications (
            school_id, recipient_user_id, type, title, body, forum_post_id
        )
        SELECT
            v_school_id,
            fpa.user_id,
            'FORUM_POST_NEW',
            format('Pengumuman: %s', v_title),
            format('%s: %s',
                   coalesce(v_author_name, 'Seseorang'),
                   left(trim(p_content), 80)),
            v_post_id
        FROM   forum_post_audience fpa
        WHERE  fpa.post_id  = v_post_id
          AND  fpa.user_id != v_caller_id;

        RETURN v_post_id;

    END IF;

    -- ════════════════════════════════════════════════════════
    -- PATH B: scope_type = 'KELAS' (logika existing, tidak diubah)
    -- ════════════════════════════════════════════════════════

    v_title := COALESCE(p_title, left(trim(p_content), 200));

    -- ── Validasi audience_type ────────────────────────────────
    IF p_audience_type NOT IN (
        'STAF_SAJA','PUBLIK','ORTU_SISWA_KELAS','ORTU_SISWA_SUBJEK','ORANG_TERTENTU'
    ) THEN
        RAISE EXCEPTION 'audience_type tidak valid: %', p_audience_type;
    END IF;

    IF p_audience_type = 'ORTU_SISWA_SUBJEK'
       AND (p_subject_student_ids IS NULL OR array_length(p_subject_student_ids, 1) IS NULL)
    THEN
        RAISE EXCEPTION 'ORTU_SISWA_SUBJEK membutuhkan minimal 1 subjek siswa di p_subject_student_ids.';
    END IF;

    IF p_audience_type = 'ORANG_TERTENTU'
       AND (p_specific_user_ids IS NULL OR array_length(p_specific_user_ids, 1) IS NULL)
    THEN
        RAISE EXCEPTION 'ORANG_TERTENTU membutuhkan minimal 1 user_id di p_specific_user_ids.';
    END IF;

    -- ── Validasi audience_type_2 (opsional) ──────────────────
    IF p_audience_type_2 IS NOT NULL AND p_audience_type_2 NOT IN (
        'STAF_SAJA','PUBLIK','ORTU_SISWA_KELAS','ORTU_SISWA_SUBJEK','ORANG_TERTENTU'
    ) THEN
        RAISE EXCEPTION 'audience_type_2 tidak valid: %', p_audience_type_2;
    END IF;

    IF p_audience_type_2 = 'ORANG_TERTENTU'
       AND (p_specific_user_ids_2 IS NULL OR array_length(p_specific_user_ids_2, 1) IS NULL)
    THEN
        RAISE EXCEPTION 'ORANG_TERTENTU (audience_type_2) membutuhkan minimal 1 user_id di p_specific_user_ids_2.';
    END IF;

    -- ── Validasi: caller harus anggota forum ──────────────────
    IF NOT EXISTS (
        SELECT 1
        FROM   fn_get_forum_members(p_class_id, p_academic_year, 'PARENT_VISIBLE') m
        WHERE  m.user_id = v_caller_id
    ) THEN
        RAISE EXCEPTION 'Akses ditolak: Anda bukan anggota forum kelas ini.';
    END IF;

    -- ── Resolve category_id dari category_code ────────────────
    IF p_category_code IS NOT NULL AND trim(p_category_code) <> '' THEN
        SELECT category_id INTO v_category_id
        FROM   communication_categories
        WHERE  category_code = p_category_code AND is_active = true;
    END IF;

    -- ── Tentukan visibility ───────────────────────────────────
    -- INTERNAL hanya jika KEDUA audience_type adalah STAF_SAJA (atau _2 NULL).
    -- Jika salah satu melibatkan ortu/siswa → PARENT_VISIBLE.
    v_visibility := CASE
        WHEN p_audience_type = 'STAF_SAJA'
             AND (p_audience_type_2 IS NULL OR p_audience_type_2 = 'STAF_SAJA')
        THEN 'INTERNAL'
        ELSE 'PARENT_VISIBLE'
    END;

    -- ── INSERT forum_posts ────────────────────────────────────
    INSERT INTO forum_posts (
        post_id, school_id, class_id, category_id, author_user_id,
        academic_year, title, body, visibility,
        audience_type, audience_type_2, scope_type
    ) VALUES (
        v_post_id, v_school_id, p_class_id, v_category_id, v_caller_id,
        p_academic_year, v_title, p_content, v_visibility,
        p_audience_type, p_audience_type_2, 'KELAS'
    );

    -- ── INSERT forum_post_subjects ────────────────────────────
    IF p_subject_student_ids IS NOT NULL
       AND array_length(p_subject_student_ids, 1) > 0
    THEN
        INSERT INTO forum_post_subjects (post_id, student_id, school_id)
        SELECT v_post_id, sid, v_school_id
        FROM   unnest(p_subject_student_ids) sid
        ON CONFLICT DO NOTHING;
    END IF;

    -- ── Kalkulasi audience dari audience_type ─────────────────

    IF p_audience_type = 'STAF_SAJA' THEN
        SELECT array_agg(DISTINCT m.user_id)
        INTO   v_audience_ids
        FROM   fn_get_forum_members(p_class_id, p_academic_year, 'INTERNAL') m;

    ELSIF p_audience_type = 'PUBLIK' THEN
        SELECT array_agg(DISTINCT uid)
        INTO   v_audience_ids
        FROM (
            SELECT user_id AS uid
            FROM   fn_get_forum_members(p_class_id, p_academic_year, 'PARENT_VISIBLE')
            UNION
            SELECT s.user_id
            FROM   students s
            JOIN   class_enrollments ce ON ce.student_id = s.student_id
            WHERE  ce.class_id      = p_class_id
              AND  ce.academic_year = p_academic_year
              AND  ce.withdrawn_at  IS NULL
              AND  ce.school_id     = v_school_id
              AND  s.user_id        IS NOT NULL
              AND  s.school_id      = v_school_id
        ) sub;

    ELSIF p_audience_type = 'ORTU_SISWA_KELAS' THEN
        SELECT array_agg(DISTINCT uid)
        INTO   v_audience_ids
        FROM (
            SELECT sp.parent_user_id AS uid
            FROM   student_parents sp
            JOIN   class_enrollments ce ON ce.student_id = sp.student_id
            WHERE  ce.class_id      = p_class_id
              AND  ce.academic_year = p_academic_year
              AND  ce.withdrawn_at  IS NULL
              AND  ce.school_id     = v_school_id
              AND  sp.school_id     = v_school_id
            UNION
            SELECT s.user_id
            FROM   students s
            JOIN   class_enrollments ce ON ce.student_id = s.student_id
            WHERE  ce.class_id      = p_class_id
              AND  ce.academic_year = p_academic_year
              AND  ce.withdrawn_at  IS NULL
              AND  ce.school_id     = v_school_id
              AND  s.user_id        IS NOT NULL
              AND  s.school_id      = v_school_id
        ) sub;

    ELSIF p_audience_type = 'ORTU_SISWA_SUBJEK' THEN
        SELECT array_agg(DISTINCT uid)
        INTO   v_audience_ids
        FROM (
            SELECT sp.parent_user_id AS uid
            FROM   student_parents sp
            WHERE  sp.student_id = ANY(p_subject_student_ids)
              AND  sp.school_id  = v_school_id
            UNION
            SELECT s.user_id
            FROM   students s
            WHERE  s.student_id = ANY(p_subject_student_ids)
              AND  s.user_id    IS NOT NULL
              AND  s.school_id  = v_school_id
        ) sub;

    ELSIF p_audience_type = 'ORANG_TERTENTU' THEN
        SELECT array_agg(DISTINCT uid)
        INTO   v_audience_ids
        FROM (
            SELECT u AS uid
            FROM   unnest(p_specific_user_ids) u
            WHERE  u IN (
                SELECT user_id
                FROM   fn_get_forum_members(p_class_id, p_academic_year, 'PARENT_VISIBLE')
                UNION
                SELECT s.user_id
                FROM   students s
                JOIN   class_enrollments ce ON ce.student_id = s.student_id
                WHERE  ce.class_id      = p_class_id
                  AND  ce.academic_year = p_academic_year
                  AND  ce.withdrawn_at  IS NULL
                  AND  ce.school_id     = v_school_id
                  AND  s.user_id        IS NOT NULL
            )
        ) sub;
    END IF;

    -- ── Kalkulasi audience dari audience_type_2 (jika ada) ───

    IF p_audience_type_2 IS NOT NULL THEN

        IF p_audience_type_2 = 'STAF_SAJA' THEN
            SELECT array_agg(DISTINCT m.user_id)
            INTO   v_audience_ids_2
            FROM   fn_get_forum_members(p_class_id, p_academic_year, 'INTERNAL') m;

        ELSIF p_audience_type_2 = 'PUBLIK' THEN
            SELECT array_agg(DISTINCT uid)
            INTO   v_audience_ids_2
            FROM (
                SELECT user_id AS uid
                FROM   fn_get_forum_members(p_class_id, p_academic_year, 'PARENT_VISIBLE')
                UNION
                SELECT s.user_id
                FROM   students s
                JOIN   class_enrollments ce ON ce.student_id = s.student_id
                WHERE  ce.class_id      = p_class_id
                  AND  ce.academic_year = p_academic_year
                  AND  ce.withdrawn_at  IS NULL
                  AND  ce.school_id     = v_school_id
                  AND  s.user_id        IS NOT NULL
                  AND  s.school_id      = v_school_id
            ) sub;

        ELSIF p_audience_type_2 = 'ORTU_SISWA_KELAS' THEN
            SELECT array_agg(DISTINCT uid)
            INTO   v_audience_ids_2
            FROM (
                SELECT sp.parent_user_id AS uid
                FROM   student_parents sp
                JOIN   class_enrollments ce ON ce.student_id = sp.student_id
                WHERE  ce.class_id      = p_class_id
                  AND  ce.academic_year = p_academic_year
                  AND  ce.withdrawn_at  IS NULL
                  AND  ce.school_id     = v_school_id
                  AND  sp.school_id     = v_school_id
                UNION
                SELECT s.user_id
                FROM   students s
                JOIN   class_enrollments ce ON ce.student_id = s.student_id
                WHERE  ce.class_id      = p_class_id
                  AND  ce.academic_year = p_academic_year
                  AND  ce.withdrawn_at  IS NULL
                  AND  ce.school_id     = v_school_id
                  AND  s.user_id        IS NOT NULL
                  AND  s.school_id      = v_school_id
            ) sub;

        ELSIF p_audience_type_2 = 'ORTU_SISWA_SUBJEK' THEN
            SELECT array_agg(DISTINCT uid)
            INTO   v_audience_ids_2
            FROM (
                SELECT sp.parent_user_id AS uid
                FROM   student_parents sp
                WHERE  sp.student_id = ANY(p_subject_student_ids)
                  AND  sp.school_id  = v_school_id
                UNION
                SELECT s.user_id
                FROM   students s
                WHERE  s.student_id = ANY(p_subject_student_ids)
                  AND  s.user_id    IS NOT NULL
                  AND  s.school_id  = v_school_id
            ) sub;

        ELSIF p_audience_type_2 = 'ORANG_TERTENTU' THEN
            SELECT array_agg(DISTINCT uid)
            INTO   v_audience_ids_2
            FROM (
                SELECT u AS uid
                FROM   unnest(p_specific_user_ids_2) u
                WHERE  u IN (
                    SELECT user_id
                    FROM   fn_get_forum_members(p_class_id, p_academic_year, 'PARENT_VISIBLE')
                    UNION
                    SELECT s.user_id
                    FROM   students s
                    JOIN   class_enrollments ce ON ce.student_id = s.student_id
                    WHERE  ce.class_id      = p_class_id
                      AND  ce.academic_year = p_academic_year
                      AND  ce.withdrawn_at  IS NULL
                      AND  ce.school_id     = v_school_id
                      AND  s.user_id        IS NOT NULL
                )
            ) sub;
        END IF;

    END IF;

    -- ── Gabungkan audience dari kedua tipe + selalu sertakan penulis ──
    v_audience_ids :=
        COALESCE(v_audience_ids,   ARRAY[]::UUID[]) ||
        COALESCE(v_audience_ids_2, ARRAY[]::UUID[]) ||
        ARRAY[v_caller_id];

    -- ── INSERT forum_post_audience ────────────────────────────
    INSERT INTO forum_post_audience (post_id, user_id, school_id)
    SELECT DISTINCT v_post_id, uid, v_school_id
    FROM   unnest(v_audience_ids) uid
    WHERE  uid IS NOT NULL
    ON CONFLICT DO NOTHING;

    -- ── Kirim notifikasi FORUM_POST_NEW ───────────────────────
    SELECT full_name INTO v_author_name FROM users   WHERE user_id  = v_caller_id;
    SELECT name       INTO v_class_name  FROM classes WHERE class_id = p_class_id;

    INSERT INTO notifications (
        school_id, recipient_user_id, type, title, body, forum_post_id
    )
    SELECT
        v_school_id,
        fpa.user_id,
        'FORUM_POST_NEW',
        format('Posting baru di %s', coalesce(v_class_name, 'Forum Kelas')),
        format('%s: %s',
               coalesce(v_author_name, 'Seseorang'),
               left(trim(p_content), 80)),
        v_post_id
    FROM   forum_post_audience fpa
    WHERE  fpa.post_id  = v_post_id
      AND  fpa.user_id != v_caller_id;

    RETURN v_post_id;
END;
$function$;


-- ════════════════════════════════════════════════════════════
-- BAGIAN D — Fungsi Baru: fn_get_forum_recipient_candidates
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_get_forum_recipient_candidates(
  p_target_group  text,
  p_program_id    uuid     DEFAULT NULL,
  p_class_id      uuid     DEFAULT NULL,
  p_day_of_week   smallint DEFAULT NULL,
  p_academic_year text     DEFAULT NULL
)
RETURNS TABLE (
  user_id    uuid,
  full_name  text,
  role_label text,
  extra_info text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

GRANT  EXECUTE ON FUNCTION public.fn_get_forum_recipient_candidates TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_get_forum_recipient_candidates FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_get_forum_recipient_candidates FROM PUBLIC;
