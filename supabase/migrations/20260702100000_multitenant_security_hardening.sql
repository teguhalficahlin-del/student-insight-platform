-- ============================================================
-- Migration: 20260702100000_multitenant_security_hardening.sql
-- AUDIT MULTI-TENANT — Pengerasan keamanan isolasi antar-sekolah
--
-- Temuan audit 2 Juli 2026 — 9 perbaikan:
--
--  [K2] login_identifier UNIQUE global → UNIQUE (school_id, login_identifier)
--  [K2] teacher_code UNIQUE global    → UNIQUE (school_id, teacher_code)
--  [K3] fn_check_identifiers_exist — tambah p_school_id parameter
--  [K4] fn_check_niks_exist        — tambah p_school_id parameter
--  [K1] fn_resolve_login_email     — tambah p_school_id opsional (DEFAULT NULL)
--  [K5] fn_stakeholder_summary     — filter school_id saat ini
--  [T4] fn_buka_tahun_ajaran       — cek target class harus milik sekolah yg sama
--  [S1] rls_users_update_own       — tambah WITH CHECK agar school_id tidak bisa diubah
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- [K2a] login_identifier: global UNIQUE → per-school UNIQUE
-- ────────────────────────────────────────────────────────────
-- SEBELUM: login_identifier VARCHAR(100) NOT NULL UNIQUE
--   → Sekolah B tidak bisa pakai NIP yang sudah dipakai Sekolah A
-- SESUDAH: UNIQUE (school_id, login_identifier)
--   → Setiap sekolah bebas memakai NIP/NIK yang sama secara mandiri
ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_login_identifier_key,
    ADD  CONSTRAINT uq_users_school_login_identifier
         UNIQUE (school_id, login_identifier);

-- ────────────────────────────────────────────────────────────
-- [K2b] teacher_code: global UNIQUE → per-school UNIQUE
-- ────────────────────────────────────────────────────────────
-- SEBELUM: teacher_code VARCHAR(20) NULL UNIQUE
-- SESUDAH: UNIQUE (school_id, teacher_code) (NULL tetap boleh)
ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_teacher_code_key,
    ADD  CONSTRAINT uq_users_school_teacher_code
         UNIQUE (school_id, teacher_code);

