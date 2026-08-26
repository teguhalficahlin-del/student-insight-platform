-- ============================================================
-- Security: C1 + D
--   C1: Cabut EXECUTE fn_is_period_closed dari anon
--       Tidak ada use-case legitim untuk anon — semua caller
--       yang sah sudah authenticated.
--   D:  Cabut write access WAKA_HUMAS dari pkl_placements
--       WAKA_HUMAS hanya perlu READ (SELECT). UI sudah read-only.
--       SELECT via rls_pkl_read_staff tidak disentuh.
-- ============================================================

BEGIN;

-- ── C1: Cabut EXECUTE fn_is_period_closed dari anon ──────────
-- Signature terverifikasi via pg_proc: fn_is_period_closed(date, uuid)
REVOKE EXECUTE ON FUNCTION public.fn_is_period_closed(date, uuid) FROM anon;

-- ── D: Recreate rls_pkl_write_admin tanpa WAKA_HUMAS ─────────
-- Policy lama (USING): KAPRODI | KEPSEK | WAKA_HUMAS → FOR ALL
-- Policy baru (USING): KAPRODI | KEPSEK saja → FOR ALL
-- rls_pkl_read_staff (SELECT) tidak disentuh.
DROP POLICY IF EXISTS rls_pkl_write_admin ON pkl_placements;
CREATE POLICY rls_pkl_write_admin ON pkl_placements FOR ALL
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['KAPRODI'::role_type, 'KEPSEK'::role_type])
    )
    WITH CHECK (school_id = fn_current_school_id());

COMMIT;
