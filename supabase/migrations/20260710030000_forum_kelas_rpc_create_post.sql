-- ============================================================
-- Migration 20260710030000: Forum Kelas — RPC + Fixes
--
-- Tiga perubahan:
--
-- §1. DROP trg_notify_forum_post (digantikan fn_create_forum_post)
--     Trigger lama populate forum_post_audience + kirim notif.
--     Jika dibiarkan, trigger akan KONFLIK dengan RPC baru yang
--     juga INSERT ke forum_post_audience → duplicate PK error.
--     Kedua tanggung jawab trigger ini dialihkan ke RPC.
--
-- §2. FIX fn_can_read_forum_post — tambah cek Guru Mapel
--     BUG di 20260710020000: fn_get_forum_members menyertakan
--     Guru Mapel (teaching_assignments) sebagai anggota forum,
--     tapi fn_can_read_forum_post tidak punya cek itu.
--     Akibat: guru yang mengajar kelas tidak bisa baca posting
--     forum kelasnya sendiri. Diperbaiki di sini.
--
-- §3. CREATE fn_create_forum_post — atomic RPC
--     Satu fungsi SECURITY DEFINER yang menangani:
--     validasi keanggotaan, INSERT forum_posts,
--     INSERT forum_post_subjects, kalkulasi audience per
--     audience_type, INSERT forum_post_audience,
--     kirim notifikasi FORUM_POST_NEW.
--     Semua dalam satu transaksi atomik.
-- ============================================================


-- ─── §1. DROP trigger lama ───────────────────────────────────
-- Trigger ini dibuatkan pengganti oleh fn_create_forum_post.
-- INSERT langsung ke forum_posts tanpa fn_create_forum_post
-- tidak akan populate audience — ini disengaja.
DROP TRIGGER IF EXISTS trg_notify_forum_post ON forum_posts;
DROP FUNCTION IF EXISTS fn_notify_on_forum_post();


