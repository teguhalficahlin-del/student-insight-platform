-- ============================================================
-- Kelompok 6 (offline) — fn_sync_attendance_batch simpan `notes`
-- ============================================================
-- Jalur batch (dipakai untuk absensi online+offline terpadu) sebelumnya
-- tak menyimpan kolom notes (alasan izin). Portal guru punya field itu →
-- agar tak regresi, tambahkan notes ke INSERT/UPSERT. Selain itu identik
-- dengan versi 20260701310000 (school_id di sync_idempotency).
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_sync_attendance_batch(
    p_schedule_id uuid, p_submitted_by uuid, p_records jsonb,
    p_meeting_status text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text,
    p_is_substitute boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

    FOR v_record IN SELECT * FROM jsonb_array_elements(p_records)
    LOOP
        INSERT INTO attendance (
            schedule_id, student_id, status, source,
            recorded_by_user_id, is_void, void_reason, notes
        )
        VALUES (
            p_schedule_id,
            (v_record->>'student_id')::UUID,
            (v_record->>'status')::attendance_status,
            (v_record->>'source')::attendance_source,
            p_submitted_by,
            FALSE,
            NULL,
            NULLIF(v_record->>'notes', '')
        )
        ON CONFLICT (schedule_id, student_id)
        DO UPDATE SET
            status              = EXCLUDED.status,
            source              = EXCLUDED.source,
            recorded_by_user_id = EXCLUDED.recorded_by_user_id,
            is_void             = FALSE,
            void_reason         = NULL,
            notes               = EXCLUDED.notes,
            updated_at          = NOW()
        WHERE attendance.is_void = FALSE;

        v_count := v_count + 1;
    END LOOP;

    IF p_meeting_status IS NOT NULL THEN
        UPDATE teaching_schedules
        SET meeting_status = p_meeting_status::meeting_status,
            updated_at     = NOW()
        WHERE schedule_id = p_schedule_id;
    END IF;

    v_activity_type := CASE
        WHEN p_is_substitute THEN 'SUBSTITUTE_ATTENDANCE_SUBMITTED'
        ELSE 'ATTENDANCE_SUBMITTED'
    END;

    INSERT INTO teacher_attendance_log (schedule_id, user_id, activity_type)
    SELECT p_schedule_id, p_submitted_by, v_activity_type
    WHERE v_schedule.session_date  = CURRENT_DATE
      AND v_schedule.teacher_indicator = 'PENDING_EVALUATION'
    ON CONFLICT DO NOTHING;

    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO sync_idempotency (idempotency_key, function_name, result_json, school_id)
        VALUES (
            p_idempotency_key, 'sync-attendance-batch',
            jsonb_build_object('schedule_id', p_schedule_id, 'records_upserted', v_count),
            v_schedule.school_id
        )
        ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;

    RETURN jsonb_build_object('records_upserted', v_count);

EXCEPTION
    WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'invalid_enum_value: %', SQLERRM
            USING ERRCODE = 'P0005';
END;
$function$;
