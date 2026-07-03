-- =====================================================================
-- 20260703200000_sync_validate_student_school.sql
--
-- PERBAIKAN AUDIT MULTI-TENANT — Temuan 5 (MEDIUM)
--
-- MASALAH
--   fn_sync_observation & fn_sync_case men-stamp school_id dari PENULIS,
--   tetapi tidak memvalidasi bahwa p_student_id benar-benar milik sekolah
--   yang sama. Akibatnya sebuah baris bisa mereferensikan student_id milik
--   tenant lain (pencemaran integritas lintas tenant), meski isi row tetap
--   ber-school_id penulis.
--
-- PERBAIKAN
--   Tambah pemeriksaan: student harus ada DI sekolah penulis (v_school_id).
--   Jika tidak, tolak dengan P0005 (student_not_in_school).
--
-- CATATAN
--   Badan fungsi = versi ber-guard dari migrasi 20260703190000
--   (penulis harus = akun login) DITAMBAH pemeriksaan sekolah student.
--   Idempoten (CREATE OR REPLACE).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.fn_sync_observation(
    p_idempotency_key text, p_observation_id uuid, p_author_user_id uuid,
    p_student_id uuid, p_sentiment text, p_dimension text, p_visibility text,
    p_content text, p_observed_at timestamp with time zone,
    p_schedule_id uuid DEFAULT NULL::uuid, p_class_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id UUID;
BEGIN
    IF auth.uid() IS NOT NULL
       AND fn_current_user_id() IS DISTINCT FROM p_author_user_id THEN
        RAISE EXCEPTION 'akses ditolak: penulis harus akun yang sedang login'
            USING ERRCODE = '42501';
    END IF;

    SELECT school_id INTO v_school_id
    FROM users
    WHERE user_id = p_author_user_id;

    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'author_not_found: user_id = %', p_author_user_id
            USING ERRCODE = 'P0004';
    END IF;

    -- Temuan 5: student HARUS milik sekolah penulis
    IF NOT EXISTS (
        SELECT 1 FROM students
        WHERE student_id = p_student_id AND school_id = v_school_id
    ) THEN
        RAISE EXCEPTION 'student_not_in_school: student_id = %', p_student_id
            USING ERRCODE = 'P0005';
    END IF;

    INSERT INTO observations (
        observation_id, author_user_id, student_id,
        sentiment, dimension, visibility, content, observed_at,
        schedule_id, class_id, school_id
    ) VALUES (
        p_observation_id, p_author_user_id, p_student_id,
        p_sentiment::observation_sentiment,
        p_dimension::observation_dimension,
        p_visibility::visibility_level,
        p_content, p_observed_at,
        p_schedule_id, p_class_id, v_school_id
    )
    ON CONFLICT (observation_id) DO UPDATE SET
        sentiment   = EXCLUDED.sentiment,
        dimension   = EXCLUDED.dimension,
        visibility  = EXCLUDED.visibility,
        content     = EXCLUDED.content,
        observed_at = EXCLUDED.observed_at,
        updated_at  = NOW();

    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO sync_idempotency (
            idempotency_key, function_name, result_json, school_id
        ) VALUES (
            p_idempotency_key, 'sync-observation',
            jsonb_build_object('observation_id', p_observation_id),
            v_school_id
        )
        ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;

    RETURN jsonb_build_object('observation_id', p_observation_id);
END;
$function$;


CREATE OR REPLACE FUNCTION public.fn_sync_case(
    p_idempotency_key text, p_case_id uuid, p_student_id uuid,
    p_created_by_user_id uuid, p_initiated_by_role text, p_track text,
    p_title text, p_description text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id UUID;
BEGIN
    IF auth.uid() IS NOT NULL
       AND fn_current_user_id() IS DISTINCT FROM p_created_by_user_id THEN
        RAISE EXCEPTION 'akses ditolak: pembuat kasus harus akun yang sedang login'
            USING ERRCODE = '42501';
    END IF;

    SELECT school_id INTO v_school_id
    FROM users
    WHERE user_id = p_created_by_user_id;

    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'author_not_found: user_id = %', p_created_by_user_id
            USING ERRCODE = 'P0004';
    END IF;

    -- Temuan 5: student HARUS milik sekolah pembuat kasus
    IF NOT EXISTS (
        SELECT 1 FROM students
        WHERE student_id = p_student_id AND school_id = v_school_id
    ) THEN
        RAISE EXCEPTION 'student_not_in_school: student_id = %', p_student_id
            USING ERRCODE = 'P0005';
    END IF;

    INSERT INTO cases (
        case_id, student_id, created_by_user_id,
        initiated_by_role, current_handler_role,
        track, title, description, school_id
    ) VALUES (
        p_case_id, p_student_id, p_created_by_user_id,
        p_initiated_by_role, p_initiated_by_role,
        p_track, p_title, p_description, v_school_id
    )
    ON CONFLICT (case_id) DO NOTHING;

    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO sync_idempotency (
            idempotency_key, function_name, result_json, school_id
        ) VALUES (
            p_idempotency_key, 'sync-case',
            jsonb_build_object('case_id', p_case_id),
            v_school_id
        )
        ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;

    RETURN jsonb_build_object('case_id', p_case_id);
END;
$function$;
