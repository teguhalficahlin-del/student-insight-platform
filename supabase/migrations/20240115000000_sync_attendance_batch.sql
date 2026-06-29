-- ============================================================
-- Migration: 20240115000000_sync_attendance_batch.sql
-- Adds infrastructure required by sync-attendance-batch Edge Function.
--
-- APPLY ORDER: After the main DDL (00_APPLY_ORDER.sql is done).
-- Run via: supabase db push OR paste into Supabase SQL Editor.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- TABLE: sync_idempotency
-- Tracks processed idempotency keys across all Edge Functions.
-- Prevents duplicate processing of replayed requests.
--
-- Keyed on idempotency_key (client-generated UUID).
-- Stores the result_json so duplicate requests get the original
-- response without re-running the business logic.
--
-- TTL: rows older than 30 days are safe to delete (no client
-- will replay an item that old — max_retries would have expired).
-- ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sync_idempotency (
    idempotency_key     TEXT        PRIMARY KEY,
    function_name       VARCHAR(100) NOT NULL,
    result_json         JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for TTL cleanup job
CREATE INDEX IF NOT EXISTS idx_idempotency_created
    ON sync_idempotency(created_at);

-- RLS: only the service role (Edge Functions) can read/write
ALTER TABLE sync_idempotency ENABLE ROW LEVEL SECURITY;

-- No client-facing policies — service role bypasses RLS
COMMENT ON TABLE sync_idempotency IS
    'Idempotency keys for Edge Function requests. '
    'Service role only. TTL: 30 days.';


-- ─────────────────────────────────────────────────────────────
-- CRON: Clean up old idempotency keys (requires pg_cron)
-- ─────────────────────────────────────────────────────────────

-- Enable pg_cron if not already enabled
-- CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Run nightly at 02:00 UTC (09:00 WIB)
-- SELECT cron.schedule(
--     'cleanup-idempotency-keys',
--     '0 2 * * *',
--     $$DELETE FROM sync_idempotency WHERE created_at < NOW() - INTERVAL '30 days'$$
-- );


-- ─────────────────────────────────────────────────────────────
-- FUNCTION: fn_sync_attendance_batch
--
-- Called by the sync-attendance-batch Edge Function.
-- Runs as SECURITY DEFINER — bypasses RLS for writes.
-- All permission checks are done in the Edge Function BEFORE
-- calling this function.
--
-- Parameters:
--   p_schedule_id      UUID    — target schedule
--   p_submitted_by     UUID    — user_id of submitter
--   p_records          JSONB   — array of { student_id, status, source }
--   p_meeting_status   TEXT    — optional, updates schedule meeting_status
--   p_idempotency_key  TEXT    — optional, for dedup tracking
--   p_is_substitute    BOOLEAN — true if submitted by a substitute teacher
--
-- Returns: JSONB { records_upserted: integer }
-- ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_sync_attendance_batch(
    p_schedule_id       UUID,
    p_submitted_by      UUID,
    p_records           JSONB,
    p_meeting_status    TEXT     DEFAULT NULL,
    p_idempotency_key   TEXT     DEFAULT NULL,
    p_is_substitute     BOOLEAN  DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_record        JSONB;
    v_count         INTEGER := 0;
    v_activity_type VARCHAR(50);
    v_schedule      teaching_schedules%ROWTYPE;
BEGIN
    -- Lock the schedule row to prevent concurrent updates
    SELECT * INTO v_schedule
    FROM teaching_schedules
    WHERE schedule_id = p_schedule_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'schedule_not_found: schedule_id = %', p_schedule_id
            USING ERRCODE = 'P0004';
    END IF;

    -- a. UPSERT each attendance record
    FOR v_record IN SELECT * FROM jsonb_array_elements(p_records)
    LOOP
        INSERT INTO attendance (
            schedule_id,
            student_id,
            status,
            source,
            recorded_by_user_id,
            is_void,
            void_reason
        )
        VALUES (
            p_schedule_id,
            (v_record->>'student_id')::UUID,
            (v_record->>'status')::attendance_status,
            (v_record->>'source')::attendance_source,
            p_submitted_by,
            FALSE,
            NULL
        )
        ON CONFLICT (schedule_id, student_id)
        DO UPDATE SET
            status              = EXCLUDED.status,
            source              = EXCLUDED.source,
            recorded_by_user_id = EXCLUDED.recorded_by_user_id,
            is_void             = FALSE,
            void_reason         = NULL,
            updated_at          = NOW()
        -- Only update if not void (voided records are locked)
        WHERE attendance.is_void = FALSE;

        v_count := v_count + 1;
    END LOOP;

    -- b. UPDATE meeting_status if provided
    IF p_meeting_status IS NOT NULL THEN
        UPDATE teaching_schedules
        SET meeting_status = p_meeting_status::meeting_status,
            updated_at     = NOW()
        WHERE schedule_id = p_schedule_id;
        -- Note: if p_meeting_status = 'GURU_TIDAK_HADIR',
        -- trg_void_session_attendance fires and voids all records.
    END IF;

    -- c. INSERT teacher_attendance_log signal (TN-02)
    -- Only insert if the session is today and still PENDING_EVALUATION
    v_activity_type := CASE
        WHEN p_is_substitute THEN 'SUBSTITUTE_ATTENDANCE_SUBMITTED'
        ELSE 'ATTENDANCE_SUBMITTED'
    END;

    INSERT INTO teacher_attendance_log (schedule_id, user_id, activity_type)
    SELECT p_schedule_id, p_submitted_by, v_activity_type
    WHERE v_schedule.session_date  = CURRENT_DATE
      AND v_schedule.teacher_indicator = 'PENDING_EVALUATION'
    ON CONFLICT DO NOTHING;

    -- d. Record idempotency key
    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO sync_idempotency (
            idempotency_key,
            function_name,
            result_json
        ) VALUES (
            p_idempotency_key,
            'sync-attendance-batch',
            jsonb_build_object('schedule_id', p_schedule_id, 'records_upserted', v_count)
        )
        ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;

    RETURN jsonb_build_object('records_upserted', v_count);

EXCEPTION
    WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'invalid_enum_value: %', SQLERRM
            USING ERRCODE = 'P0005';
END;
$$;

-- Revoke public execute — only service role (SECURITY DEFINER owner) should call this
REVOKE EXECUTE ON FUNCTION fn_sync_attendance_batch FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_sync_attendance_batch FROM anon;
REVOKE EXECUTE ON FUNCTION fn_sync_attendance_batch FROM authenticated;

COMMENT ON FUNCTION fn_sync_attendance_batch IS
    'Called exclusively by sync-attendance-batch Edge Function. '
    'SECURITY DEFINER — all permission checks done in Edge Function before calling. '
    'Atomically: upserts attendance, updates meeting_status, signals teacher indicator, '
    'records idempotency key.';
