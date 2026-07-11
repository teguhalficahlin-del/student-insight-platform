-- ============================================================
-- Migration 20260710020000: Forum Kelas (initial)
--
-- Forum diskusi per-kelas antara guru, guru wali, BK, dan
-- (opsional) orang tua siswa. Menggantikan parent_messages.
--
-- Urutan:
--   a. communication_categories (global lookup) + seed 13 kategori
--   b. guru_wali_assignments
--   c. bk_class_assignments
--   d. forum_posts
--   e. forum_post_subjects
--   f. forum_post_audience
--   g. forum_post_acknowledgements
--   h. forum_post_comments
--   i. fn_get_forum_members
--   j. fn_can_read_forum_post
--   k. RLS policies
--   l. GRANT/REVOKE (dua lapis, Rule §3a)
--   m. ALTER TABLE notifications (kolom FK baru + tipe baru)
--   n. fn_notify_on_forum_post + trigger trg_notify_forum_post
--      (juga populate forum_post_audience)
--   o. fn_notify_on_forum_comment + trigger trg_notify_forum_comment
--   p. DROP parent_messages (FK case_events dulu, baru tabel)
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- a. TABLE: communication_categories
--    Lookup global (tanpa school_id) — dipakai semua sekolah.
--    Dikelola oleh superadmin/service_role.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE communication_categories (
    category_id   UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    category_code TEXT    NOT NULL UNIQUE CHECK (length(trim(category_code)) > 0),
    label_sekolah TEXT    NOT NULL CHECK (length(trim(label_sekolah)) > 0),
    polarity      TEXT    NOT NULL DEFAULT 'NEUTRAL'
                      CHECK (polarity IN ('POSITIVE','NEGATIVE','NEUTRAL')),
    display_order INTEGER NOT NULL DEFAULT 0,
    is_active     BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX idx_comm_cat_order ON communication_categories(display_order, category_code);

COMMENT ON TABLE communication_categories IS
    'Kategori topik posting forum kelas. Global (tanpa school_id), '
    'dikelola service_role/superadmin. polarity: POSITIVE/NEGATIVE/NEUTRAL.';

-- Seed: 13 kategori standar
INSERT INTO communication_categories (category_code, label_sekolah, polarity, display_order) VALUES
    ('AKADEMIK',        'Akademik & Belajar',             'NEUTRAL',  1),
    ('PRESTASI',        'Prestasi & Penghargaan',         'POSITIVE', 2),
    ('KEHADIRAN',       'Kehadiran & Keterlambatan',      'NEGATIVE', 3),
    ('DISIPLIN',        'Kedisiplinan',                   'NEGATIVE', 4),
    ('KESEHATAN_FISIK', 'Kesehatan Fisik',                'NEUTRAL',  5),
    ('KESEHATAN_MENTAL','Kesehatan Mental & Emosional',   'NEUTRAL',  6),
    ('SOSIAL',          'Hubungan Sosial & Pertemanan',   'NEUTRAL',  7),
    ('KELUARGA',        'Keluarga & Kondisi Rumah',       'NEUTRAL',  8),
    ('PKL',             'PKL & Magang',                   'NEUTRAL',  9),
    ('EKSKUL',          'Ekstrakurikuler & Kegiatan',     'POSITIVE', 10),
    ('PENGUMUMAN',      'Pengumuman Kelas',               'NEUTRAL',  11),
    ('TUGAS',           'Tugas & Penilaian',              'NEUTRAL',  12),
    ('LAINNYA',         'Lainnya',                        'NEUTRAL',  13);


-- ─────────────────────────────────────────────────────────────
-- b. TABLE: guru_wali_assignments
--    Penugasan Guru Wali PER SISWA (bukan per kelas langsung).
--    Satu Guru Wali bisa menangani siswa dari beberapa kelas
--    → otomatis masuk forum semua kelas yang ada siswa dampingannya.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE guru_wali_assignments (
    assignment_id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id           UUID        NOT NULL REFERENCES schools(school_id)   ON DELETE RESTRICT,
    guru_user_id        UUID        NOT NULL REFERENCES users(user_id)       ON DELETE RESTRICT,
    student_id          UUID        NOT NULL REFERENCES students(student_id) ON DELETE RESTRICT,
    academic_year       TEXT        NOT NULL CHECK (length(trim(academic_year)) > 0),
    is_active           BOOLEAN     NOT NULL DEFAULT true,
    assigned_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    assigned_by_user_id UUID        REFERENCES users(user_id) ON DELETE SET NULL,

    CONSTRAINT uq_guru_wali_student_year
        UNIQUE (school_id, student_id, academic_year)
);

CREATE INDEX idx_guru_wali_guru    ON guru_wali_assignments(school_id, guru_user_id, academic_year);
CREATE INDEX idx_guru_wali_student ON guru_wali_assignments(school_id, student_id,   academic_year);

COMMENT ON TABLE guru_wali_assignments IS
    'Penugasan Guru Wali per siswa per tahun ajaran. '
    'Satu Guru Wali bisa menangani siswa dari beberapa kelas.';


-- ─────────────────────────────────────────────────────────────
-- c. TABLE: bk_class_assignments
--    Penugasan staf BK ke kelas tertentu untuk akses forum.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE bk_class_assignments (
    assignment_id       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id           UUID        NOT NULL REFERENCES schools(school_id) ON DELETE RESTRICT,
    bk_user_id          UUID        NOT NULL REFERENCES users(user_id)    ON DELETE RESTRICT,
    class_id            UUID        NOT NULL REFERENCES classes(class_id) ON DELETE RESTRICT,
    academic_year       TEXT        NOT NULL CHECK (length(trim(academic_year)) > 0),
    is_active           BOOLEAN     NOT NULL DEFAULT true,
    assigned_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    assigned_by_user_id UUID        REFERENCES users(user_id) ON DELETE SET NULL,

    CONSTRAINT uq_bk_class_year
        UNIQUE (school_id, bk_user_id, class_id, academic_year)
);

CREATE INDEX idx_bk_class_bk    ON bk_class_assignments(school_id, bk_user_id, academic_year);
CREATE INDEX idx_bk_class_class ON bk_class_assignments(school_id, class_id,   academic_year);

COMMENT ON TABLE bk_class_assignments IS
    'Penugasan staf BK ke kelas untuk akses forum kelas.';


-- ─────────────────────────────────────────────────────────────
-- d. TABLE: forum_posts
--    Posting utama di forum kelas.
--    visibility=INTERNAL: hanya guru/BK/guru wali
--    visibility=PARENT_VISIBLE: + ortu siswa aktif di kelas
-- ─────────────────────────────────────────────────────────────
CREATE TABLE forum_posts (
    post_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id      UUID        NOT NULL REFERENCES schools(school_id)              ON DELETE RESTRICT,
    class_id       UUID        NOT NULL REFERENCES classes(class_id)               ON DELETE RESTRICT,
    category_id    UUID        REFERENCES communication_categories(category_id)    ON DELETE SET NULL,
    author_user_id UUID        NOT NULL REFERENCES users(user_id)                  ON DELETE RESTRICT,
    academic_year  TEXT        NOT NULL CHECK (length(trim(academic_year)) > 0),
    title          TEXT        NOT NULL CHECK (length(trim(title)) >= 3),
    body           TEXT        NOT NULL CHECK (length(trim(body))  >= 1),
    visibility     TEXT        NOT NULL DEFAULT 'INTERNAL'
                       CHECK (visibility IN ('INTERNAL','PARENT_VISIBLE')),
    is_pinned      BOOLEAN     NOT NULL DEFAULT false,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_forum_posts_class  ON forum_posts(school_id, class_id, academic_year, created_at DESC);
CREATE INDEX idx_forum_posts_author ON forum_posts(school_id, author_user_id, created_at DESC);
CREATE INDEX idx_forum_posts_pinned ON forum_posts(school_id, class_id, academic_year, is_pinned DESC, created_at DESC);

COMMENT ON TABLE forum_posts IS
    'Posting utama di forum kelas. '
    'visibility=INTERNAL: hanya guru/BK/guru wali. '
    'visibility=PARENT_VISIBLE: + ortu siswa aktif di kelas.';


-- ─────────────────────────────────────────────────────────────
-- e. TABLE: forum_post_subjects
--    Siswa yang menjadi subjek/topik posting (opsional).
-- ─────────────────────────────────────────────────────────────
CREATE TABLE forum_post_subjects (
    post_id    UUID NOT NULL REFERENCES forum_posts(post_id)       ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES students(student_id)       ON DELETE CASCADE,
    school_id  UUID NOT NULL REFERENCES schools(school_id)         ON DELETE RESTRICT,
    PRIMARY KEY (post_id, student_id)
);

CREATE INDEX idx_forum_subj_student ON forum_post_subjects(school_id, student_id);

COMMENT ON TABLE forum_post_subjects IS
    'Siswa yang menjadi subjek posting forum (opsional, bisa lebih dari satu).';


-- ─────────────────────────────────────────────────────────────
-- f. TABLE: forum_post_audience
--    Daftar user yang berhak membaca posting ini.
--    Di-populate otomatis oleh trigger trg_notify_forum_post
--    saat posting baru dibuat (AFTER INSERT ON forum_posts).
-- ─────────────────────────────────────────────────────────────
CREATE TABLE forum_post_audience (
    post_id   UUID        NOT NULL REFERENCES forum_posts(post_id) ON DELETE CASCADE,
    user_id   UUID        NOT NULL REFERENCES users(user_id)       ON DELETE CASCADE,
    school_id UUID        NOT NULL REFERENCES schools(school_id)   ON DELETE RESTRICT,
    added_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (post_id, user_id)
);

CREATE INDEX idx_forum_aud_user ON forum_post_audience(school_id, user_id);
CREATE INDEX idx_forum_aud_post ON forum_post_audience(post_id);

COMMENT ON TABLE forum_post_audience IS
    'Daftar user yang berhak membaca posting forum. '
    'Diisi otomatis oleh trigger saat posting dibuat. '
    'Dipakai oleh fn_notify_on_forum_post untuk pengiriman notifikasi.';


-- ─────────────────────────────────────────────────────────────
-- g. TABLE: forum_post_acknowledgements
--    Tanda sudah-baca dari anggota forum pada posting.
--    Juga menentukan penerima notif komentar baru.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE forum_post_acknowledgements (
    post_id         UUID        NOT NULL REFERENCES forum_posts(post_id) ON DELETE CASCADE,
    user_id         UUID        NOT NULL REFERENCES users(user_id)       ON DELETE CASCADE,
    school_id       UUID        NOT NULL REFERENCES schools(school_id)   ON DELETE RESTRICT,
    acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (post_id, user_id)
);

CREATE INDEX idx_forum_ack_post ON forum_post_acknowledgements(post_id);
CREATE INDEX idx_forum_ack_user ON forum_post_acknowledgements(school_id, user_id);

COMMENT ON TABLE forum_post_acknowledgements IS
    'Tanda sudah-baca dari anggota forum. '
    'Penerima notif komentar baru = penulis posting + yang sudah ack + komentator sebelumnya.';


-- ─────────────────────────────────────────────────────────────
-- h. TABLE: forum_post_comments
--    Komentar/balasan pada posting forum.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE forum_post_comments (
    comment_id     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id        UUID        NOT NULL REFERENCES forum_posts(post_id) ON DELETE CASCADE,
    school_id      UUID        NOT NULL REFERENCES schools(school_id)   ON DELETE RESTRICT,
    author_user_id UUID        NOT NULL REFERENCES users(user_id)       ON DELETE RESTRICT,
    body           TEXT        NOT NULL CHECK (length(trim(body)) >= 1),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_forum_comments_post   ON forum_post_comments(post_id, created_at ASC);
CREATE INDEX idx_forum_comments_author ON forum_post_comments(school_id, author_user_id);

COMMENT ON TABLE forum_post_comments IS
    'Komentar/balasan pada posting forum kelas.';


-- ─────────────────────────────────────────────────────────────
-- i. FUNCTION: fn_get_forum_members
--    Kembalikan SET OF UUID (user_id) yang berhak membaca
--    forum posting di kelas ini, sesuai visibility.
--
--    Sumber school_id: dari tabel classes (bukan fn_current_school_id)
--    agar bisa dipanggil dari trigger maupun service_role.
--
--    Semua tabel memakai format academic_year slash: "2026/2027".
--    teaching_assignments juga memakai slash — cocokkan langsung
--    dengan p_academic_year (TANPA konversi SPLIT_PART).
--
--    Member:
--    1. Wali Kelas (users.wali_kelas_class_id = p_class_id)
--    2. Guru Mapel yang mengajar di kelas (teaching_assignments)
--    3. Guru Wali yang menangani siswa aktif di kelas
--       (via class_enrollments → guru_wali_assignments)
--    4. BK yang ditugaskan ke kelas (bk_class_assignments)
--    5. Ortu siswa aktif (hanya jika PARENT_VISIBLE)
-- ─────────────────────────────────────────────────────────────
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
    v_school_id UUID;
BEGIN
    -- Ambil school_id dari kelas (bukan dari JWT — bisa dipanggil service_role)
    SELECT c.school_id INTO v_school_id
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

    -- 2. Guru Mapel yang mengajar di kelas ini
    --    teaching_assignments.academic_year memakai format slash (2026/2027)
    --    sama dengan p_academic_year — cocokkan langsung, tanpa SPLIT_PART
    SELECT DISTINCT ta.user_id
    FROM   teaching_assignments ta
    WHERE  ta.class_id      = p_class_id
      AND  ta.academic_year = p_academic_year
      AND  ta.is_active     = true
      AND  ta.school_id     = v_school_id

    UNION

    -- 3. Guru Wali yang menangani siswa aktif di kelas ini
    --    guru_wali_assignments.academic_year memakai format slash (2026/2027)
    --    is_active = TRUE + academic_year harus cocok
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
    --    bk_class_assignments.academic_year memakai format slash (2026/2027)
    --    is_active = TRUE + academic_year harus cocok
    SELECT DISTINCT bca.bk_user_id
    FROM   bk_class_assignments bca
    WHERE  bca.class_id      = p_class_id
      AND  bca.academic_year = p_academic_year
      AND  bca.is_active     = true
      AND  bca.school_id     = v_school_id

    UNION

    -- 5. Ortu siswa aktif di kelas (hanya jika PARENT_VISIBLE)
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


-- ─────────────────────────────────────────────────────────────
-- j. FUNCTION: fn_can_read_forum_post
--    Helper RLS: apakah user saat ini boleh baca posting ini?
--    Compute real-time (tidak bergantung pada audience table).
--
--    Urutan cek:
--    1. Penulis posting sendiri
--    2. Wali Kelas untuk kelas posting
--    3. Guru Wali dengan siswa aktif di kelas (is_active + academic_year)
--    4. BK yang ditugaskan ke kelas (is_active + academic_year)
--    5. Ortu siswa aktif di kelas (hanya jika PARENT_VISIBLE)
-- ─────────────────────────────────────────────────────────────
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

    IF NOT FOUND THEN
        RETURN false;
    END IF;

    -- 1. Penulis selalu bisa baca posting sendiri
    IF fn_current_user_id() = v_author_id THEN
        RETURN true;
    END IF;

    -- 2. Wali Kelas untuk kelas ini
    IF EXISTS (
        SELECT 1 FROM users u
        WHERE  u.user_id             = fn_current_user_id()
          AND  u.wali_kelas_class_id = v_class_id
          AND  u.school_id           = v_school_id
          AND  u.is_active           = true
          AND  u.deleted_at          IS NULL
    ) THEN
        RETURN true;
    END IF;

    -- 3. Guru Wali yang menangani siswa aktif di kelas ini
    --    is_active = TRUE dan academic_year cocok dengan posting
    IF EXISTS (
        SELECT 1
        FROM   guru_wali_assignments gwa
        WHERE  gwa.guru_user_id  = fn_current_user_id()
          AND  gwa.academic_year = v_academic_year
          AND  gwa.is_active     = true
          AND  gwa.school_id     = v_school_id
          AND  gwa.student_id IN (
                   SELECT ce.student_id
                   FROM   class_enrollments ce
                   WHERE  ce.class_id      = v_class_id
                     AND  ce.academic_year = v_academic_year
                     AND  ce.withdrawn_at  IS NULL
                     AND  ce.school_id     = v_school_id
               )
    ) THEN
        RETURN true;
    END IF;

    -- 4. BK yang ditugaskan ke kelas ini
    --    is_active = TRUE dan academic_year cocok dengan posting
    IF EXISTS (
        SELECT 1
        FROM   bk_class_assignments bca
        WHERE  bca.bk_user_id    = fn_current_user_id()
          AND  bca.class_id      = v_class_id
          AND  bca.academic_year = v_academic_year
          AND  bca.is_active     = true
          AND  bca.school_id     = v_school_id
    ) THEN
        RETURN true;
    END IF;

    -- 5. Ortu siswa aktif di kelas (hanya jika PARENT_VISIBLE)
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
    ) THEN
        RETURN true;
    END IF;

    RETURN false;
END;
$$;

REVOKE ALL    ON FUNCTION fn_can_read_forum_post(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fn_can_read_forum_post(UUID) TO authenticated;


-- ─────────────────────────────────────────────────────────────
-- k. RLS POLICIES
-- ─────────────────────────────────────────────────────────────

-- communication_categories (global, tanpa school_id)
ALTER TABLE communication_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY rls_comm_cat_read ON communication_categories FOR SELECT
    TO authenticated
    USING (is_active = true);

-- forum_posts
ALTER TABLE forum_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY rls_forum_posts_read ON forum_posts FOR SELECT
    USING (school_id = fn_current_school_id()
           AND fn_can_read_forum_post(post_id));

CREATE POLICY rls_forum_posts_insert ON forum_posts FOR INSERT
    WITH CHECK (
        school_id      = fn_current_school_id()
        AND author_user_id = fn_current_user_id()
    );

CREATE POLICY rls_forum_posts_update ON forum_posts FOR UPDATE
    USING  (school_id = fn_current_school_id() AND author_user_id = fn_current_user_id())
    WITH CHECK (school_id = fn_current_school_id() AND author_user_id = fn_current_user_id());

CREATE POLICY rls_forum_posts_delete ON forum_posts FOR DELETE
    USING (school_id = fn_current_school_id()
           AND (author_user_id = fn_current_user_id()
                OR fn_current_user_role() IN ('KEPSEK','WAKA_KESISWAAN')));

-- guru_wali_assignments
ALTER TABLE guru_wali_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY rls_guru_wali_read ON guru_wali_assignments FOR SELECT
    USING (school_id = fn_current_school_id());

CREATE POLICY rls_guru_wali_write ON guru_wali_assignments FOR ALL
    USING  (school_id = fn_current_school_id()
            AND fn_current_user_role() IN ('KEPSEK','WAKA_KESISWAAN'))
    WITH CHECK (school_id = fn_current_school_id()
            AND fn_current_user_role() IN ('KEPSEK','WAKA_KESISWAAN'));

-- bk_class_assignments
ALTER TABLE bk_class_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY rls_bk_class_read ON bk_class_assignments FOR SELECT
    USING (school_id = fn_current_school_id());

CREATE POLICY rls_bk_class_write ON bk_class_assignments FOR ALL
    USING  (school_id = fn_current_school_id()
            AND fn_current_user_role() IN ('KEPSEK','WAKA_KESISWAAN'))
    WITH CHECK (school_id = fn_current_school_id()
            AND fn_current_user_role() IN ('KEPSEK','WAKA_KESISWAAN'));

-- forum_post_subjects
ALTER TABLE forum_post_subjects ENABLE ROW LEVEL SECURITY;

CREATE POLICY rls_forum_subj_read ON forum_post_subjects FOR SELECT
    USING (school_id = fn_current_school_id()
           AND fn_can_read_forum_post(post_id));

CREATE POLICY rls_forum_subj_write ON forum_post_subjects FOR ALL
    USING  (school_id = fn_current_school_id())
    WITH CHECK (school_id = fn_current_school_id());

-- forum_post_audience
-- INSERT/DELETE hanya service_role (via trigger). authenticated hanya SELECT (terbatas).
ALTER TABLE forum_post_audience ENABLE ROW LEVEL SECURITY;

CREATE POLICY rls_forum_aud_read ON forum_post_audience FOR SELECT
    USING (school_id = fn_current_school_id()
           AND fn_can_read_forum_post(post_id));

-- forum_post_acknowledgements
ALTER TABLE forum_post_acknowledgements ENABLE ROW LEVEL SECURITY;

CREATE POLICY rls_forum_ack_read ON forum_post_acknowledgements FOR SELECT
    USING (school_id = fn_current_school_id()
           AND fn_can_read_forum_post(post_id));

CREATE POLICY rls_forum_ack_insert ON forum_post_acknowledgements FOR INSERT
    WITH CHECK (
        school_id = fn_current_school_id()
        AND user_id = fn_current_user_id()
        AND fn_can_read_forum_post(post_id)
    );

CREATE POLICY rls_forum_ack_delete ON forum_post_acknowledgements FOR DELETE
    USING (school_id = fn_current_school_id()
           AND user_id = fn_current_user_id());

-- forum_post_comments
ALTER TABLE forum_post_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY rls_forum_comments_read ON forum_post_comments FOR SELECT
    USING (school_id = fn_current_school_id()
           AND fn_can_read_forum_post(post_id));

CREATE POLICY rls_forum_comments_insert ON forum_post_comments FOR INSERT
    WITH CHECK (
        school_id      = fn_current_school_id()
        AND author_user_id = fn_current_user_id()
        AND fn_can_read_forum_post(post_id)
    );

CREATE POLICY rls_forum_comments_update ON forum_post_comments FOR UPDATE
    USING  (school_id = fn_current_school_id() AND author_user_id = fn_current_user_id())
    WITH CHECK (school_id = fn_current_school_id() AND author_user_id = fn_current_user_id());

CREATE POLICY rls_forum_comments_delete ON forum_post_comments FOR DELETE
    USING (school_id = fn_current_school_id()
           AND (author_user_id = fn_current_user_id()
                OR fn_current_user_role() IN ('KEPSEK','WAKA_KESISWAAN')));


-- ─────────────────────────────────────────────────────────────
-- l. GRANT/REVOKE — dua lapis (Rule §3a)
-- ─────────────────────────────────────────────────────────────

REVOKE ALL ON communication_categories     FROM PUBLIC, anon;
GRANT SELECT ON communication_categories   TO authenticated;
GRANT ALL    ON communication_categories   TO service_role;

REVOKE ALL ON guru_wali_assignments                      FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON guru_wali_assignments TO authenticated;
GRANT ALL ON guru_wali_assignments                       TO service_role;

REVOKE ALL ON bk_class_assignments                      FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON bk_class_assignments TO authenticated;
GRANT ALL ON bk_class_assignments                       TO service_role;

REVOKE ALL ON forum_posts                               FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON forum_posts     TO authenticated;
GRANT ALL ON forum_posts                                TO service_role;

REVOKE ALL ON forum_post_subjects                       FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON forum_post_subjects     TO authenticated;
GRANT ALL ON forum_post_subjects                        TO service_role;

-- forum_post_audience: authenticated hanya SELECT; INSERT via trigger (service_role)
REVOKE ALL ON forum_post_audience                       FROM PUBLIC, anon;
GRANT SELECT ON forum_post_audience                     TO authenticated;
GRANT ALL    ON forum_post_audience                     TO service_role;

REVOKE ALL ON forum_post_acknowledgements               FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON forum_post_acknowledgements TO authenticated;
GRANT ALL ON forum_post_acknowledgements                TO service_role;

REVOKE ALL ON forum_post_comments                       FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON forum_post_comments TO authenticated;
GRANT ALL ON forum_post_comments                        TO service_role;


-- ─────────────────────────────────────────────────────────────
-- m. ALTER TABLE notifications
--    Tambah kolom FK baru + perluas CHECK type
--
--    Tipe yang sudah ada (live):
--      ESCALATION_DM, CASE_BROADCAST, LOGIN_NEW_DEVICE,
--      OBSERVATION_NEW, CASE_RESTRICTED_NEW, CASE_STUDENT_UPDATE
--    Tambah:
--      FORUM_POST_NEW, FORUM_COMMENT_NEW
-- ─────────────────────────────────────────────────────────────
ALTER TABLE notifications
    ADD COLUMN forum_post_id    UUID REFERENCES forum_posts(post_id)            ON DELETE SET NULL,
    ADD COLUMN forum_comment_id UUID REFERENCES forum_post_comments(comment_id)  ON DELETE SET NULL;

-- Perluas CHECK: drop lama, tambah baru dengan semua 8 tipe
ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;

ALTER TABLE notifications
    ADD CONSTRAINT notifications_type_check
        CHECK (type IN (
            'ESCALATION_DM',
            'CASE_BROADCAST',
            'LOGIN_NEW_DEVICE',
            'OBSERVATION_NEW',
            'CASE_RESTRICTED_NEW',
            'CASE_STUDENT_UPDATE',
            'FORUM_POST_NEW',
            'FORUM_COMMENT_NEW'
        ));

COMMENT ON COLUMN notifications.forum_post_id IS
    'FK ke forum_posts; diisi untuk notif FORUM_POST_NEW dan FORUM_COMMENT_NEW.';
COMMENT ON COLUMN notifications.forum_comment_id IS
    'FK ke forum_post_comments; diisi untuk notif FORUM_COMMENT_NEW.';


-- ─────────────────────────────────────────────────────────────
-- n. FUNCTION + TRIGGER: fn_notify_on_forum_post
--    Dipanggil AFTER INSERT ON forum_posts.
--    Langkah: (1) populate forum_post_audience,
--             (2) kirim FORUM_POST_NEW ke audience kecuali penulis.
--
--    TIDAK menggunakan fn_current_school_id() / fn_current_user_id()
--    karena trigger berjalan sebagai postgres, bukan authenticated user.
--    Semua ID diambil dari NEW.* langsung.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_notify_on_forum_post()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_author_name TEXT;
    v_class_name  TEXT;
BEGIN
    SELECT full_name INTO v_author_name
    FROM   users WHERE user_id = NEW.author_user_id;

    SELECT name INTO v_class_name
    FROM   classes WHERE class_id = NEW.class_id;

    -- ── Langkah 1: Populate forum_post_audience ──────────────
    INSERT INTO forum_post_audience (post_id, user_id, school_id)

    -- Wali Kelas
    SELECT NEW.post_id, u.user_id, NEW.school_id
    FROM   users u
    WHERE  u.wali_kelas_class_id = NEW.class_id
      AND  u.school_id            = NEW.school_id
      AND  u.is_active            = true
      AND  u.deleted_at           IS NULL

    UNION

    -- Guru Wali yang menangani siswa aktif di kelas ini
    SELECT NEW.post_id, gwa.guru_user_id, NEW.school_id
    FROM   guru_wali_assignments gwa
    WHERE  gwa.academic_year = NEW.academic_year
      AND  gwa.is_active     = true
      AND  gwa.school_id     = NEW.school_id
      AND  gwa.student_id IN (
               SELECT ce.student_id
               FROM   class_enrollments ce
               WHERE  ce.class_id      = NEW.class_id
                 AND  ce.academic_year = NEW.academic_year
                 AND  ce.withdrawn_at  IS NULL
                 AND  ce.school_id     = NEW.school_id
           )

    UNION

    -- BK yang ditugaskan ke kelas ini
    SELECT NEW.post_id, bca.bk_user_id, NEW.school_id
    FROM   bk_class_assignments bca
    WHERE  bca.class_id      = NEW.class_id
      AND  bca.academic_year = NEW.academic_year
      AND  bca.is_active     = true
      AND  bca.school_id     = NEW.school_id

    UNION

    -- Ortu siswa aktif (hanya jika PARENT_VISIBLE)
    SELECT NEW.post_id, sp.parent_user_id, NEW.school_id
    FROM   student_parents sp
    JOIN   class_enrollments ce ON ce.student_id = sp.student_id
    WHERE  NEW.visibility    = 'PARENT_VISIBLE'
      AND  ce.class_id       = NEW.class_id
      AND  ce.academic_year  = NEW.academic_year
      AND  ce.withdrawn_at   IS NULL
      AND  ce.school_id      = NEW.school_id
      AND  sp.school_id      = NEW.school_id

    -- Selalu sertakan penulis sendiri ke audience
    UNION
    SELECT NEW.post_id, NEW.author_user_id, NEW.school_id

    ON CONFLICT (post_id, user_id) DO NOTHING;

    -- ── Langkah 2: Kirim FORUM_POST_NEW ke audience minus penulis ──
    INSERT INTO notifications (
        school_id, recipient_user_id,
        forum_post_id,
        type, title, body
    )
    SELECT
        NEW.school_id,
        fpa.user_id,
        NEW.post_id,
        'FORUM_POST_NEW',
        format('Posting baru di forum %s', coalesce(v_class_name, 'kelas')),
        format('%s: %s', coalesce(v_author_name, 'Seseorang'), NEW.title)
    FROM forum_post_audience fpa
    WHERE fpa.post_id   = NEW.post_id
      AND fpa.user_id  != NEW.author_user_id;

    RETURN NEW;
END;
$$;

REVOKE ALL    ON FUNCTION fn_notify_on_forum_post() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fn_notify_on_forum_post() TO service_role;

CREATE TRIGGER trg_notify_forum_post
    AFTER INSERT ON forum_posts
    FOR EACH ROW
    EXECUTE PROCEDURE fn_notify_on_forum_post();


-- ─────────────────────────────────────────────────────────────
-- o. FUNCTION + TRIGGER: fn_notify_on_forum_comment
--    Dipanggil AFTER INSERT ON forum_post_comments.
--    Penerima FORUM_COMMENT_NEW (gabungan 3 kelompok, dedup UNION):
--    1. Penulis posting induk
--    2. Semua yang sudah beri acknowledgement pada posting ini
--    3. Sesama komentator sebelumnya di posting yang sama
--    Minus penulis komentar baru itu sendiri.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_notify_on_forum_comment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_post           forum_posts%ROWTYPE;
    v_commenter_name TEXT;
BEGIN
    SELECT * INTO v_post
    FROM   forum_posts WHERE post_id = NEW.post_id;

    SELECT full_name INTO v_commenter_name
    FROM   users WHERE user_id = NEW.author_user_id;

    INSERT INTO notifications (
        school_id, recipient_user_id,
        forum_post_id, forum_comment_id,
        type, title, body
    )
    SELECT DISTINCT
        NEW.school_id,
        target.user_id,
        NEW.post_id,
        NEW.comment_id,
        'FORUM_COMMENT_NEW',
        format('Komentar baru: %s', v_post.title),
        format('%s mengomentari posting yang Anda ikuti.',
               coalesce(v_commenter_name, 'Seseorang'))
    FROM (
        -- Kelompok 1: penulis posting induk
        SELECT v_post.author_user_id AS user_id

        UNION

        -- Kelompok 2: semua yang sudah beri acknowledgement
        SELECT fpa.user_id
        FROM   forum_post_acknowledgements fpa
        WHERE  fpa.post_id   = NEW.post_id
          AND  fpa.school_id = NEW.school_id

        UNION

        -- Kelompok 3: komentator sebelumnya di posting ini
        SELECT fpc.author_user_id
        FROM   forum_post_comments fpc
        WHERE  fpc.post_id    = NEW.post_id
          AND  fpc.school_id  = NEW.school_id
          AND  fpc.comment_id != NEW.comment_id
    ) AS target
    WHERE target.user_id != NEW.author_user_id;

    RETURN NEW;
END;
$$;

REVOKE ALL    ON FUNCTION fn_notify_on_forum_comment() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fn_notify_on_forum_comment() TO service_role;

CREATE TRIGGER trg_notify_forum_comment
    AFTER INSERT ON forum_post_comments
    FOR EACH ROW
    EXECUTE PROCEDURE fn_notify_on_forum_comment();


-- ─────────────────────────────────────────────────────────────
-- p. DROP parent_messages
--    Urutan wajib:
--    1. DROP kolom FK dari case_events (constraint fk_case_events_parent_message)
--    2. DROP TABLE parent_messages (termasuk self-ref reply_to_message_id_fkey)
-- ─────────────────────────────────────────────────────────────

-- Hapus kolom parent_message_id dari case_events (otomatis drop FK-nya)
ALTER TABLE case_events
    DROP COLUMN IF EXISTS parent_message_id;

-- Hapus tabel parent_messages beserta semua constraint, index, trigger, policy
DROP TABLE IF EXISTS parent_messages;
