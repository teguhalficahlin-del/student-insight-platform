-- ============================================================
-- Migration 20260704140000: tabel audit_log + trigger DELETE destruktif
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_audit_observations_delete ON observations;
--   DROP TRIGGER IF EXISTS trg_audit_cases_delete ON cases;
--   DROP TRIGGER IF EXISTS trg_audit_case_events_delete ON case_events;
--   DROP FUNCTION IF EXISTS fn_audit_log_delete();
--   DROP TABLE IF EXISTS audit_log;
-- SNAPSHOT PRA-APPLY: -
-- ============================================================

-- P2-D: Sebelumnya tidak ada jejak penghapusan data sensitif.
-- Tabel ini mencatat siapa, apa, kapan, dengan snapshot baris yang dihapus,
-- sehingga sengketa bisa ditelusuri ke waktu dan pelaku spesifik.

CREATE TABLE IF NOT EXISTS audit_log (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    school_id      text        NOT NULL,
    table_name     text        NOT NULL,
    operation      text        NOT NULL DEFAULT 'DELETE',
    row_id         text        NOT NULL,
    row_snapshot   jsonb       NOT NULL,
    deleted_by     uuid,
    deleted_at     timestamptz NOT NULL DEFAULT now()
);

-- Index untuk query per sekolah dan per tabel
CREATE INDEX IF NOT EXISTS idx_audit_log_school_table
    ON audit_log (school_id, table_name, deleted_at DESC);

-- Hanya tenant sendiri yang bisa membaca jejak audit-nya
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_audit_log_read ON audit_log;
CREATE POLICY rls_audit_log_read ON audit_log FOR SELECT
    USING (school_id = fn_current_school_id()::text
        AND fn_current_user_role() = ANY (
            ARRAY['KEPSEK','WAKA_KESISWAAN','WAKA_HUMAS','KAPRODI','ADMINISTRATIVE']::role_type[]
        ));

-- Tidak ada INSERT/UPDATE/DELETE policy untuk user biasa —
-- hanya trigger SECURITY DEFINER yang boleh menulis.

REVOKE INSERT, UPDATE, DELETE ON audit_log FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON audit_log FROM anon;

-- ── Fungsi trigger ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_audit_log_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_school_id text;
    v_row_id    text;
BEGIN
    -- Ambil school_id dari baris yang dihapus (semua tabel target punya kolom ini)
    v_school_id := (OLD.school_id)::text;

    -- Tentukan primary key yang paling informatif per tabel
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

-- ── Pasang trigger ke tabel target ───────────────────────────
DROP TRIGGER IF EXISTS trg_audit_observations_delete ON observations;
CREATE TRIGGER trg_audit_observations_delete
    BEFORE DELETE ON observations
    FOR EACH ROW EXECUTE FUNCTION fn_audit_log_delete();

DROP TRIGGER IF EXISTS trg_audit_cases_delete ON cases;
CREATE TRIGGER trg_audit_cases_delete
    BEFORE DELETE ON cases
    FOR EACH ROW EXECUTE FUNCTION fn_audit_log_delete();

DROP TRIGGER IF EXISTS trg_audit_case_events_delete ON case_events;
CREATE TRIGGER trg_audit_case_events_delete
    BEFORE DELETE ON case_events
    FOR EACH ROW EXECUTE FUNCTION fn_audit_log_delete();
