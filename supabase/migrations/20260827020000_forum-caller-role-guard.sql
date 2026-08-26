-- ============================================================
-- RLS-01 — Caller-role guard di fn_create_forum_post PATH A
--
-- MASALAH:
--   PATH A (p_scope_type = 'SEKOLAH') tidak punya pemeriksaan peran
--   caller sama sekali. Yang divalidasi hanya daftar PENERIMA; penulis
--   tidak pernah dicek. Bandingkan PATH B yang menolak non-anggota
--   forum kelas lewat fn_get_forum_members. Karena fungsi ini
--   SECURITY DEFINER, setiap user authenticated di sekolah tersebut
--   — termasuk SISWA, DUDI, STAKEHOLDER — bisa membuat posting
--   scope SEKOLAH dan mengirim notifikasi ke seluruh staf.
--
-- FIX:
--   Tambahkan satu blok guard tepat setelah resolve v_caller_role di
--   awal PATH A. Allowlist memuat 10 peran staf + ORTU (fitur
--   "Kabar Ortu", migration 20260826000000). SISWA, DUDI, dan
--   STAKEHOLDER ditolak dengan ERRCODE P0001.
--
-- CATATAN IMPLEMENTASI:
--   1. v_caller_role dideklarasikan TEXT (bukan role_type), jadi
--      perbandingan memakai literal text polos. Memakai
--      'GURU'::role_type akan gagal: operator does not exist:
--      text = role_type.
--   2. Cek IS NULL wajib — NULL NOT IN (...) bernilai NULL sehingga
--      cabang IF tidak diambil dan guard terlewat diam-diam.
--
-- CAKUPAN:
--   PATH B (scope KELAS) TIDAK diubah sedikit pun. Body fungsi
--   diambil verbatim dari pg_get_functiondef pada HEAD sebelum
--   migration ini; satu-satunya perbedaan adalah blok guard di atas.
--
-- KLIEN:
--   Nol perubahan. Pemanggil RPC ini hanya guru/js/api.js:1360,
--   parent/js/api.js:498, dan tu/js/api.js:292 — tidak ada portal
--   siswa/dudi/stakeholder yang memanggilnya.
--
-- PRIVILEGE (CLAUDE.md §6c):
--   Fungsi ini SECURITY DEFINER, jadi GRANT + dua REVOKE ditegaskan
--   ulang di akhir migration agar ACL tetap
--   {authenticated=X, service_role=X} dan anon tetap tertutup.
-- ============================================================

BEGIN;
CREATE OR REPLACE FUNCTION public.fn_create_forum_post(p_class_id uuid, p_academic_year text, p_content text, p_category_code text DEFAULT NULL::text, p_subject_student_ids uuid[] DEFAULT '{}'::uuid[], p_audience_type text DEFAULT 'STAF_SAJA'::text, p_specific_user_ids uuid[] DEFAULT '{}'::uuid[], p_audience_type_2 text DEFAULT NULL::text, p_specific_user_ids_2 uuid[] DEFAULT '{}'::uuid[], p_scope_type text DEFAULT 'KELAS'::text, p_title text DEFAULT NULL::text)
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
    v_caller_role    TEXT;
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

        -- Ambil role caller untuk menentukan label notifikasi
        SELECT role_type INTO v_caller_role FROM users WHERE user_id = v_caller_id;

        -- ── RLS-01: guard peran penulis untuk PATH A (scope SEKOLAH) ──
        -- Sebelum fix ini PATH A sama sekali tidak memeriksa peran caller:
        -- v_caller_role hanya dipakai untuk memilih label notifikasi.
        -- Karena fungsi ini SECURITY DEFINER, siapa pun yang punya EXECUTE
        -- (termasuk SISWA, DUDI, STAKEHOLDER) bisa membuat pengumuman
        -- se-sekolah dan mem-blast notifikasi ke staf.
        -- ORTU sengaja DIIZINKAN agar fitur "Kabar Ortu"
        -- (migration 20260826000000) tetap berfungsi.
        -- Catatan: v_caller_role bertipe TEXT (lihat DECLARE), jadi
        -- perbandingan memakai literal text polos, bukan ::role_type.
        -- Cek IS NULL wajib: NULL NOT IN (...) menghasilkan NULL sehingga
        -- cabang IF tidak diambil dan guard akan terlewat.
        IF v_caller_role IS NULL OR v_caller_role NOT IN (
            'GURU', 'BK', 'WALI_KELAS', 'KAPRODI',
            'WAKA_KESISWAAN', 'WAKA_KURIKULUM', 'WAKA_HUMAS',
            'KEPSEK', 'TU', 'ADMINISTRATIVE', 'ORTU'
        ) THEN
            RAISE EXCEPTION
                'Akses ditolak: peran "%" tidak diizinkan membuat posting forum sekolah.',
                coalesce(v_caller_role, '(tidak dikenal)')
                USING ERRCODE = 'P0001';
        END IF;

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

        -- Saring penerima: harus anggota sekolah yang sama dan aktif.
        -- Cross-tenant isolation dijaga oleh AND u.school_id = v_school_id.
        v_audience_ids :=
            ARRAY(
                SELECT DISTINCT uid
                FROM unnest(
                    COALESCE(p_specific_user_ids,   ARRAY[]::UUID[]) ||
                    COALESCE(p_specific_user_ids_2, ARRAY[]::UUID[])
                ) AS uid
                WHERE EXISTS (
                    SELECT 1 FROM users u
                    WHERE u.user_id    = uid
                      AND u.school_id  = v_school_id
                      AND u.is_active  = true
                      AND u.deleted_at IS NULL
                      AND u.role_type IN (
                          'GURU', 'BK', 'WALI_KELAS', 'KAPRODI',
                          'WAKA_KESISWAAN', 'WAKA_KURIKULUM', 'WAKA_HUMAS',
                          'KEPSEK', 'TU', 'ADMINISTRATIVE',
                          'SISWA', 'ORTU'
                      )
                )
            ) || ARRAY[v_caller_id];

        -- Tolak jika tidak ada penerima valid selain caller sendiri
        IF array_length(v_audience_ids, 1) <= 1 THEN
            RAISE EXCEPTION 'Tidak ada penerima valid yang ditemukan di sekolah ini.';
        END IF;

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
            format(
                CASE WHEN v_caller_role = 'ORTU' THEN 'Kabar Ortu: %s' ELSE 'Pengumuman: %s' END,
                v_title
            ),
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
$function$
;

GRANT  EXECUTE ON FUNCTION public.fn_create_forum_post(uuid, text, text, text, uuid[], text, uuid[], text, uuid[], text, text) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_create_forum_post(uuid, text, text, text, uuid[], text, uuid[], text, uuid[], text, text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.fn_create_forum_post(uuid, text, text, text, uuid[], text, uuid[], text, uuid[], text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_create_forum_post(uuid, text, text, text, uuid[], text, uuid[], text, uuid[], text, text) FROM PUBLIC;

COMMIT;
