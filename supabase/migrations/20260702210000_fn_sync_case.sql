-- ============================================================
-- Migration 20260702210000: fn_sync_case
--
-- RPC helper untuk offline sync pembuatan kasus baru.
-- SECURITY DEFINER agar edge fn (service-role) bisa INSERT
-- tanpa tabrakan RLS; validasi kepemilikan di lapisan edge.
-- Idempoten: keyed via sync_idempotency seperti fn_sync_journal.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_sync_case(
    p_idempotency_key    TEXT,
    p_case_id            UUID,
    p_student_id         UUID,
    p_created_by_user_id UUID,
    p_initiated_by_role  TEXT,
    p_track              TEXT,
    p_title              TEXT,
    p_description        TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_school_id UUID;
BEGIN
    SELECT school_id INTO v_school_id
    FROM users
    WHERE user_id = p_created_by_user_id;

    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'author_not_found: user_id = %', p_created_by_user_id
            USING ERRCODE = 'P0004';
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
$$;
