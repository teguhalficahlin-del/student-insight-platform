-- ============================================================
-- Migration: 20240201000000_bulk_import_users.sql
-- Supports bulk-import-users Edge Function.
-- ============================================================

-- Fast batch duplicate-check: given an array of login_identifier
-- candidates, returns the subset that already exists in `users`.
-- Used by bulk-import-users to flag duplicate NIP/NIK in one
-- round trip instead of N individual lookups.
CREATE OR REPLACE FUNCTION fn_check_identifiers_exist(p_identifiers TEXT[])
RETURNS TEXT[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT ARRAY(
        SELECT login_identifier
        FROM users
        WHERE login_identifier = ANY(p_identifiers)
    );
$$;

REVOKE EXECUTE ON FUNCTION fn_check_identifiers_exist FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_check_identifiers_exist FROM anon;
REVOKE EXECUTE ON FUNCTION fn_check_identifiers_exist FROM authenticated;

COMMENT ON FUNCTION fn_check_identifiers_exist IS
    'Called by bulk-import-users to batch-check NIP/NIK duplicates before provisioning.';
