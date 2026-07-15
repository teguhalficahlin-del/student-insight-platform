-- fn_sync_attendance_batch gagal dengan "null value in column school_id of
-- relation sync_idempotency" karena INSERT ke sync_idempotency tidak
-- menyertakan school_id. Trigger fn_auto_set_school_id tidak menangani
-- tabel sync_idempotency (jatuh ke ELSE → NULL), dan kolom school_id
-- berstatus NOT NULL.
--
-- Fix: sertakan school_id eksplisit dari v_schedule.school_id (sudah
-- di-fetch di awal fungsi via SELECT * FROM teaching_schedules).

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
        WHERE attendance.is_void = FALSE;

        v_count := v_count + 1;
    END LOOP;

    -- b. UPDATE meeting_status if provided
    IF p_meeting_status IS NOT NULL THEN
        UPDATE teaching_schedules
        SET meeting_status = p_meeting_status::meeting_status,
            updated_at     = NOW()
        WHERE schedule_id = p_schedule_id;
    END IF;

    -- c. INSERT teacher_attendance_log signal (TN-02)
    v_activity_type := CASE
        WHEN p_is_substitute THEN 'SUBSTITUTE_ATTENDANCE_SUBMITTED'
        ELSE 'ATTENDANCE_SUBMITTED'
    END;

    INSERT INTO teacher_attendance_log (schedule_id, user_id, activity_type)
    SELECT p_schedule_id, p_submitted_by, v_activity_type
    WHERE v_schedule.session_date     = CURRENT_DATE
      AND v_schedule.teacher_indicator = 'PENDING_EVALUATION'
    ON CONFLICT DO NOTHING;

    -- d. Record idempotency key — sertakan school_id eksplisit karena
    --    fn_auto_set_school_id tidak menangani tabel sync_idempotency.
    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO sync_idempotency (
            idempotency_key,
            function_name,
            result_json,
            school_id
        ) VALUES (
            p_idempotency_key,
            'sync-attendance-batch',
            jsonb_build_object('schedule_id', p_schedule_id, 'records_upserted', v_count),
            v_schedule.school_id
        )
        ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;

    -- e. Flip teacher_indicator PENDING → HADIR segera setelah absensi disubmit.
    IF v_schedule.session_date = CURRENT_DATE
       AND v_schedule.teacher_indicator = 'PENDING_EVALUATION' THEN
        UPDATE teaching_schedules
        SET    teacher_indicator = 'HADIR'::teacher_attendance_indicator,
               updated_at        = NOW()
        WHERE  schedule_id = p_schedule_id;
    END IF;

    RETURN jsonb_build_object('records_upserted', v_count);

EXCEPTION
    WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'invalid_enum_value: %', SQLERRM
            USING ERRCODE = 'P0005';
END;
$$;

REVOKE EXECUTE ON FUNCTION fn_sync_attendance_batch FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_sync_attendance_batch FROM anon;
REVOKE EXECUTE ON FUNCTION fn_sync_attendance_batch FROM authenticated;
