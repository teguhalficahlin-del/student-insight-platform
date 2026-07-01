-- ============================================================
-- Migration: 20260701360000_fn_sync_observation_journal.sql
--
-- RPC helper untuk offline sync Observasi dan Jurnal Mengajar.
-- Keduanya SECURITY DEFINER agar edge fn (service-role) bisa
-- INSERT tanpa tabrakan RLS, sambil tetap memvalidasi kepemilikan
-- data di lapisan edge.
--
-- Idempoten: keyed via sync_idempotency seperti fn_sync_attendance_batch.
-- ============================================================

-- ── fn_sync_observation ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_sync_observation(
    p_idempotency_key TEXT,
    p_observation_id  UUID,
    p_author_user_id  UUID,
    p_student_id      UUID,
    p_sentiment       TEXT,
    p_dimension       TEXT,
    p_visibility      TEXT,
    p_content         TEXT,
    p_observed_at     TIMESTAMPTZ,
    p_schedule_id     UUID DEFAULT NULL,
    p_class_id        UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_school_id UUID;
BEGIN
    -- Derive school_id dari penulis
    SELECT school_id INTO v_school_id
    FROM users
    WHERE user_id = p_author_user_id;

    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'author_not_found: user_id = %', p_author_user_id
            USING ERRCODE = 'P0004';
    END IF;

    -- Upsert observasi (idempoten via observation_id PK)
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

    -- Catat idempotency key
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
$$;

-- ── fn_sync_journal ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_sync_journal(
    p_idempotency_key TEXT,
    p_journal_id      UUID,
    p_owner_user_id   UUID,
    p_entry_date      DATE,
    p_content         TEXT,
    p_schedule_id     UUID DEFAULT NULL,
    p_class_id        UUID DEFAULT NULL
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
    WHERE user_id = p_owner_user_id;

    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'owner_not_found: user_id = %', p_owner_user_id
            USING ERRCODE = 'P0004';
    END IF;

    -- Upsert jurnal (idempoten via journal_id PK)
    INSERT INTO teacher_journals (
        journal_id, owner_user_id, entry_date, content,
        schedule_id, class_id, school_id
    ) VALUES (
        p_journal_id, p_owner_user_id, p_entry_date, p_content,
        p_schedule_id, p_class_id, v_school_id
    )
    ON CONFLICT (journal_id) DO UPDATE SET
        entry_date = EXCLUDED.entry_date,
        content    = EXCLUDED.content,
        updated_at = NOW();

    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO sync_idempotency (
            idempotency_key, function_name, result_json, school_id
        ) VALUES (
            p_idempotency_key, 'sync-journal',
            jsonb_build_object('journal_id', p_journal_id),
            v_school_id
        )
        ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;

    RETURN jsonb_build_object('journal_id', p_journal_id);
END;
$$;
