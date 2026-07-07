-- ============================================================
-- Migration: 20260706160000_revoke_public_confirm_password.sql
--
-- Fix CHECK 2 tenant-isolation: fn_confirm_password_changed() adalah
-- SECURITY DEFINER VOLATILE yang lolos filter karena PostgreSQL otomatis
-- memberi EXECUTE ke role PUBLIC saat fungsi dibuat. Migration sebelumnya
-- (20260706150000) hanya GRANT ke authenticated, tidak pernah REVOKE
-- dari PUBLIC.
--
-- REVOKE FROM PUBLIC tidak mencabut GRANT eksplisit yang sudah diberikan
-- ke authenticated — hanya mencabut default warisan PUBLIC. Hasilnya:
--   anon        → tidak bisa EXECUTE (karena PUBLIC dicabut, dan tidak
--                 ada grant eksplisit untuk anon)
--   authenticated → tetap bisa EXECUTE (grant eksplisit dari 20260706150000
--                   tidak terpengaruh)
-- ============================================================

REVOKE EXECUTE ON FUNCTION fn_confirm_password_changed() FROM PUBLIC;
