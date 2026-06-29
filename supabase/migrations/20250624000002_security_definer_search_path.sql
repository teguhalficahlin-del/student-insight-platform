-- ============================================================
-- Add SET search_path = public to all SECURITY DEFINER functions.
-- Prevents search path injection attacks.
-- Affects: 6 RLS helper functions + fn_buka_tahun_ajaran.
-- ============================================================

-- 6 RLS helper functions (originally defined in
-- contracts/06_rls_policies.sql, patched here to avoid
-- modifying the contracts reference file):

CREATE OR REPLACE FUNCTION fn_current_user_role()
RETURNS role_type
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT role_type FROM users WHERE auth_user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION fn_current_user_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT user_id FROM users WHERE auth_user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION fn_has_assignment_for_class(p_class_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM teaching_assignments
        WHERE user_id    = fn_current_user_id()
          AND class_id   = p_class_id
          AND is_active  = TRUE
    );
$$;

CREATE OR REPLACE FUNCTION fn_dudi_supervises_student(p_student_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM pkl_placements
        WHERE student_id   = p_student_id
          AND dudi_user_id = fn_current_user_id()
          AND is_active    = TRUE
    );
$$;

CREATE OR REPLACE FUNCTION fn_wali_kelas_class_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT wali_kelas_class_id FROM users WHERE auth_user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION fn_involved_in_case(p_case_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM cases
        WHERE case_id          = p_case_id
          AND created_by_user_id = fn_current_user_id()
    )
    OR EXISTS (
        SELECT 1 FROM case_events
        WHERE case_id        = p_case_id
          AND author_user_id = fn_current_user_id()
    );
$$;


-- ============================================================
-- fn_buka_tahun_ajaran: add SET search_path + REVOKE EXECUTE
-- (originally defined in
-- supabase/migrations/20250624000000_fn_buka_tahun_ajaran.sql,
-- patched here with CREATE OR REPLACE to add the missing
-- search_path guard, without changing any logic).
-- ============================================================

CREATE OR REPLACE FUNCTION fn_buka_tahun_ajaran(
    p_config_id         UUID,
    p_academic_year     TEXT,
    p_semester          INTEGER,
    p_start_date        DATE,
    p_end_date          DATE,
    p_old_academic_year TEXT,
    p_promotion_mapping JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_period_id      UUID;
    v_enrolled_count INTEGER := 0;
    v_item           JSONB;
    v_target_class   UUID;
    v_student_ids    UUID[];
    v_target_name    TEXT;
    v_class_exists   BOOLEAN;
    v_rows_inserted  INTEGER;
BEGIN
    -- ── STEP 1 — GUARD school_config ───────────────────────────
    IF NOT EXISTS (SELECT 1 FROM school_config WHERE config_id = p_config_id) THEN
        RAISE EXCEPTION 'school_config dengan id % tidak ditemukan', p_config_id;
    END IF;

    -- ── STEP 2 — GUARD duplicate academic_period ───────────────
    IF EXISTS (
        SELECT 1 FROM academic_periods
        WHERE academic_year = p_academic_year
          AND semester = p_semester::text::semester
    ) THEN
        RAISE EXCEPTION 'Periode % Semester % sudah ada di database',
            p_academic_year, p_semester;
    END IF;

    -- ── STEP 3 — UPDATE school_config ──────────────────────────
    UPDATE school_config
    SET current_academic_year = p_academic_year,
        current_semester      = p_semester::text::semester,
        updated_at            = NOW()
    WHERE config_id = p_config_id;

    -- ── STEP 4 — INSERT academic_periods ───────────────────────
    INSERT INTO academic_periods
        (academic_year, semester, start_date, end_date, status)
    VALUES
        (p_academic_year, p_semester::text::semester, p_start_date, p_end_date, 'ACTIVE')
    RETURNING id INTO v_period_id;

    -- ── STEP 5 — LOOP promotion mapping ────────────────────────
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_promotion_mapping)
    LOOP
        -- 5a. Extract fields
        v_target_class := (v_item->>'targetClassId')::UUID;
        v_target_name  := v_item->>'targetName';
        v_student_ids  := ARRAY(
            SELECT (el::text)::UUID
            FROM jsonb_array_elements_text(v_item->'studentIds') el
        );

        -- 5b. GUARD class exists
        SELECT EXISTS(
            SELECT 1 FROM classes WHERE class_id = v_target_class
        ) INTO v_class_exists;

        IF NOT v_class_exists THEN
            RAISE EXCEPTION 'Kelas "%" (id: %) tidak ditemukan di database',
                v_target_name, v_target_class;
        END IF;

        -- 5c. Skip jika tidak ada siswa di mapping ini
        IF v_student_ids IS NULL OR array_length(v_student_ids, 1) IS NULL THEN
            CONTINUE;
        END IF;

        -- 5d. CLOSE enrollment lama
        UPDATE class_enrollments
        SET withdrawn_at = NOW(),
            updated_at   = NOW()
        WHERE student_id = ANY(v_student_ids)
          AND academic_year = p_old_academic_year
          AND withdrawn_at IS NULL;

        -- 5e. INSERT enrollment baru (idempoten)
        INSERT INTO class_enrollments
            (student_id, class_id, academic_year, semester)
        SELECT
            unnest(v_student_ids),
            v_target_class,
            p_academic_year,
            p_semester::text::semester
        ON CONFLICT (student_id, academic_year, semester) DO NOTHING;

        -- 5f. Hitung hanya baris yang benar-benar ter-INSERT
        GET DIAGNOSTICS v_rows_inserted = ROW_COUNT;
        v_enrolled_count := v_enrolled_count + v_rows_inserted;
    END LOOP;

    -- ── STEP 6 — RETURN ─────────────────────────────────────────
    RETURN jsonb_build_object(
        'success',        true,
        'period_id',      v_period_id,
        'enrolled_count', v_enrolled_count
    );

EXCEPTION WHEN OTHERS THEN
    RAISE;
END;
$$;

COMMENT ON FUNCTION fn_buka_tahun_ajaran IS
    'Atomic transaction for opening a new academic year: updates school_config, '
    'inserts academic_periods, closes old class_enrollments, and inserts new '
    'class_enrollments for promoted students. Replaces the 4-step sequential '
    'writes previously done client-side in onConfirmNewYear().';

REVOKE EXECUTE ON FUNCTION fn_buka_tahun_ajaran FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_buka_tahun_ajaran FROM anon;
REVOKE EXECUTE ON FUNCTION fn_buka_tahun_ajaran FROM authenticated;
