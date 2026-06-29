-- ============================================================
-- Migration: 20240201000001_bulk_import_students.sql
-- Supports bulk-import-students Edge Function.
--
-- fn_bulk_import_students inserts (students + class_enrollments)
-- per row. Each row's pair of inserts is wrapped in its own
-- nested BEGIN/EXCEPTION block, so a failure on one row (e.g.
-- duplicate NIS) rolls back only that row's inserts — to the
-- start of its sub-block — and processing continues with the
-- next row. This is what "satu transaksi per baris" means here:
-- students+enrollment succeed/fail together, but the batch as a
-- whole supports partial success (per the required response
-- shape: { total, success, failed, errors[] }).
-- ============================================================

CREATE OR REPLACE FUNCTION fn_bulk_import_students(p_rows JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row           JSONB;
    v_student_id    UUID;
    v_success_count INTEGER := 0;
    v_errors        JSONB := '[]'::JSONB;
    v_row_index     INTEGER := 0;
BEGIN
    FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
    LOOP
        v_row_index := v_row_index + 1;

        BEGIN
            INSERT INTO students (nis, full_name, program_id, student_status)
            VALUES (
                v_row->>'nis',
                v_row->>'full_name',
                (v_row->>'program_id')::UUID,
                'AKTIF'
            )
            RETURNING student_id INTO v_student_id;

            INSERT INTO class_enrollments (
                student_id, class_id, academic_year, semester
            )
            VALUES (
                v_student_id,
                (v_row->>'class_id')::UUID,
                v_row->>'academic_year',
                (v_row->>'semester')::semester
            );

            v_success_count := v_success_count + 1;

        EXCEPTION WHEN OTHERS THEN
            -- Rolls back only this row's inserts (savepoint semantics
            -- of a plpgsql sub-block), batch continues.
            v_errors := v_errors || jsonb_build_object(
                'row_index', v_row_index,
                'nis',       v_row->>'nis',
                'message',   SQLERRM
            );
        END;
    END LOOP;

    RETURN jsonb_build_object(
        'success', v_success_count,
        'failed',  jsonb_array_length(v_errors),
        'errors',  v_errors
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION fn_bulk_import_students FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_bulk_import_students FROM anon;
REVOKE EXECUTE ON FUNCTION fn_bulk_import_students FROM authenticated;

COMMENT ON FUNCTION fn_bulk_import_students IS
    'Called exclusively by bulk-import-students Edge Function. '
    'Per-row atomic insert (students + class_enrollments) with partial-batch success.';
