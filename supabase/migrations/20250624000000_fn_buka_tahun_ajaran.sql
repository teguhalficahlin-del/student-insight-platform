-- ============================================================
-- fn_buka_tahun_ajaran()
--
-- Atomic replacement for the 4 sequential, non-transactional
-- writes performed by onConfirmNewYear() in admin/js/tutup-tahun.js:
--   1. school_config.update(current_academic_year, current_semester)
--   2. academic_periods.insert(...)
--   3. class_enrollments: close old enrollment per promoted student
--   4. class_enrollments: insert new enrollment per promoted student
--
-- All four happen inside one plpgsql function body, so a failure at
-- any step rolls back everything that already happened in this call
-- (plpgsql wraps the whole function in an implicit transaction).
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
