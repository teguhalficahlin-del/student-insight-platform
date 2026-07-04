-- ============================================================
-- Migration: 20260705000000_fix_resolve_login_email_deleted.sql
--
-- Tambah filter AND deleted_at IS NULL ke fn_resolve_login_email.
--
-- SEBELUM: query hanya cek is_active = TRUE
--   → Secara teori user yang di-soft-delete tapi entah bagaimana
--     masih is_active=TRUE masih bisa ter-resolve (edge case).
--   → Lebih penting: niat kode tidak terbaca — pembaca harus tahu
--     bahwa soft-delete SELALU juga set is_active=FALSE agar yakin
--     tidak ada kebocoran.
-- SESUDAH: kedua kondisi eksplisit → defensif & self-documenting.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_resolve_login_email(
    p_identifier TEXT,
    p_school_id  UUID
)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT email FROM users
    WHERE login_identifier = p_identifier
      AND school_id        = p_school_id
      AND is_active        = TRUE
      AND deleted_at       IS NULL
    LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION fn_resolve_login_email(TEXT, UUID) TO anon;
GRANT EXECUTE ON FUNCTION fn_resolve_login_email(TEXT, UUID) TO authenticated;

COMMENT ON FUNCTION fn_resolve_login_email IS
    'Pre-auth lookup: login_identifier -> email, WAJIB disertai school_id. '
    'Hanya user aktif (is_active=TRUE) dan tidak terhapus (deleted_at IS NULL) yang ter-resolve. '
    'Tanpa school_id yang valid query selalu NULL — tidak ada fallback global.';
