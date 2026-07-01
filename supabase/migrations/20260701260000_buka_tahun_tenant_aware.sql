-- ============================================================
-- FIX C1 + C2 — fn_buka_tahun_ajaran sadar-tenant
-- ============================================================
-- C1: INSERT academic_periods (tabel "tanpa induk") gagal NOT NULL
--     school_id di jalur service-role. Perbaikan: resolve school_id
--     dari p_config_id (school_config) lalu stamp eksplisit.
-- C2: guard duplikat periode tak discope school_id → sekolah B
--     diblokir membuka tahun ajaran karena string tahun/semester
--     dipakai sekolah A. Perbaikan: tambah AND school_id = v_school_id.
-- class_enrollments tetap mewarisi school_id dari kelas via trigger.
-- ============================================================

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

        SELECT EXISTS(
            SELECT 1 FROM classes WHERE class_id = v_target_class
        ) INTO v_class_exists;

        IF NOT v_class_exists THEN
            RAISE EXCEPTION 'Kelas "%" (id: %) tidak ditemukan di database',
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
