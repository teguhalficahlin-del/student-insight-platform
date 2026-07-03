-- ============================================================
-- Migration 20260703080000
--
-- Fix 1: uq_slot_per_day tidak include school_id
--   Sebelumnya: UNIQUE (academic_year, semester, day_of_week, slot_number)
--   → global constraint, sekolah B diblokir jika sekolah A sudah
--     punya slot untuk kombinasi yang sama.
--   Sesudahnya: UNIQUE (school_id, academic_year, semester, day_of_week, slot_number)
--   → constraint per sekolah, tidak ada tabrakan antar tenant.
--
-- Fix 2: fn_buka_tahun_ajaran tidak update classes.academic_year
--   Sebelumnya: hanya update school_config + insert academic_periods +
--     insert class_enrollments baru.
--   Sesudahnya: juga UPDATE classes.academic_year ke tahun baru,
--     dan COPY schedule_time_slots ke tahun baru.
--   Ini mencerminkan realita: kelas adalah entitas permanen
--   (X TKJ 1 tetap X TKJ 1 setiap tahun), bukan dibuat ulang tiap
--   tahun. Yang berubah hanya siswanya (via class_enrollments).
-- ============================================================

-- ── FIX 1: Perbaiki unique constraint schedule_time_slots ──────

ALTER TABLE schedule_time_slots
    DROP CONSTRAINT IF EXISTS uq_slot_per_day;

ALTER TABLE schedule_time_slots
    ADD CONSTRAINT uq_slot_per_day
    UNIQUE (school_id, academic_year, semester, day_of_week, slot_number);

-- ── FIX 2: fn_buka_tahun_ajaran sadar classes + time_slots ────

CREATE OR REPLACE FUNCTION public.fn_buka_tahun_ajaran(
    p_config_id uuid, p_academic_year text, p_semester integer,
    p_start_date date, p_end_date date, p_old_academic_year text, p_promotion_mapping jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id       UUID;
    v_period_id       UUID;
    v_enrolled_count  INTEGER := 0;
    v_item            JSONB;
    v_target_class    UUID;
    v_student_ids     UUID[];
    v_target_name     TEXT;
    v_class_exists    BOOLEAN;
    v_rows_inserted   INTEGER;
    v_slots_copied    INTEGER := 0;
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

    -- STEP 3b - UPDATE classes.academic_year ke tahun baru
    -- Kelas adalah entitas permanen (X TKJ 1 selalu X TKJ 1).
    -- Yang berubah hanya siswa yang terdaftar (class_enrollments).
    UPDATE classes
    SET academic_year = p_academic_year,
        updated_at    = NOW()
    WHERE school_id    = v_school_id
      AND academic_year = p_old_academic_year;

    -- STEP 4 - INSERT academic_periods (stamp school_id)
    INSERT INTO academic_periods
        (academic_year, semester, start_date, end_date, status, school_id)
    VALUES
        (p_academic_year, p_semester::text::semester, p_start_date, p_end_date, 'ACTIVE', v_school_id)
    RETURNING id INTO v_period_id;

    -- STEP 4b - COPY schedule_time_slots ke tahun baru
    -- Struktur bell schedule (jam pelajaran) biasanya tidak berubah
    -- tiap tahun — copy forward agar admin tidak perlu input ulang.
    INSERT INTO schedule_time_slots
        (academic_year, semester, day_of_week, slot_number,
         start_time, end_time, is_break, break_label, school_id)
    SELECT
        p_academic_year,
        p_semester::text::semester,
        day_of_week,
        slot_number,
        start_time,
        end_time,
        is_break,
        break_label,
        school_id
    FROM schedule_time_slots
    WHERE school_id    = v_school_id
      AND academic_year = p_old_academic_year
      AND semester      = p_semester::text::semester
    ON CONFLICT (school_id, academic_year, semester, day_of_week, slot_number) DO NOTHING;

    GET DIAGNOSTICS v_slots_copied = ROW_COUNT;

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
        'enrolled_count', v_enrolled_count,
        'slots_copied',   v_slots_copied
    );
END;
$function$;
