-- ============================================================
-- Migration 20260824090000: Tambahkan deleted_at ke view
--   v_users_staff_directory.
--
-- MASALAH:
--   5 call-site (admin/js/api.js:823 getDeletedUsers, dan
--   admin/js/dashboard.js 507/510/511/512 count staf/DUDI/
--   STAKEHOLDER/TU) masih query tabel users langsung karena
--   butuh kolom deleted_at untuk mempertahankan semantik
--   soft-delete. View belum meng-expose kolom itu.
--
-- SOLUSI:
--   CREATE OR REPLACE VIEW dengan deleted_at ditambahkan
--   di akhir daftar kolom (urutan dan tipe 10 kolom existing
--   tidak berubah -- syarat CREATE OR REPLACE VIEW PostgreSQL).
--
-- KOLOM SESUDAH (11 kolom):
--   user_id, school_id, full_name, role_type, dudi_org_name,
--   teacher_code, program_id, is_active, allow_parallel_teaching,
--   login_identifier, deleted_at
--
-- PERTIMBANGAN KEAMANAN:
--   deleted_at adalah timestamp internal soft-delete -- bukan PII,
--   bukan kredensial, tidak memberi jalur eskalasi. View pakai
--   security_invoker=true sehingga RLS tabel users tetap berlaku
--   dan hanya baris sesuai school_id tenant yang terlihat.
--   Disetujui Romo sebagai bagian Sprint B (24 Agustus 2026).
--
-- ROLLBACK:
--   CREATE OR REPLACE VIEW public.v_users_staff_directory AS
--   SELECT user_id, school_id, full_name, role_type, dudi_org_name,
--          teacher_code, program_id, is_active, allow_parallel_teaching,
--          login_identifier
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
    login_identifier,
    deleted_at
FROM public.users;

ALTER VIEW public.v_users_staff_directory SET (security_invoker = true);

GRANT SELECT ON public.v_users_staff_directory TO authenticated;

COMMIT;
