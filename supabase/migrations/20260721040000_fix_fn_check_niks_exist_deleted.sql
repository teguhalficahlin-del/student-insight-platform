-- fix: fn_check_niks_exist harus mengabaikan user yang soft-deleted
-- Root cause: ORTU yang deleted_at IS NOT NULL dianggap "existing NIK"
-- sehingga import masuk jalur UPDATE, student_parents terhubung ke user
-- deleted, dan wizard fetch (.is('deleted_at', null)) tidak menemukannya.
DROP FUNCTION IF EXISTS fn_check_niks_exist(TEXT[], UUID);
CREATE OR REPLACE FUNCTION fn_check_niks_exist(
    p_niks      TEXT[],
    p_school_id UUID
)
RETURNS TEXT[]
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    SELECT ARRAY(
        SELECT login_identifier
        FROM users
        WHERE login_identifier = ANY(p_niks)
          AND school_id = p_school_id
          AND deleted_at IS NULL
    );
$$;

REVOKE EXECUTE ON FUNCTION fn_check_niks_exist(TEXT[], UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_check_niks_exist(TEXT[], UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION fn_check_niks_exist(TEXT[], UUID) FROM authenticated;

COMMENT ON FUNCTION fn_check_niks_exist IS
'Cek NIK mana yang sudah terdaftar di sekolah ini (hanya user aktif, deleted_at IS NULL).
Dipakai oleh bulk-import-parents untuk memisahkan jalur INSERT vs UPDATE.';
