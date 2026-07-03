-- =====================================================================
-- 20260703210000_revoke_branding_update_anon.sql
--
-- HARDENING lanjutan audit — fn_update_school_branding
--
-- Ditemukan oleh guard-rail tests/tenant-isolation.mjs: fungsi VOLATILE
-- (menulis ke tabel schools) yang masih ber-EXECUTE `anon` via grant PUBLIC
-- default. Sudah aman lewat guard internal (auth.uid() + ADMINISTRATIVE),
-- tetapi tidak boleh terekspos ke anon (defense-in-depth).
--
-- Dipanggil dari admin/js/api.js oleh admin (authenticated) → GRANT authenticated.
-- Dua overload (6-arg dan 7-arg).
-- =====================================================================

REVOKE EXECUTE ON FUNCTION public.fn_update_school_branding(text,text,text,text,text,text)       FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_update_school_branding(text,text,text,text,text,text)       TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.fn_update_school_branding(text,text,text,text,text,text,text)  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.fn_update_school_branding(text,text,text,text,text,text,text)  TO authenticated, service_role;
