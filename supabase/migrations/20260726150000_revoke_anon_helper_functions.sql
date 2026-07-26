-- =============================================================================
-- Migration: 20260726150000_revoke_anon_helper_functions.sql
-- Tujuan   : Tutup Fase 3 Finding 4 — cabut EXECUTE dari PUBLIC dan anon
--            untuk 24 fungsi SECURITY DEFINER yang tidak membutuhkan akses
--            pra-autentikasi (7 trigger functions + 17 RLS helper functions).
--
-- Referensi: Audit Fase 3 Finding 4 (12 Jul 2026) + verifikasi live 26 Jul 2026
--
-- Daftar 24 fungsi yang di-REVOKE:
--   TRIGGER (7):
--     fn_audit_log_delete, fn_auto_set_recorded_by, fn_auto_set_school_id,
--     fn_case_log_create_event, trg_close_enrollment_on_graduation,
--     trg_sync_student_name_to_user, trg_sync_user_name_to_student
--   RLS HELPER (17):
--     fn_can_see_student, fn_current_school_id, fn_current_student_id,
--     fn_current_user_id, fn_current_user_role, fn_dudi_supervises_student,
--     fn_is_bk, fn_is_kepsek, fn_is_waka_humas, fn_is_waka_kesiswaan,
--     fn_is_waka_kurikulum, fn_kaprodi_of_student, fn_kaprodi_program_id,
--     fn_student_is_on_pkl, fn_teaches_student, fn_wali_kelas_class_id,
--     fn_wali_of_student
--
-- SENGAJA DIKECUALIKAN (dipakai pra-autentikasi di halaman login):
--   fn_resolve_login_email(text, uuid) — login flow semua portal
--   fn_school_branding(text)           — branding halaman login
--   fn_maintenance_status()            — banner maintenance halaman login
--
-- Grant `authenticated` sudah eksplisit terpisah (dikonfirmasi via
-- information_schema.routine_privileges) — TIDAK ikut tercabut oleh REVOKE FROM PUBLIC.
--
-- ROLLBACK PLAN (jika diperlukan):
--   GRANT EXECUTE ON FUNCTION fn_audit_log_delete()                  TO PUBLIC, anon;
--   GRANT EXECUTE ON FUNCTION fn_auto_set_recorded_by()              TO PUBLIC, anon;
--   GRANT EXECUTE ON FUNCTION fn_auto_set_school_id()                TO PUBLIC, anon;
--   GRANT EXECUTE ON FUNCTION fn_case_log_create_event()             TO PUBLIC, anon;
--   GRANT EXECUTE ON FUNCTION trg_close_enrollment_on_graduation()   TO PUBLIC, anon;
--   GRANT EXECUTE ON FUNCTION trg_sync_student_name_to_user()        TO PUBLIC, anon;
--   GRANT EXECUTE ON FUNCTION trg_sync_user_name_to_student()        TO PUBLIC, anon;
--   GRANT EXECUTE ON FUNCTION fn_can_see_student(uuid)               TO PUBLIC, anon;
--   GRANT EXECUTE ON FUNCTION fn_current_school_id()                 TO PUBLIC, anon;
--   GRANT EXECUTE ON FUNCTION fn_current_student_id()                TO PUBLIC, anon;
--   GRANT EXECUTE ON FUNCTION fn_current_user_id()                   TO PUBLIC, anon;
--   GRANT EXECUTE ON FUNCTION fn_current_user_role()                 TO PUBLIC, anon;
--   GRANT EXECUTE ON FUNCTION fn_dudi_supervises_student(uuid)       TO PUBLIC, anon;
--   GRANT EXECUTE ON FUNCTION fn_is_bk()                             TO PUBLIC, anon;
--   GRANT EXECUTE ON FUNCTION fn_is_kepsek()                         TO PUBLIC, anon;
--   GRANT EXECUTE ON FUNCTION fn_is_waka_humas()                     TO PUBLIC, anon;
--   GRANT EXECUTE ON FUNCTION fn_is_waka_kesiswaan()                 TO PUBLIC, anon;
--   GRANT EXECUTE ON FUNCTION fn_is_waka_kurikulum()                 TO PUBLIC, anon;
--   GRANT EXECUTE ON FUNCTION fn_kaprodi_of_student(uuid)            TO PUBLIC, anon;
--   GRANT EXECUTE ON FUNCTION fn_kaprodi_program_id()                TO PUBLIC, anon;
--   GRANT EXECUTE ON FUNCTION fn_student_is_on_pkl(uuid)             TO PUBLIC, anon;
--   GRANT EXECUTE ON FUNCTION fn_teaches_student(uuid)               TO PUBLIC, anon;
--   GRANT EXECUTE ON FUNCTION fn_wali_kelas_class_id()               TO PUBLIC, anon;
--   GRANT EXECUTE ON FUNCTION fn_wali_of_student(uuid)               TO PUBLIC, anon;
-- =============================================================================

