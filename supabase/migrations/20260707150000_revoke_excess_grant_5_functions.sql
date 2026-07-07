-- Migration: 20260707150000_revoke_excess_grant_5_functions.sql
--
-- ALASAN: Lima fungsi ini memiliki grant EXECUTE terbuka ke anon dan/atau
-- authenticated, padahal tidak ada pemanggil langsung dari client code (0
-- hasil grep di *.js/*.ts untuk keempat fungsi case-helper; fn_current_academic_year
-- hanya dipanggil dari edge function via admin/service_role client).
-- Fungsi-fungsi ini dirancang sebagai helper INTERNAL yang dipanggil dari
-- dalam SECURITY DEFINER function lain (fn_can_see_case, fn_kepsek_monitoring,
-- dll.) atau dari policy RLS — bukan untuk dipanggil langsung dari client.
-- Khusus fn_matches_case_handler: berisiko oracle lintas-sekolah karena
-- memanggil fn_kaprodi_of_student/fn_wali_of_student yang tidak punya guard
-- school_id internal — jika dipanggil langsung dengan UUID student sekolah lain,
-- bisa mengkonfirmasi relasi DUDI/wali lintas-sekolah.
-- Keputusan: kunci ke service_role. Pemanggilan nested dari SECURITY DEFINER
-- function (yang sudah terkunci) tetap berjalan normal karena PostgreSQL
-- mengevaluasi EXECUTE privilege di konteks OWNER fungsi pemanggil, bukan
-- role pemanggil eksekutor.

-- fn_current_academic_year(uuid)
REVOKE EXECUTE ON FUNCTION public.fn_current_academic_year(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_current_academic_year(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_current_academic_year(uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_current_academic_year(uuid) TO service_role;

-- fn_is_internal_case_actor()
REVOKE EXECUTE ON FUNCTION public.fn_is_internal_case_actor() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_is_internal_case_actor() FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_is_internal_case_actor() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_is_internal_case_actor() TO service_role;

-- fn_is_schoolwide_observer()
REVOKE EXECUTE ON FUNCTION public.fn_is_schoolwide_observer() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_is_schoolwide_observer() FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_is_schoolwide_observer() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_is_schoolwide_observer() TO service_role;

-- fn_involved_in_case(uuid)
REVOKE EXECUTE ON FUNCTION public.fn_involved_in_case(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_involved_in_case(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_involved_in_case(uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_involved_in_case(uuid) TO service_role;

-- fn_matches_case_handler(role_type, uuid)
REVOKE EXECUTE ON FUNCTION public.fn_matches_case_handler(role_type, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_matches_case_handler(role_type, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_matches_case_handler(role_type, uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_matches_case_handler(role_type, uuid) TO service_role;
