-- ============================================================
-- Migration 20260726120000: Tambahkan allow_parallel_teaching ke view
--   v_users_staff_directory.
--
-- MASALAH:
--   Migration 20260715020000 menambahkan kolom allow_parallel_teaching
--   ke tabel users, tapi view v_users_staff_directory tidak diperbarui.
--   Akibatnya admin/js/schedule-builder.js masih query tabel users
--   langsung untuk kolom ini (3 titik: baris 64, 168, 575).
--
-- SOLUSI:
--   CREATE OR REPLACE VIEW dengan allow_parallel_teaching ditambahkan
--   di akhir daftar kolom (urutan dan tipe kolom existing tidak berubah).
--
-- KOLOM YANG DISERTAKAN (setelah update — 9 kolom):
--   user_id, school_id, full_name, role_type, dudi_org_name,
--   teacher_code, program_id, is_active, allow_parallel_teaching
--
-- PERTIMBANGAN KEAMANAN:
--   allow_parallel_teaching adalah flag boolean operasional (bukan PII,
--   bukan data sensitif). Aman diekspos ke semua role authenticated
--   via view.
--
-- ROLLBACK:
--   CREATE OR REPLACE VIEW public.v_users_staff_directory AS
--   SELECT user_id, school_id, full_name, role_type, dudi_org_name,
--          teacher_code, program_id, is_active
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
    allow_parallel_teaching
FROM public.users;

ALTER VIEW public.v_users_staff_directory SET (security_invoker = true);

GRANT SELECT ON public.v_users_staff_directory TO authenticated;

COMMIT;
