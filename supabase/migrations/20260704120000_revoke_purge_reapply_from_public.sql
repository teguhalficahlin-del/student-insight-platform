-- ============================================================
-- Migration 20260704120000: tutup eksposur RPC destruktif ke anon
--
-- Guard-rail tenant-isolation CHECK 2 menangkap dua fungsi
-- SECURITY DEFINER VOLATILE yang GRANT EXECUTE default-nya ke
-- PUBLIC (jadi anon + authenticated bisa panggil):
--
--   fn_purge_expired_student(uuid, uuid)
--       — MENGHAPUS PERMANEN siswa LULUS/KELUAR. Tidak memeriksa
--         identitas/peran pemanggil (hanya status siswa). Anon
--         dengan UUID valid bisa menghapus data → KRITIS.
--   fn_reapply_schedule_templates(text, semester, uuid)
--       — menghapus & membangun ulang sesi jadwal masa depan.
--
-- Keduanya HANYA dipanggil oleh edge function via service_role
-- (purge-expired-students, apply-schedule-templates?mode=reapply).
-- Maka: cabut dari PUBLIC/anon/authenticated, sisakan service_role.
-- (Regresi mig 20260704050000 & 20260704080000 yang lupa REVOKE.)
-- ============================================================

REVOKE ALL ON FUNCTION public.fn_purge_expired_student(uuid, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_purge_expired_student(uuid, uuid)
    TO service_role;

REVOKE ALL ON FUNCTION public.fn_reapply_schedule_templates(text, semester, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_reapply_schedule_templates(text, semester, uuid)
    TO service_role;