-- ─── §2. FIX fn_can_read_forum_post ─────────────────────────
-- Tambah cek Guru Mapel (teaching_assignments) sebagai check #3.
-- Nomor urut #3-#5 digeser satu ke bawah dari versi sebelumnya.
CREATE OR REPLACE FUNCTION fn_can_read_forum_post(p_post_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
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

    -- 3. Guru Mapel yang mengajar kelas ini di periode academic_year posting
    --    (FIX: cek ini HILANG di 20260710020000 — lihat header migration)
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

    RETURN false;
END;
$$;

REVOKE ALL    ON FUNCTION fn_can_read_forum_post(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fn_can_read_forum_post(UUID) TO authenticated;


-- ─── §3. CREATE fn_create_forum_post ─────────────────────────
--
-- Parameter audience_type:
--   STAF_SAJA         → semua staf forum (wali kelas + guru mapel
--                        + guru wali + BK). visibility = INTERNAL.
--   PUBLIK            → semua staf + ortu + siswa aktif di kelas.
--                        visibility = PARENT_VISIBLE.
--   ORTU_SISWA_KELAS  → ortu + siswa SEMUA siswa aktif di kelas.
--                        visibility = PARENT_VISIBLE.
--   ORTU_SISWA_SUBJEK → ortu + user_id siswa dari p_subject_student_ids
--                        saja. Butuh ≥1 subjek siswa.
--                        visibility = PARENT_VISIBLE.
--   ORANG_TERTENTU    → daftar eksplisit p_specific_user_ids,
--                        divalidasi sebagai anggota forum.
--                        visibility = PARENT_VISIBLE.
--
-- Penulis (caller) selalu dimasukkan ke audience, terlepas
-- dari audience_type yang dipilih.
--
-- Title di forum_posts di-auto-generate dari 200 karakter
-- pertama p_content (kolom title wajib di skema).
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_create_forum_post(
    p_class_id              UUID,
    p_academic_year         TEXT,
    p_content               TEXT,
    p_category_code         TEXT    DEFAULT NULL,
    p_subject_student_ids   UUID[]  DEFAULT '{}',
    p_audience_type         TEXT    DEFAULT 'STAF_SAJA',
    p_specific_user_ids     UUID[]  DEFAULT '{}'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_caller_id     UUID   := fn_current_user_id();
    v_school_id     UUID   := fn_current_school_id();
    v_post_id       UUID   := gen_random_uuid();
    v_category_id   UUID;
    v_visibility    TEXT;
    v_title         TEXT;
    v_author_name   TEXT;
    v_class_name    TEXT;
    v_audience_ids  UUID[] := ARRAY[]::UUID[];
BEGIN
    -- ── Validasi konten ───────────────────────────────────────
    IF p_content IS NULL OR length(trim(p_content)) < 3 THEN
        RAISE EXCEPTION 'Isi posting minimal 3 karakter.';
    END IF;
    v_title := left(trim(p_content), 200);

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

    -- ── Validasi: caller harus anggota forum ──────────────────
    -- Gunakan PARENT_VISIBLE untuk cakupan terluas (termasuk ortu).
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
        -- Jika tidak ditemukan, v_category_id stays NULL (aman)
    END IF;

    -- ── Tentukan visibility ───────────────────────────────────
    -- fn_can_read_forum_post menggunakan kolom ini untuk cek ortu.
    -- STAF_SAJA → INTERNAL (blok ortu di level RLS).
    -- Semua lainnya → PARENT_VISIBLE.
    v_visibility := CASE p_audience_type
        WHEN 'STAF_SAJA' THEN 'INTERNAL'
        ELSE                   'PARENT_VISIBLE'
    END;

    -- ── INSERT forum_posts ────────────────────────────────────
    INSERT INTO forum_posts (
        post_id, school_id, class_id, category_id, author_user_id,
        academic_year, title, body, visibility
    ) VALUES (
        v_post_id, v_school_id, p_class_id, v_category_id, v_caller_id,
        p_academic_year, v_title, p_content, v_visibility
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

    -- ── Kalkulasi audience ────────────────────────────────────

    IF p_audience_type = 'STAF_SAJA' THEN
        -- Semua staf forum: wali kelas + guru mapel + guru wali + BK
        SELECT array_agg(DISTINCT m.user_id)
        INTO   v_audience_ids
        FROM   fn_get_forum_members(p_class_id, p_academic_year, 'INTERNAL') m;

    ELSIF p_audience_type = 'PUBLIK' THEN
        -- Staf (PARENT_VISIBLE sudah include ortu) + siswa aktif di kelas
        SELECT array_agg(DISTINCT uid)
        INTO   v_audience_ids
        FROM (
            SELECT user_id AS uid
            FROM   fn_get_forum_members(p_class_id, p_academic_year, 'PARENT_VISIBLE')
            UNION
            -- Siswa aktif di kelas (fn_get_forum_members tidak include siswa)
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
        -- Ortu + siswa semua siswa aktif di kelas (tidak termasuk staf)
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
        -- Ortu + user_id hanya dari siswa yang jadi subjek posting
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
        -- Daftar eksplisit, difilter: hanya yang benar-benar anggota forum
        -- (staf ATAU ortu/siswa aktif di kelas ini)
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

    -- Selalu sertakan penulis (walaupun tidak ada di hasil audience_type di atas)
    v_audience_ids := COALESCE(v_audience_ids, ARRAY[]::UUID[]) || ARRAY[v_caller_id];

    -- ── INSERT forum_post_audience ────────────────────────────
    -- SECURITY DEFINER memberi izin INSERT walaupun authenticated
    -- hanya punya SELECT pada tabel ini (sesuai grant di 20260710020000).
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
$$;

-- Dua lapis REVOKE (Rule §3a)
REVOKE ALL    ON FUNCTION fn_create_forum_post(UUID, TEXT, TEXT, TEXT, UUID[], TEXT, UUID[])
              FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fn_create_forum_post(UUID, TEXT, TEXT, TEXT, UUID[], TEXT, UUID[])
              TO authenticated;