-- ────────────────────────────────────────────────────────────
-- [K3] fn_check_identifiers_exist — tambah p_school_id
-- ────────────────────────────────────────────────────────────
-- SEBELUM: filter login_identifier ANY(p_identifiers) tanpa school_id
--   → ADMINISTRATIVE Sekolah B mendapat false-duplicate dari Sekolah A
--   → UPDATE rows tanpa school_id bisa overwrite user sekolah lain
-- SESUDAH: filter ditambah AND school_id = p_school_id
DROP FUNCTION IF EXISTS fn_check_identifiers_exist(TEXT[]);
CREATE OR REPLACE FUNCTION fn_check_identifiers_exist(
    p_identifiers TEXT[],
    p_school_id   UUID
)
RETURNS TEXT[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT ARRAY(
        SELECT login_identifier
        FROM users
        WHERE login_identifier = ANY(p_identifiers)
          AND school_id = p_school_id
    );
$$;

REVOKE EXECUTE ON FUNCTION fn_check_identifiers_exist(TEXT[], UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_check_identifiers_exist(TEXT[], UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION fn_check_identifiers_exist(TEXT[], UUID) FROM authenticated;

COMMENT ON FUNCTION fn_check_identifiers_exist IS
    'Called by bulk-import-users. Batch-check NIP/NIS/NIK duplicates '
    'WITHIN the given school only (p_school_id required).';

-- ────────────────────────────────────────────────────────────
-- [K4] fn_check_niks_exist — tambah p_school_id
-- ────────────────────────────────────────────────────────────
-- SEBELUM: filter login_identifier ANY(p_niks) tanpa school_id
--   → NIK orang tua Sekolah A dianggap "sudah ada" di Sekolah B
--   → UPDATE full_name bisa menarget ORTU dari sekolah lain
-- SESUDAH: filter ditambah AND school_id = p_school_id
DROP FUNCTION IF EXISTS fn_check_niks_exist(TEXT[]);
CREATE OR REPLACE FUNCTION fn_check_niks_exist(
    p_niks      TEXT[],
    p_school_id UUID
)
RETURNS TEXT[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT ARRAY(
        SELECT login_identifier
        FROM users
        WHERE login_identifier = ANY(p_niks)
          AND school_id = p_school_id
    );
$$;

REVOKE EXECUTE ON FUNCTION fn_check_niks_exist(TEXT[], UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_check_niks_exist(TEXT[], UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION fn_check_niks_exist(TEXT[], UUID) FROM authenticated;

COMMENT ON FUNCTION fn_check_niks_exist IS
    'Called by bulk-import-parents. Batch-check NIK duplicates '
    'WITHIN the given school only (p_school_id required).';

-- ────────────────────────────────────────────────────────────
-- [K1] fn_resolve_login_email — tambah p_school_id opsional
-- ────────────────────────────────────────────────────────────
-- SEBELUM: lookup login_identifier tanpa school_id
--   → Setelah K2 difix (NIP bisa sama antar sekolah), fungsi ini
--     bisa mengembalikan email sekolah lain (KRITIS post-K2 fix)
-- SESUDAH: jika p_school_id diisi, scope ke sekolah tersebut.
--   NULL memberi fallback global (backward-compatible single-school).
--   Portal multi-sekolah harus selalu mengisi p_school_id.
DROP FUNCTION IF EXISTS fn_resolve_login_email(TEXT);
CREATE OR REPLACE FUNCTION fn_resolve_login_email(
    p_identifier TEXT,
    p_school_id  UUID DEFAULT NULL
)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT email FROM users
    WHERE login_identifier = p_identifier
      AND is_active = TRUE
      AND (p_school_id IS NULL OR school_id = p_school_id)
    LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION fn_resolve_login_email(TEXT, UUID) TO anon;
GRANT EXECUTE ON FUNCTION fn_resolve_login_email(TEXT, UUID) TO authenticated;

COMMENT ON FUNCTION fn_resolve_login_email IS
    'Pre-auth lookup: login_identifier -> email. '
    'Jika p_school_id diisi: hanya cari dalam sekolah tersebut (wajib untuk '
    'platform multi-sekolah). NULL = fallback global (single-school compat).';

-- ────────────────────────────────────────────────────────────
-- [K5] fn_stakeholder_summary — filter school_id user saat ini
-- ────────────────────────────────────────────────────────────
-- SEBELUM: COUNT(*) dari seluruh platform tanpa filter school_id
--   → Stakeholder melihat angka gabungan semua sekolah
-- SESUDAH: semua subquery difilter school_id = fn_current_school_id()
CREATE OR REPLACE FUNCTION fn_stakeholder_summary()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'total_siswa',
            (SELECT count(*) FROM students
             WHERE student_status = 'AKTIF'
               AND school_id = fn_current_school_id()),
        'total_pkl',
            (SELECT count(*) FROM students
             WHERE student_status = 'PKL'
               AND school_id = fn_current_school_id()),
        'total_staf',
            (SELECT count(*) FROM users
             WHERE role_type NOT IN ('SISWA','ORTU','DUDI','ADMINISTRATIVE','STAKEHOLDER')
               AND school_id = fn_current_school_id()),
        'total_program',
            (SELECT count(*) FROM programs
             WHERE school_id = fn_current_school_id()),
        'total_kelas',
            (SELECT count(*) FROM classes
             WHERE school_id = fn_current_school_id()),
        'sesi_hari_ini',
            (SELECT count(*) FROM teaching_schedules
             WHERE session_date = CURRENT_DATE
               AND school_id = fn_current_school_id()),
        'hadir_hari_ini',
            (SELECT count(*) FROM attendance
             WHERE is_void = FALSE AND status = 'HADIR'
               AND created_at >= CURRENT_DATE
               AND school_id = fn_current_school_id()),
        'kehadiran_bulan_pct',
            (SELECT CASE WHEN count(*) = 0 THEN NULL
                    ELSE round(100.0 * count(*) FILTER (WHERE status = 'HADIR') / count(*), 1)
                    END
             FROM attendance
             WHERE is_void = FALSE
               AND created_at >= date_trunc('month', CURRENT_DATE)
               AND school_id = fn_current_school_id()),
        'updated_at', now()
    );
$$;

REVOKE EXECUTE ON FUNCTION fn_stakeholder_summary FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION fn_stakeholder_summary TO authenticated;

COMMENT ON FUNCTION fn_stakeholder_summary IS
    'Ringkasan agregat sekolah (non-PII) untuk Portal Stakeholder. '
    'SECURITY DEFINER agar STAKEHOLDER (tanpa RLS read) tetap bisa '
    'melihat angka ringkasan — namun HANYA untuk sekolahnya sendiri.';

-- ────────────────────────────────────────────────────────────
-- [T4] fn_buka_tahun_ajaran — verifikasi target class milik sekolah yg sama
-- ────────────────────────────────────────────────────────────
-- SEBELUM: SELECT EXISTS(SELECT 1 FROM classes WHERE class_id = v_target_class)
--   → ADMINISTRATIVE bisa mempromosikan siswa ke kelas sekolah lain
-- SESUDAH: tambah AND school_id = v_school_id
CREATE OR REPLACE FUNCTION public.fn_buka_tahun_ajaran(
    p_config_id uuid, p_academic_year text, p_semester integer,
    p_start_date date, p_end_date date, p_old_academic_year text, p_promotion_mapping jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id      UUID;
    v_period_id      UUID;
    v_enrolled_count INTEGER := 0;
    v_item           JSONB;
    v_target_class   UUID;
    v_student_ids    UUID[];
    v_target_name    TEXT;
    v_class_exists   BOOLEAN;
    v_rows_inserted  INTEGER;
BEGIN
    -- STEP 1 - GUARD school_config + resolve school_id
    SELECT school_id INTO v_school_id FROM school_config WHERE config_id = p_config_id;
    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'school_config dengan id % tidak ditemukan', p_config_id;
    END IF;

    -- STEP 2 - GUARD duplicate academic_period (scoped per sekolah)
    IF EXISTS (
        SELECT 1 FROM academic_periods
        WHERE academic_year = p_academic_year
          AND semester = p_semester::text::semester
          AND school_id = v_school_id
    ) THEN
        RAISE EXCEPTION 'Periode % Semester % sudah ada di database',
            p_academic_year, p_semester;
    END IF;

    -- STEP 3 - UPDATE school_config
    UPDATE school_config
    SET current_academic_year = p_academic_year,
        current_semester      = p_semester::text::semester,
        updated_at            = NOW()
    WHERE config_id = p_config_id;

    -- STEP 4 - INSERT academic_periods (stamp school_id)
    INSERT INTO academic_periods
        (academic_year, semester, start_date, end_date, status, school_id)
    VALUES
        (p_academic_year, p_semester::text::semester, p_start_date, p_end_date, 'ACTIVE', v_school_id)
    RETURNING id INTO v_period_id;

    -- STEP 5 - LOOP promotion mapping
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_promotion_mapping)
    LOOP
        v_target_class := (v_item->>'targetClassId')::UUID;
        v_target_name  := v_item->>'targetName';
        v_student_ids  := ARRAY(
            SELECT (el::text)::UUID
            FROM jsonb_array_elements_text(v_item->'studentIds') el
        );

        -- Verifikasi kelas HARUS milik sekolah yang sama (fix T4)
        SELECT EXISTS(
            SELECT 1 FROM classes
            WHERE class_id = v_target_class
              AND school_id = v_school_id
        ) INTO v_class_exists;

        IF NOT v_class_exists THEN
            RAISE EXCEPTION 'Kelas "%" (id: %) tidak ditemukan di sekolah ini',
                v_target_name, v_target_class;
        END IF;

        IF v_student_ids IS NULL OR array_length(v_student_ids, 1) IS NULL THEN
            CONTINUE;
        END IF;

        UPDATE class_enrollments
        SET withdrawn_at = NOW(),
            updated_at   = NOW()
        WHERE student_id = ANY(v_student_ids)
          AND academic_year = p_old_academic_year
          AND withdrawn_at IS NULL;

        INSERT INTO class_enrollments
            (student_id, class_id, academic_year, semester)
        SELECT
            unnest(v_student_ids),
            v_target_class,
            p_academic_year,
            p_semester::text::semester
        ON CONFLICT (student_id, academic_year, semester) DO NOTHING;

        GET DIAGNOSTICS v_rows_inserted = ROW_COUNT;
        v_enrolled_count := v_enrolled_count + v_rows_inserted;
    END LOOP;

    RETURN jsonb_build_object(
        'success',        true,
        'period_id',      v_period_id,
        'enrolled_count', v_enrolled_count
    );
END;
$function$;

-- ────────────────────────────────────────────────────────────
-- [S1] rls_users_update_own — tambah WITH CHECK agar school_id tidak bisa diubah
-- ────────────────────────────────────────────────────────────
-- SEBELUM: USING (auth_user_id = auth.uid()) tanpa WITH CHECK
--   → User bisa UPDATE kolom school_id miliknya sendiri via REST API
-- SESUDAH: WITH CHECK memastikan school_id tetap konsisten
DROP POLICY IF EXISTS rls_users_update_own ON users;
CREATE POLICY rls_users_update_own ON users FOR UPDATE
    USING     (auth_user_id = auth.uid())
    WITH CHECK (auth_user_id = auth.uid()
                AND school_id = fn_current_school_id());
