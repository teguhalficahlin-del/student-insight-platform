-- ============================================================
-- FUNC-03 — Idempotency key untuk fn_create_forum_post
--
-- MASALAH:
--   fn_create_forum_post tidak punya penanda request. Double-click pada
--   tombol Kirim, retry setelah timeout jaringan, atau kirim ulang dari
--   tab kedua menghasilkan BEBERAPA baris forum_posts identik — lengkap
--   dengan duplikasi baris forum_post_audience dan notifications untuk
--   setiap penerima.
--
-- FIX:
--   1. Kolom forum_posts.idempotency_key (uuid, NULL = perilaku lama).
--   2. Unique index parsial (school_id, author_user_id, idempotency_key)
--      WHERE idempotency_key IS NOT NULL. Kunci di-scope per penulis per
--      tenant supaya UUID kembar antar-akun tidak pernah bertabrakan.
--   3. Parameter baru p_idempotency_key uuid DEFAULT NULL. Alur:
--        a. Lookup awal: kunci sudah dipakai -> RETURN post_id lama,
--           tanpa INSERT apa pun, tanpa notifikasi ulang.
--        b. INSERT dibungkus EXCEPTION WHEN unique_violation. Ini yang
--           menutup RACE CONDITION: dua request dengan kunci sama tiba
--           bersamaan, keduanya lolos lookup (a) karena belum ada baris,
--           lalu index unik menolak yang kalah balapan -> handler membaca
--           ulang baris pemenang dan mengembalikan post_id yang sama.
--           Kalau lookup ulang tetap kosong, exception di-RAISE apa adanya
--           (unique_violation dari constraint lain tidak ditelan diam-diam).
--
-- SIGNATURE:
--   Parameter ditambahkan di akhir dengan DEFAULT NULL. Signature lama
--   11-argumen DI-DROP di migration yang sama supaya pemanggil PostgREST
--   dengan named arguments tidak menabrak "function is not unique".
--   Klien lama yang belum mengirim p_idempotency_key tetap cocok ke
--   fungsi baru lewat DEFAULT — backward compatible.
--   Pola drop-lalu-create ini sama dengan migration 20260717094505 dan
--   20260729030000.
--
-- CAKUPAN:
--   Logika PATH A (SEKOLAH) dan PATH B (KELAS) diambil verbatim dari
--   migration 20260827020000 (HEAD). Satu-satunya perubahan: deklarasi
--   v_existing_id, blok lookup di awal, kolom idempotency_key pada kedua
--   INSERT forum_posts, dan pembungkus EXCEPTION di kedua INSERT itu.
--
-- IDEMPOTEN:
--   ADD COLUMN IF NOT EXISTS + CREATE UNIQUE INDEX IF NOT EXISTS +
--   DROP FUNCTION IF EXISTS + CREATE OR REPLACE FUNCTION.
--
-- PRIVILEGE (CLAUDE.md 6c):
--   SECURITY DEFINER — GRANT + dua REVOKE untuk signature BARU di akhir.
-- ============================================================

BEGIN;

-- 1. Kolom penanda request -----------------------------------
ALTER TABLE public.forum_posts
  ADD COLUMN IF NOT EXISTS idempotency_key uuid;

COMMENT ON COLUMN public.forum_posts.idempotency_key IS
  'FUNC-03: UUID yang di-generate klien per draft posting. NULL = request lama tanpa penanda.';

-- 2. Unique index parsial ------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_forum_posts_idempotency
  ON public.forum_posts (school_id, author_user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 3. Ganti fungsi: drop signature lama, buat signature 12-argumen
DROP FUNCTION IF EXISTS public.fn_create_forum_post(
    uuid, text, text, text, uuid[], text, uuid[], text, uuid[], text, text);

CREATE OR REPLACE FUNCTION public.fn_create_forum_post(p_class_id uuid, p_academic_year text, p_content text, p_category_code text DEFAULT NULL::text, p_subject_student_ids uuid[] DEFAULT '{}'::uuid[], p_audience_type text DEFAULT 'STAF_SAJA'::text, p_specific_user_ids uuid[] DEFAULT '{}'::uuid[], p_audience_type_2 text DEFAULT NULL::text, p_specific_user_ids_2 uuid[] DEFAULT '{}'::uuid[], p_scope_type text DEFAULT 'KELAS'::text, p_title text DEFAULT NULL::text, p_idempotency_key uuid DEFAULT NULL::uuid)
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
    v_existing_id    UUID;
BEGIN
    -- ── FUNC-03: short-circuit idempotency ────────────────────
    -- Request ulang dengan kunci yang sama mengembalikan posting yang
    -- sudah ada; tidak ada INSERT, tidak ada notifikasi kedua.
    IF p_idempotency_key IS NOT NULL THEN
        SELECT fp.post_id INTO v_existing_id
        FROM   forum_posts fp
        WHERE  fp.school_id       = v_school_id
          AND  fp.author_user_id  = v_caller_id
          AND  fp.idempotency_key = p_idempotency_key;
        IF v_existing_id IS NOT NULL THEN
            RETURN v_existing_id;
        END IF;
    END IF;

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
        -- FUNC-03: pembungkus unique_violation menutup race condition dua
        -- request bersamaan dengan idempotency_key yang sama.
        BEGIN
            INSERT INTO forum_posts (
                post_id, school_id, class_id, category_id, author_user_id,
                academic_year, title, body, visibility,
                audience_type, audience_type_2, scope_type, idempotency_key
            ) VALUES (
                v_post_id, v_school_id, NULL, v_category_id, v_caller_id,
                p_academic_year, v_title, p_content, v_visibility,
                p_audience_type, p_audience_type_2, 'SEKOLAH', p_idempotency_key
            );
        EXCEPTION WHEN unique_violation THEN
            SELECT fp.post_id INTO v_existing_id
            FROM   forum_posts fp
            WHERE  fp.school_id       = v_school_id
              AND  fp.author_user_id  = v_caller_id
              AND  fp.idempotency_key = p_idempotency_key;
            IF v_existing_id IS NOT NULL THEN
                RETURN v_existing_id;
            END IF;
            RAISE;
        END;

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
    -- FUNC-03: pembungkus unique_violation, sama seperti PATH A.
    BEGIN
        INSERT INTO forum_posts (
            post_id, school_id, class_id, category_id, author_user_id,
            academic_year, title, body, visibility,
            audience_type, audience_type_2, scope_type, idempotency_key
        ) VALUES (
            v_post_id, v_school_id, p_class_id, v_category_id, v_caller_id,
            p_academic_year, v_title, p_content, v_visibility,
            p_audience_type, p_audience_type_2, 'KELAS', p_idempotency_key
        );
    EXCEPTION WHEN unique_violation THEN
        SELECT fp.post_id INTO v_existing_id
        FROM   forum_posts fp
        WHERE  fp.school_id       = v_school_id
          AND  fp.author_user_id  = v_caller_id
          AND  fp.idempotency_key = p_idempotency_key;
        IF v_existing_id IS NOT NULL THEN
            RETURN v_existing_id;
        END IF;
        RAISE;
    END;

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

GRANT  EXECUTE ON FUNCTION public.fn_create_forum_post(uuid, text, text, text, uuid[], text, uuid[], text, uuid[], text, text, uuid) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_create_forum_post(uuid, text, text, text, uuid[], text, uuid[], text, uuid[], text, text, uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.fn_create_forum_post(uuid, text, text, text, uuid[], text, uuid[], text, uuid[], text, text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_create_forum_post(uuid, text, text, text, uuid[], text, uuid[], text, uuid[], text, text, uuid) FROM PUBLIC;

COMMIT;
