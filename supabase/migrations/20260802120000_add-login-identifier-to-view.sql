-- ============================================================
-- Migration 20260802120000: Tambahkan login_identifier ke view
--   v_users_staff_directory.
--
-- MASALAH:
--   Kolom login_identifier ada di tabel users (character varying)
--   tapi tidak di-expose oleh v_users_staff_directory.
--   Akibatnya listSchoolAdmins() di guru/js/api.js tidak bisa
--   mengambil login_identifier untuk ditampilkan di tab Kepsek.
--
-- SOLUSI:
--   CREATE OR REPLACE VIEW dengan login_identifier ditambahkan
--   di akhir daftar kolom (urutan dan tipe kolom existing tidak berubah).
--
-- KOLOM YANG DISERTAKAN (setelah update — 10 kolom):
--   user_id, school_id, full_name, role_type, dudi_org_name,
--   teacher_code, program_id, is_active, allow_parallel_teaching,
--   login_identifier
--
-- PERTIMBANGAN KEAMANAN:
--   login_identifier berisi NIP/NIK/nomor HP admin sekolah.
--   View pakai security_invoker=true — RLS tabel users tetap berlaku,
--   sehingga hanya baris sesuai school_id tenant yang terlihat.
--   Kolom ini diperlukan untuk fitur Kelola Admin di tab Kepsek.
--
-- ROLLBACK:
--   CREATE OR REPLACE VIEW public.v_users_staff_directory AS
--   SELECT user_id, school_id, full_name, role_type, dudi_org_name,
--          teacher_code, program_id, is_active, allow_parallel_teaching
--   FROM public.users;
--   ALTER VIEW public.v_users_staff_directory SET (security_invoker = true);
-- ============================================================

BEGIN;

CREATE OR REPLACE VIEW public.v_users_staff_directory AS
SELECT
    user_id,
    school_id,
    full_name,
    role_type,
    dudi_org_name,
    teacher_code,
    program_id,
    is_active,
    allow_parallel_teaching,
    login_identifier
FROM public.users;

ALTER VIEW public.v_users_staff_directory SET (security_invoker = true);

GRANT SELECT ON public.v_users_staff_directory TO authenticated;

COMMIT;
