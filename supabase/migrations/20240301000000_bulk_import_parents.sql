-- ============================================================
-- Migration: 20240301000000_bulk_import_parents.sql
-- Supports bulk-import-parents Edge Function.
-- ============================================================

-- Fast batch duplicate-check: given an array of NIK candidates,
-- returns the subset that already exists as users.login_identifier.
-- Used by bulk-import-parents to decide which rows can skip ORTU
-- account creation (idempotent re-import) while still linking the
-- student_parents relation.
CREATE OR REPLACE FUNCTION fn_check_niks_exist(p_niks TEXT[])
RETURNS TEXT[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT ARRAY(
        SELECT login_identifier
        FROM users
        WHERE login_identifier = ANY(p_niks)
    );
$$;

REVOKE EXECUTE ON FUNCTION fn_check_niks_exist FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_check_niks_exist FROM anon;
REVOKE EXECUTE ON FUNCTION fn_check_niks_exist FROM authenticated;

COMMENT ON FUNCTION fn_check_niks_exist IS
    'Called by bulk-import-parents to batch-check NIK duplicates before provisioning ORTU accounts.';
