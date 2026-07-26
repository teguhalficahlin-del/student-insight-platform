-- ============================================================
-- Migration 20260726130000: fn_get_user_forum_scope
--   SECURITY DEFINER RPC untuk menggantikan query langsung ke
--   tabel users di getForumClasses() (guru/js/api.js:1117-1120).
--
-- MASALAH (audit B1, 26 Jul 2026):
--   getForumClasses() query kolom-kolom jabatan internal
--   (wali_kelas_class_id, kaprodi_program_id, is_waka_kesiswaan,
--    is_kepsek) milik user lain via REST langsung ke tabel users.
--   Kolom-kolom ini sengaja dikecualikan dari v_users_staff_directory
--   karena bersifat internal — tapi saat ini masih terbaca via
--   policy rls_users_read_staff yang hanya filter baris, bukan kolom.
--
-- SOLUSI:
--   RPC SECURITY DEFINER yang:
--   1. Hanya kembalikan 6 kolom yang dibutuhkan (tidak lebih)
--   2. Guard cross-tenant: AND school_id = fn_current_school_id()
--      → p_user_id dari tenant lain → 0 row (null)
--   3. REVOKE dari anon + PUBLIC — hanya authenticated yang boleh call
--
-- RETURN SHAPE (identik dengan query lama — tidak perlu ubah caller):
--   wali_kelas_class_id uuid, role_type text, program_id uuid,
--   kaprodi_program_id uuid, is_waka_kesiswaan boolean, is_kepsek boolean
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS fn_get_user_forum_scope(uuid);
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_get_user_forum_scope(p_user_id uuid)
RETURNS TABLE (
    wali_kelas_class_id  uuid,
    role_type            text,
    program_id           uuid,
    kaprodi_program_id   uuid,
    is_waka_kesiswaan    boolean,
    is_kepsek            boolean
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        wali_kelas_class_id,
        role_type,
        program_id,
        kaprodi_program_id,
        is_waka_kesiswaan,
        is_kepsek
    FROM public.users
    WHERE user_id  = p_user_id
      AND school_id = fn_current_school_id()
    LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_get_user_forum_scope(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_get_user_forum_scope(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_get_user_forum_scope(uuid) TO authenticated;

COMMIT;
