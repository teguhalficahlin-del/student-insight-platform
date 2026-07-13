-- ============================================================
-- Fix fn_audit_log_delete: ganti direct field access dalam CASE
-- dengan to_jsonb(OLD) agar aman untuk semua tabel.
-- Root cause: PL/pgSQL mengevaluasi SEMUA cabang CASE expression
-- termasuk OLD.case_id dan OLD.event_id saat OLD adalah record
-- dari tabel observations (yang tidak punya kolom-kolom tersebut).
-- ============================================================
CREATE OR REPLACE FUNCTION fn_audit_log_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_school_id uuid;
    v_row_id    text;
    v_row_json  jsonb;
BEGIN
    v_school_id := OLD.school_id;
    v_row_json  := to_jsonb(OLD);

    v_row_id := CASE TG_TABLE_NAME
        WHEN 'observations'  THEN v_row_json ->> 'observation_id'
        WHEN 'cases'         THEN v_row_json ->> 'case_id'
        WHEN 'case_events'   THEN v_row_json ->> 'event_id'
        ELSE                      'unknown'
    END;

    INSERT INTO audit_log (school_id, table_name, row_id, row_snapshot, deleted_by)
    VALUES (
        v_school_id,
        TG_TABLE_NAME,
        v_row_id,
        v_row_json,
        auth.uid()
    );

    RETURN OLD;
END;
$$;
