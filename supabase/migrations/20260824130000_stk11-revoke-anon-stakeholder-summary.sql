-- Migration: 20260824130000_stk11-revoke-anon-stakeholder-summary.sql
--
-- LATAR BELAKANG (STK-11):
-- Migration 20260708050000_guard_fn_stakeholder_summary.sql merekonstruksi
-- fn_stakeholder_summary() dengan guard role, tapi tidak menyertakan
-- REVOKE FROM anon secara eksplisit. Migration sebelumnya (20260703190000)
-- sudah REVOKE, namun best practice: setiap CREATE OR REPLACE harus diikuti
-- GRANT/REVOKE ulang agar migration bersifat self-contained dan idempotent.
--
-- FIX: Re-apply REVOKE dari anon + PUBLIC, GRANT ke authenticated + service_role.
-- Idempotent — aman dijalankan berulang kali.

REVOKE EXECUTE ON FUNCTION public.fn_stakeholder_summary() FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_stakeholder_summary() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.fn_stakeholder_summary() TO authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_stakeholder_summary() TO service_role;
