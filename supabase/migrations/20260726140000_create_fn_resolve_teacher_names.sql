-- ============================================================
-- Migration 20260726140000: fn_resolve_teacher_names
--   SECURITY DEFINER RPC untuk menggantikan 3 query langsung ke
--   tabel users di guru/js/api.js (baris 1517, 1565, 1626).
--
-- MASALAH (audit B2, 26 Jul 2026):
--   Tiga fungsi resolve nama guru (getWakaKepsekPendingDocs,
--   getWakaApprovalHistory, getDisahkanWakaDocs) query
--   .from('users').select('auth_user_id, full_name').in(...)
--   langsung ke tabel users. view v_users_staff_directory tidak
--   expose auth_user_id (sengaja dikecualikan — UUID internal
--   Supabase Auth), sehingga tidak bisa diganti ke view.
--
-- SOLUSI (Opsi C):
--   RPC SECURITY DEFINER yang menerima array auth_user_id dan
--   mengembalikan pasangan (auth_user_id, full_name), dengan
--   guard cross-tenant via fn_current_school_id().
--
-- RETURN SHAPE (identik dengan query lama):
--   auth_user_id uuid, full_name text
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS fn_resolve_teacher_names(uuid[]);
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_resolve_teacher_names(p_auth_ids uuid[])
RETURNS TABLE(auth_user_id uuid, full_name text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT auth_user_id, full_name
    FROM public.users
    WHERE auth_user_id = ANY(p_auth_ids)
      AND school_id = fn_current_school_id();
$$;

REVOKE EXECUTE ON FUNCTION public.fn_resolve_teacher_names(uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_resolve_teacher_names(uuid[]) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_resolve_teacher_names(uuid[]) TO authenticated;

COMMIT;
