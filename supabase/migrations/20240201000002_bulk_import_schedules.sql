-- ============================================================
-- Migration: 20240201000002_bulk_import_schedules.sql
-- Supports bulk-import-schedules Edge Function.
--
-- fn_bulk_import_schedules inserts teaching_schedules rows one
-- at a time. Before each insert it re-checks for a time overlap
-- against the same teacher on the same date — this is the
-- authoritative conflict check (the Edge Function does a
-- pre-check too, but only the DB sees the final committed state
-- of earlier rows in this same batch).
--
-- A detected conflict is NOT an error: it goes into `conflicts`
-- in the result so the admin can resolve it manually, distinct
-- from `errors` (genuine failures e.g. FK violations).
-- ============================================================

CREATE OR REPLACE FUNCTION fn_bulk_import_schedules(p_rows JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row            JSONB;
    v_row_index      INTEGER := 0;
    v_success_count  INTEGER := 0;
    v_errors         JSONB := '[]'::JSONB;
    v_conflicts      JSONB := '[]'::JSONB;
    v_conflict_exists BOOLEAN;
BEGIN
    FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
    LOOP
        v_row_index := v_row_index + 1;

        BEGIN
            -- Conflict check: same teacher, same date, overlapping time
            SELECT EXISTS (
                SELECT 1 FROM teaching_schedules ts
                WHERE ts.scheduled_teacher_id = (v_row->>'scheduled_teacher_id')::UUID
                  AND ts.session_date         = (v_row->>'session_date')::DATE
                  AND ts.session_start        < (v_row->>'session_end')::TIME
                  AND ts.session_end          > (v_row->>'session_start')::TIME
            ) INTO v_conflict_exists;

            IF v_conflict_exists THEN
                v_conflicts := v_conflicts || jsonb_build_object(
                    'row_index',  v_row_index,
                    'teacher_id', v_row->>'scheduled_teacher_id',
                    'date',       v_row->>'session_date',
                    'message',    'Konflik waktu: guru sudah memiliki jadwal lain yang tumpang tindih'
                );
            ELSE
                INSERT INTO teaching_schedules (
                    assignment_id, class_id, subject_id, scheduled_teacher_id,
                    session_date, session_start, session_end,
                    academic_year, semester
                )
                VALUES (
                    (v_row->>'assignment_id')::UUID,
                    (v_row->>'class_id')::UUID,
                    (v_row->>'subject_id')::UUID,
                    (v_row->>'scheduled_teacher_id')::UUID,
                    (v_row->>'session_date')::DATE,
                    (v_row->>'session_start')::TIME,
                    (v_row->>'session_end')::TIME,
                    v_row->>'academic_year',
                    (v_row->>'semester')::semester
                );

                v_success_count := v_success_count + 1;
            END IF;

        EXCEPTION WHEN OTHERS THEN
            v_errors := v_errors || jsonb_build_object(
                'row_index', v_row_index,
                'message',   SQLERRM
            );
        END;
    END LOOP;

    RETURN jsonb_build_object(
        'success',   v_success_count,
        'failed',    jsonb_array_length(v_errors),
        'errors',    v_errors,
        'conflicts', v_conflicts
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION fn_bulk_import_schedules FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_bulk_import_schedules FROM anon;
REVOKE EXECUTE ON FUNCTION fn_bulk_import_schedules FROM authenticated;

COMMENT ON FUNCTION fn_bulk_import_schedules IS
    'Called exclusively by bulk-import-schedules Edge Function. '
    'Per-row insert with same-teacher time-overlap conflict detection.';
