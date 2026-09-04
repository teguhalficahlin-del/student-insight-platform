-- Tambah policy SELECT eksplisit untuk ADMINISTRATIVE di schedule_templates.
-- Sebelumnya ADMINISTRATIVE hanya mendapat read access melalui policy FOR ALL
-- (rls_schedule_templates_write_administrative), yang juga mencakup SELECT.
-- Jika policy FOR ALL nanti diubah ke INSERT/UPDATE/DELETE saja, ADMINISTRATIVE
-- akan kehilangan read access secara tidak sengaja.
-- Policy ini menjamin read access tetap tersedia secara eksplisit dan independen.

DROP POLICY IF EXISTS rls_schedule_templates_read_administrative ON schedule_templates;

CREATE POLICY rls_schedule_templates_read_administrative ON schedule_templates
    FOR SELECT
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type
    );
