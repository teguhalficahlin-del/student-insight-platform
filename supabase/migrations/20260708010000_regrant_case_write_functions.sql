-- Migration: 20260708010000_regrant_case_write_functions.sql
--
-- LATAR BELAKANG:
-- Migration 20260707150000 merevoke fn_is_internal_case_actor() dan
-- fn_matches_case_handler(role_type, uuid) dari authenticated sebagai
-- bagian dari cleanup excess-grant.
--
-- REGRESI TERKONFIRMASI EMPIRIS (8 Juli 2026, simulasi live):
-- ERROR 42501: permission denied for function fn_matches_case_handler
-- saat GURU smkhr mencoba UPDATE cases.
--
-- Akar masalah: 6 policy dengan roles={public} memanggil kedua fungsi ini
-- LANGSUNG di USING/WITH CHECK clause. Seluruh write path kasus rusak
-- sejak 20260707150000 (UPDATE cases, INSERT/DELETE case_audience_members,
-- INSERT case_events, INSERT student_updates).
--
-- KEAMANAN RE-GRANT:
-- fn_is_internal_case_actor() — hanya cek role JWT pemanggil sendiri (no args).
-- Berbeda dari fn_user_is_internal_case_actor(uuid) yang tetap dikunci.
-- fn_matches_case_handler(role_type, uuid) — argumen dari row yang dievaluasi,
-- fungsi turunan berbasis JWT caller sendiri. Tidak ada oracle cross-tenant.

GRANT EXECUTE ON FUNCTION public.fn_is_internal_case_actor()              TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_matches_case_handler(role_type, uuid) TO authenticated;