-- Trigger functions (7)
REVOKE EXECUTE ON FUNCTION public.fn_audit_log_delete()                FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_audit_log_delete()                FROM anon;

REVOKE EXECUTE ON FUNCTION public.fn_auto_set_recorded_by()            FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_auto_set_recorded_by()            FROM anon;

REVOKE EXECUTE ON FUNCTION public.fn_auto_set_school_id()              FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_auto_set_school_id()              FROM anon;

REVOKE EXECUTE ON FUNCTION public.fn_case_log_create_event()           FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_case_log_create_event()           FROM anon;

REVOKE EXECUTE ON FUNCTION public.trg_close_enrollment_on_graduation() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_close_enrollment_on_graduation() FROM anon;

REVOKE EXECUTE ON FUNCTION public.trg_sync_student_name_to_user()      FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_sync_student_name_to_user()      FROM anon;

REVOKE EXECUTE ON FUNCTION public.trg_sync_user_name_to_student()      FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_sync_user_name_to_student()      FROM anon;

-- RLS helper functions (17)
REVOKE EXECUTE ON FUNCTION public.fn_can_see_student(uuid)             FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_can_see_student(uuid)             FROM anon;

REVOKE EXECUTE ON FUNCTION public.fn_current_school_id()               FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_current_school_id()               FROM anon;

REVOKE EXECUTE ON FUNCTION public.fn_current_student_id()              FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_current_student_id()              FROM anon;

REVOKE EXECUTE ON FUNCTION public.fn_current_user_id()                 FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_current_user_id()                 FROM anon;

REVOKE EXECUTE ON FUNCTION public.fn_current_user_role()               FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_current_user_role()               FROM anon;

REVOKE EXECUTE ON FUNCTION public.fn_dudi_supervises_student(uuid)     FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_dudi_supervises_student(uuid)     FROM anon;

REVOKE EXECUTE ON FUNCTION public.fn_is_bk()                           FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_is_bk()                           FROM anon;

REVOKE EXECUTE ON FUNCTION public.fn_is_kepsek()                       FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_is_kepsek()                       FROM anon;

REVOKE EXECUTE ON FUNCTION public.fn_is_waka_humas()                   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_is_waka_humas()                   FROM anon;

REVOKE EXECUTE ON FUNCTION public.fn_is_waka_kesiswaan()               FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_is_waka_kesiswaan()               FROM anon;

REVOKE EXECUTE ON FUNCTION public.fn_is_waka_kurikulum()               FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_is_waka_kurikulum()               FROM anon;

REVOKE EXECUTE ON FUNCTION public.fn_kaprodi_of_student(uuid)          FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_kaprodi_of_student(uuid)          FROM anon;

REVOKE EXECUTE ON FUNCTION public.fn_kaprodi_program_id()              FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_kaprodi_program_id()              FROM anon;

REVOKE EXECUTE ON FUNCTION public.fn_student_is_on_pkl(uuid)           FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_student_is_on_pkl(uuid)           FROM anon;

REVOKE EXECUTE ON FUNCTION public.fn_teaches_student(uuid)             FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_teaches_student(uuid)             FROM anon;

REVOKE EXECUTE ON FUNCTION public.fn_wali_kelas_class_id()             FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_wali_kelas_class_id()             FROM anon;

REVOKE EXECUTE ON FUNCTION public.fn_wali_of_student(uuid)             FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_wali_of_student(uuid)             FROM anon;
