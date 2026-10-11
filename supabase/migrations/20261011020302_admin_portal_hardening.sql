-- Admin portal hardening:
-- * restrict semester closing to ADMINISTRATIVE users;
-- * restore tenant and ownership checks for opening an academic year;
-- * make program/class renames transactional;
-- * validate schedule foreign keys and save a complete day atomically.

CREATE OR REPLACE FUNCTION public.fn_close_semester(
    p_period_id UUID,
    p_config_id UUID,
    p_semester TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
    IF fn_current_user_role() <> 'ADMINISTRATIVE' THEN
        RAISE EXCEPTION 'akses ditolak: hanya ADMINISTRATIVE yang dapat menutup semester'
            USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM academic_periods
        WHERE id = p_period_id
          AND school_id = fn_current_school_id()
    ) THEN
        RAISE EXCEPTION 'domain_invariant_violation: period tidak ditemukan di sekolah ini';
    END IF;

    UPDATE academic_periods
    SET status            = 'CLOSED',
        closed_at         = now(),
        closed_by_user_id = auth.uid()
    WHERE id = p_period_id
      AND school_id = fn_current_school_id();

    IF p_semester = '1' THEN
        UPDATE school_config
        SET current_semester = '2'
        WHERE config_id = p_config_id
          AND school_id = fn_current_school_id();
    END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_close_semester(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_close_semester(UUID, UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_close_semester(UUID, UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_buka_tahun_ajaran(
    p_config_id uuid, p_academic_year text, p_semester integer,
    p_start_date date, p_end_date date, p_old_academic_year text,
    p_promotion_mapping jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id       UUID;
    v_current_year    TEXT;
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
    SELECT school_id, current_academic_year
      INTO v_school_id, v_current_year
    FROM school_config
    WHERE config_id = p_config_id;

    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'school_config dengan id % tidak ditemukan', p_config_id;
    END IF;

    -- Direct authenticated calls must stay inside the caller's tenant.
    -- The Edge Function also validates this before using service_role.
    IF auth.uid() IS NOT NULL AND (
        v_school_id IS DISTINCT FROM fn_current_school_id()
        OR fn_current_user_role() <> 'ADMINISTRATIVE'
    ) THEN
        RAISE EXCEPTION 'akses ditolak: hanya admin sekolah terkait'
            USING ERRCODE = '42501';
    END IF;

    IF p_old_academic_year IS DISTINCT FROM v_current_year THEN
        RAISE EXCEPTION 'tahun ajaran lama tidak sesuai konfigurasi sekolah';
    END IF;

    IF EXISTS (
        SELECT 1 FROM academic_periods
        WHERE academic_year = p_academic_year
          AND semester = p_semester::text::semester
          AND school_id = v_school_id
    ) THEN
        RAISE EXCEPTION 'Periode % Semester % sudah ada di database',
            p_academic_year, p_semester;
    END IF;

    UPDATE school_config
    SET current_academic_year = p_academic_year,
        current_semester      = p_semester::text::semester,
        updated_at            = NOW()
    WHERE config_id = p_config_id
      AND school_id = v_school_id;

    UPDATE classes
    SET academic_year = p_academic_year,
        updated_at    = NOW()
    WHERE school_id = v_school_id
      AND academic_year = p_old_academic_year;

    INSERT INTO academic_periods
        (academic_year, semester, start_date, end_date, status, school_id)
    VALUES
        (p_academic_year, p_semester::text::semester, p_start_date, p_end_date, 'ACTIVE', v_school_id)
    RETURNING id INTO v_period_id;

    INSERT INTO schedule_time_slots
        (academic_year, semester, day_of_week, slot_number,
         start_time, end_time, is_break, break_label, school_id)
    SELECT
        p_academic_year, p_semester::text::semester, day_of_week, slot_number,
        start_time, end_time, is_break, break_label, school_id
    FROM schedule_time_slots
    WHERE school_id = v_school_id
      AND academic_year = p_old_academic_year
      AND semester = p_semester::text::semester
    ON CONFLICT (school_id, academic_year, semester, day_of_week, slot_number) DO NOTHING;

    GET DIAGNOSTICS v_slots_copied = ROW_COUNT;

    FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_promotion_mapping, '[]'::jsonb))
    LOOP
        v_target_class := (v_item->>'targetClassId')::UUID;
        v_target_name  := v_item->>'targetName';
        v_student_ids  := ARRAY(
            SELECT (el::text)::UUID
            FROM jsonb_array_elements_text(COALESCE(v_item->'studentIds', '[]'::jsonb)) el
        );

        SELECT EXISTS(
            SELECT 1 FROM classes
            WHERE class_id = v_target_class
              AND school_id = v_school_id
        ) INTO v_class_exists;

        IF NOT v_class_exists THEN
            RAISE EXCEPTION 'Kelas "%" (id: %) tidak ditemukan di sekolah ini',
                v_target_name, v_target_class;
        END IF;

        IF EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(COALESCE(v_item->'studentIds', '[]'::jsonb)) el
            LEFT JOIN students s ON s.student_id = (el::text)::UUID
            WHERE s.student_id IS NULL OR s.school_id IS DISTINCT FROM v_school_id
        ) THEN
            RAISE EXCEPTION 'Mapping berisi siswa dari sekolah lain atau siswa yang tidak ditemukan'
                USING ERRCODE = '42501';
        END IF;

        IF v_student_ids IS NULL OR array_length(v_student_ids, 1) IS NULL THEN
            CONTINUE;
        END IF;

        UPDATE class_enrollments
        SET withdrawn_at = NOW(), updated_at = NOW()
        WHERE school_id = v_school_id
          AND student_id = ANY(v_student_ids)
          AND academic_year = p_old_academic_year
          AND withdrawn_at IS NULL;

        INSERT INTO class_enrollments
            (student_id, class_id, academic_year, semester)
        SELECT unnest(v_student_ids), v_target_class,
               p_academic_year, p_semester::text::semester
        ON CONFLICT (student_id, academic_year, semester) DO NOTHING;

        GET DIAGNOSTICS v_rows_inserted = ROW_COUNT;
        v_enrolled_count := v_enrolled_count + v_rows_inserted;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true, 'period_id', v_period_id,
        'enrolled_count', v_enrolled_count, 'slots_copied', v_slots_copied
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_update_program(
    p_program_id UUID,
    p_code TEXT,
    p_name TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id UUID := fn_current_school_id();
    v_old_code TEXT;
    v_renames JSONB := '[]'::jsonb;
BEGIN
    IF fn_current_user_role() <> 'ADMINISTRATIVE' OR v_school_id IS NULL THEN
        RAISE EXCEPTION 'akses ditolak: hanya ADMINISTRATIVE yang dapat mengubah program'
            USING ERRCODE = '42501';
    END IF;

    SELECT code INTO v_old_code
    FROM programs
    WHERE program_id = p_program_id AND school_id = v_school_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Program tidak ditemukan di sekolah ini';
    END IF;

    IF v_old_code IS DISTINCT FROM p_code THEN
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
            'from', c.name,
            'to', replace(c.name, v_old_code, p_code)
        )), '[]'::jsonb)
        INTO v_renames
        FROM classes c
        WHERE c.program_id = p_program_id
          AND c.school_id = v_school_id
          AND c.name LIKE '%' || v_old_code || '%';

        UPDATE classes
        SET name = replace(name, v_old_code, p_code), updated_at = NOW()
        WHERE program_id = p_program_id
          AND school_id = v_school_id
          AND name LIKE '%' || v_old_code || '%';
    END IF;

    UPDATE programs
    SET code = p_code, name = p_name, updated_at = NOW()
    WHERE program_id = p_program_id AND school_id = v_school_id;

    RETURN jsonb_build_object('renames', v_renames);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_update_program(UUID, TEXT, TEXT) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_update_program(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_update_program(UUID, TEXT, TEXT) FROM anon;

CREATE OR REPLACE FUNCTION public.fn_save_schedule_templates(
    p_academic_year TEXT,
    p_semester semester,
    p_day_of_week day_of_week,
    p_templates JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id UUID := fn_current_school_id();
    v_tpl JSONB;
BEGIN
    IF fn_current_user_role() <> 'ADMINISTRATIVE' OR v_school_id IS NULL THEN
        RAISE EXCEPTION 'akses ditolak: hanya ADMINISTRATIVE yang dapat menyimpan schedule templates'
            USING ERRCODE = '42501';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(p_templates, '[]'::jsonb)) item
        WHERE NOT EXISTS (
            SELECT 1 FROM classes c
            WHERE c.class_id = (item->>'class_id')::UUID
              AND c.school_id = v_school_id
        )
        OR NOT EXISTS (
            SELECT 1 FROM users u
            WHERE u.user_id = (item->>'teacher_id')::UUID
              AND u.school_id = v_school_id
              AND u.deleted_at IS NULL
        )
    ) THEN
        RAISE EXCEPTION 'Template jadwal berisi kelas atau guru dari sekolah lain'
            USING ERRCODE = '42501';
    END IF;

    DELETE FROM schedule_templates
    WHERE academic_year = p_academic_year AND semester = p_semester
      AND day_of_week = p_day_of_week AND school_id = v_school_id;

    FOR v_tpl IN SELECT * FROM jsonb_array_elements(COALESCE(p_templates, '[]'::jsonb)) LOOP
        INSERT INTO schedule_templates (
            academic_year, semester, day_of_week, school_id,
            start_time, end_time, class_id, teacher_id, subject_label
        ) VALUES (
            p_academic_year, p_semester, p_day_of_week, v_school_id,
            (v_tpl->>'start_time')::TIME, (v_tpl->>'end_time')::TIME,
            (v_tpl->>'class_id')::UUID, (v_tpl->>'teacher_id')::UUID,
            NULLIF(v_tpl->>'subject_label', '')
        );
    END LOOP;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_save_schedule_templates(TEXT, semester, day_of_week, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_save_schedule_templates(TEXT, semester, day_of_week, JSONB) TO service_role;
REVOKE EXECUTE ON FUNCTION public.fn_save_schedule_templates(TEXT, semester, day_of_week, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_save_schedule_templates(TEXT, semester, day_of_week, JSONB) FROM anon;

CREATE OR REPLACE FUNCTION public.fn_save_schedule_day(
    p_academic_year TEXT,
    p_semester semester,
    p_day_of_week day_of_week,
    p_slots JSONB,
    p_templates JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id UUID := fn_current_school_id();
    v_slot JSONB;
    v_tpl JSONB;
BEGIN
    IF fn_current_user_role() <> 'ADMINISTRATIVE' OR v_school_id IS NULL THEN
        RAISE EXCEPTION 'akses ditolak: hanya ADMINISTRATIVE yang dapat menyimpan jadwal'
            USING ERRCODE = '42501';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(p_templates, '[]'::jsonb)) item
        WHERE NOT EXISTS (
            SELECT 1 FROM classes c
            WHERE c.class_id = (item->>'class_id')::UUID
              AND c.school_id = v_school_id
        )
        OR NOT EXISTS (
            SELECT 1 FROM users u
            WHERE u.user_id = (item->>'teacher_id')::UUID
              AND u.school_id = v_school_id
              AND u.deleted_at IS NULL
        )
    ) THEN
        RAISE EXCEPTION 'Template jadwal berisi kelas atau guru dari sekolah lain'
            USING ERRCODE = '42501';
    END IF;

    DELETE FROM schedule_time_slots
    WHERE academic_year = p_academic_year AND semester = p_semester
      AND day_of_week = p_day_of_week AND school_id = v_school_id;

    FOR v_slot IN SELECT * FROM jsonb_array_elements(COALESCE(p_slots, '[]'::jsonb)) LOOP
        INSERT INTO schedule_time_slots (
            academic_year, semester, day_of_week, school_id, slot_number,
            start_time, end_time, is_break, break_label
        ) VALUES (
            p_academic_year, p_semester, p_day_of_week, v_school_id,
            (v_slot->>'slot_number')::INTEGER,
            (v_slot->>'start_time')::TIME, (v_slot->>'end_time')::TIME,
            COALESCE((v_slot->>'is_break')::BOOLEAN, FALSE),
            NULLIF(v_slot->>'break_label', '')
        );
    END LOOP;

    DELETE FROM schedule_templates
    WHERE academic_year = p_academic_year AND semester = p_semester
      AND day_of_week = p_day_of_week AND school_id = v_school_id;

    FOR v_tpl IN SELECT * FROM jsonb_array_elements(COALESCE(p_templates, '[]'::jsonb)) LOOP
        INSERT INTO schedule_templates (
            academic_year, semester, day_of_week, school_id,
            start_time, end_time, class_id, teacher_id, subject_label
        ) VALUES (
            p_academic_year, p_semester, p_day_of_week, v_school_id,
            (v_tpl->>'start_time')::TIME, (v_tpl->>'end_time')::TIME,
            (v_tpl->>'class_id')::UUID, (v_tpl->>'teacher_id')::UUID,
            NULLIF(v_tpl->>'subject_label', '')
        );
    END LOOP;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_save_schedule_day(TEXT, semester, day_of_week, JSONB, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_save_schedule_day(TEXT, semester, day_of_week, JSONB, JSONB) TO service_role;
REVOKE EXECUTE ON FUNCTION public.fn_save_schedule_day(TEXT, semester, day_of_week, JSONB, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_save_schedule_day(TEXT, semester, day_of_week, JSONB, JSONB) FROM anon;
