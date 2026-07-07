-- Migration: 20260707140000_revoke_fn_user_is_internal_case_actor.sql
--
-- TEMUAN: fn_user_is_internal_case_actor(uuid) bocor ke anon + authenticated.
-- Dampak terkonfirmasi via simulasi live: siswa sekolah A berhasil membaca
-- status jabatan guru sekolah B (cross-tenant role disclosure).
-- Keputusan: kunci total ke service_role — bukan tambah guard — karena tidak
-- ada use case legitimate yang teridentifikasi untuk anon/authenticated
-- memanggil fungsi ini secara langsung; semua pemanggil sah berjalan via
-- SECURITY DEFINER function lain yang sudah terkunci ke service_role.

REVOKE EXECUTE ON FUNCTION public.fn_user_is_internal_case_actor(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_user_is_internal_case_actor(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_user_is_internal_case_actor(uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_user_is_internal_case_actor(uuid) TO service_role;
