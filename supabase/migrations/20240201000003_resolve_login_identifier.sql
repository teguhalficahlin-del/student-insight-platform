-- ============================================================
-- Migration: 20240201000003_resolve_login_identifier.sql
-- Supports admin/ login page (js/auth.js).
--
-- Login form takes only { login_identifier, password } — no
-- email field. Supabase Auth itself requires an email to sign
-- in, so the browser must resolve login_identifier -> email
-- BEFORE calling supabase.auth.signInWithPassword(). Since the
-- caller isn't authenticated yet, this must be reachable by the
-- `anon` role. It intentionally returns ONLY the email — never
-- role_type, user_id, or any other column — so it can't be used
-- to enumerate account details, only to drive the login form.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_resolve_login_email(p_identifier TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT email FROM users
    WHERE login_identifier = p_identifier
      AND is_active = TRUE;
$$;

GRANT EXECUTE ON FUNCTION fn_resolve_login_email TO anon;
GRANT EXECUTE ON FUNCTION fn_resolve_login_email TO authenticated;

COMMENT ON FUNCTION fn_resolve_login_email IS
    'Pre-auth lookup: login_identifier -> email, for the admin login form. '
    'Returns only email — never other user columns.';
