-- ============================================================
-- Migration 20260707130000: F2-A — View kolom terbatas users
--   untuk menutup over-exposure kolom sensitif via REST API langsung.
--
-- MASALAH (7 Juli 2026):
--   Policy rls_users_read_staff_names dan rls_users_read_staff
--   membatasi BARIS (school_id = fn_current_school_id()) tapi tidak
--   membatasi KOLOM. Client code disiplin (SELECT kolom spesifik),
--   TAPI siapapun dengan JWT valid (SISWA/ORTU) bisa:
--     GET /rest/v1/users?select=*
--   ...dan membaca: email, login_identifier (NIP/NIK), auth_user_id,
--   must_change_password, last_seen_ua, password_changed_at milik
--   semua staff/DUDI di sekolahnya.
--
-- SOLUSI:
--   CREATE VIEW v_users_staff_directory dengan kolom terbatas.
--   security_invoker=true → RLS tabel dasar tetap berlaku (filter
--   baris per-sekolah otomatis ikut), hanya kolom yang dikontrol di sini.
--
-- KOLOM YANG DISERTAKAN (safe untuk semua role):
--   user_id, school_id, full_name, role_type, dudi_org_name,
--   teacher_code, program_id, is_active
--
-- KOLOM YANG SENGAJA DIKECUALIKAN:
--   email               -- internal email, bukan untuk konsumsi client
--   login_identifier    -- NIP/NIK orang tua, data identitas sensitif
--   auth_user_id        -- UUID Supabase Auth internal
--   must_change_password, password_changed_at -- status keamanan internal
--   last_seen_at, last_seen_ua -- tracking sesi internal
--   kaprodi_program_id  -- foreign key internal
--   wali_kelas_class_id -- foreign key internal
--   is_bk, is_kepsek, is_waka_kurikulum, is_waka_kesiswaan, is_waka_humas
--                       -- flag jabatan internal (duplikat semantik role_type)
--   identifier_type     -- metadata auth internal
--   created_at, updated_at, deleted_at -- timestamp internal
--
-- TIDAK MENGUBAH policy rls_users_read_staff_names /
--   rls_users_read_staff — itu keputusan terpisah (apakah policy lama
--   dinon-aktifkan setelah client pindah ke view, atau dibiarkan
--   sebagai fallback) yang memerlukan diskusi dan update client code dulu.
--
-- ROLLBACK:
--   DROP VIEW IF EXISTS public.v_users_staff_directory;
-- ============================================================

CREATE OR REPLACE VIEW public.v_users_staff_directory AS
SELECT
    user_id,
    school_id,
    full_name,
    role_type,
    dudi_org_name,
    teacher_code,
    program_id,
    is_active
FROM public.users;

ALTER VIEW public.v_users_staff_directory SET (security_invoker = true);

GRANT SELECT ON public.v_users_staff_directory TO authenticated;
