-- ============================================================
-- Migration: 20260702110000_enforce_school_slug_login.sql
-- Tahap 1a: p_school_id wajib di fn_resolve_login_email
--
-- SEBELUM: p_school_id UUID DEFAULT NULL
--   → Login tanpa slug URL bisa berjalan dan me-resolve
--     ke sekolah mana pun yang pertama cocok
-- SESUDAH: p_school_id UUID (wajib, tanpa default)
--   → Login TANPA konteks sekolah tidak akan pernah
--     menemukan email — query selalu menghasilkan NULL
--   → Aktor sekolah A tidak bisa terauthentikasi
--     sebagai aktor sekolah lain dalam kondisi apa pun
-- ============================================================

DROP FUNCTION IF EXISTS fn_resolve_login_email(TEXT, UUID);

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
    LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION fn_resolve_login_email(TEXT, UUID) TO anon;
GRANT EXECUTE ON FUNCTION fn_resolve_login_email(TEXT, UUID) TO authenticated;

COMMENT ON FUNCTION fn_resolve_login_email IS
    'Pre-auth lookup: login_identifier -> email, WAJIB disertai school_id. '
    'Tanpa school_id yang valid query selalu NULL — tidak ada fallback global. '
    'Menjamin aktor sekolah A tidak pernah ter-resolve ke sekolah B.';
