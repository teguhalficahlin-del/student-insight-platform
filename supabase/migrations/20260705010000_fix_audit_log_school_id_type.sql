-- ============================================================
-- Migration 20260705010000: ubah audit_log.school_id text → uuid
-- ROLLBACK:
--   ALTER TABLE audit_log ALTER COLUMN school_id TYPE text USING school_id::text;
-- SNAPSHOT PRA-APPLY: tabel audit_log kosong (0 baris)
-- ============================================================

-- Drop policy dulu agar ALTER COLUMN tidak terblokir
DROP POLICY IF EXISTS rls_audit_log_read ON audit_log;

ALTER TABLE audit_log
    ALTER COLUMN school_id TYPE uuid USING school_id::uuid;

CREATE POLICY rls_audit_log_read ON audit_log FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (
            ARRAY['KEPSEK','WAKA_KESISWAAN','WAKA_HUMAS','KAPRODI','ADMINISTRATIVE']::role_type[]
        ));

-- Perbarui trigger function: v_school_id uuid, tidak perlu cast
CREATE OR REPLACE FUNCTION fn_audit_log_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_school_id uuid;
    v_row_id    text;
BEGIN
    v_school_id := OLD.school_id;

    v_row_id := CASE TG_TABLE_NAME
        WHEN 'observations'  THEN (OLD.observation_id)::text
        WHEN 'cases'         THEN (OLD.case_id)::text
        WHEN 'case_events'   THEN (OLD.event_id)::text
        ELSE 'unknown'
    END;

    INSERT INTO audit_log (school_id, table_name, row_id, row_snapshot, deleted_by)
    VALUES (
        v_school_id,
        TG_TABLE_NAME,
        v_row_id,
        to_jsonb(OLD),
        auth.uid()
    );

    RETURN OLD;
END;
$$;
