-- ============================================================
-- Migration 20260824100000: Sprint C — RPC SECURITY DEFINER
--   untuk panel admin DUDI, Stakeholder, dan TU.
--
-- MASALAH:
--   Kolom must_change_password di tabel users menyimpan informasi
--   apakah user masih memakai password default '12345678'. Jika
--   authenticated client langsung query tabel users, setiap guru
--   bisa membaca kolom ini untuk seluruh rekan se-tenant dan
--   mengenumerasi siapa saja yang belum ganti password.
--
-- SOLUSI:
--   2 RPC SECURITY DEFINER dengan guard role=ADMINISTRATIVE:
--   - fn_admin_panel_dudi(): data DUDI + must_change_password
--   - fn_admin_panel_staff(p_role_type): data STAKEHOLDER/TU +
--     must_change_password
--
--   Guard memverifikasi 4 kondisi:
--   (a) auth.uid() match ke baris users (auth_user_id)
--   (b) school_id = fn_current_school_id() (tenant isolation)
--   (c) role_type = 'ADMINISTRATIVE'
--   (d) deleted_at IS NULL (akun aktif)
--
--   REVOKE FROM PUBLIC diperlukan karena PostgreSQL grant EXECUTE
--   ke PUBLIC secara default saat fungsi dibuat. REVOKE FROM anon
--   saja tidak cukup -- authenticated masih inherit dari PUBLIC.
--   Urutan: REVOKE PUBLIC → GRANT authenticated (defense-in-depth).
--
--   Disetujui Romo sebagai bagian Sprint C (24 Agustus 2026).
-- ============================================================

BEGIN;

-- ── RPC 1: fn_admin_panel_dudi() ──────────────────────────────

DROP FUNCTION IF EXISTS fn_admin_panel_dudi();

CREATE OR REPLACE FUNCTION fn_admin_panel_dudi()
RETURNS TABLE (
    user_id              uuid,
    full_name            text,
    dudi_org_name        text,
    program_id           uuid,
    must_change_password bool
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    -- Guard: hanya ADMINISTRATIVE aktif di sekolah yang sama
    IF (SELECT role_type FROM public.users
        WHERE auth_user_id = auth.uid()
          AND school_id    = fn_current_school_id()
          AND role_type    = 'ADMINISTRATIVE'
          AND deleted_at   IS NULL
        LIMIT 1) IS NULL THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT u.user_id,
           u.full_name::text,
           u.dudi_org_name::text,
           u.program_id,
           u.must_change_password
    FROM public.users u
    WHERE u.school_id  = fn_current_school_id()
      AND u.role_type  = 'DUDI'
      AND u.deleted_at IS NULL
    ORDER BY u.dudi_org_name;
END;
$$;

GRANT  EXECUTE ON FUNCTION fn_admin_panel_dudi() TO authenticated;
REVOKE EXECUTE ON FUNCTION fn_admin_panel_dudi() FROM anon;
REVOKE EXECUTE ON FUNCTION fn_admin_panel_dudi() FROM PUBLIC;

-- ── RPC 2: fn_admin_panel_staff(p_role_type text) ─────────────

DROP FUNCTION IF EXISTS fn_admin_panel_staff(text);

CREATE OR REPLACE FUNCTION fn_admin_panel_staff(p_role_type text)
RETURNS TABLE (
    user_id              uuid,
    full_name            text,
    login_identifier     text,
    must_change_password bool
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    -- Validasi p_role_type (allowlist eksplisit)
    IF p_role_type NOT IN ('STAKEHOLDER', 'TU') THEN
        RAISE EXCEPTION 'invalid role_type' USING ERRCODE = '22023';
    END IF;

    -- Guard: hanya ADMINISTRATIVE aktif di sekolah yang sama
    IF (SELECT role_type FROM public.users
        WHERE auth_user_id = auth.uid()
          AND school_id    = fn_current_school_id()
          AND role_type    = 'ADMINISTRATIVE'
          AND deleted_at   IS NULL
        LIMIT 1) IS NULL THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT u.user_id,
           u.full_name::text,
           u.login_identifier::text,
           u.must_change_password
    FROM public.users u
    WHERE u.school_id  = fn_current_school_id()
      AND u.role_type  = p_role_type
      AND u.deleted_at IS NULL
    ORDER BY u.full_name;
END;
$$;

GRANT  EXECUTE ON FUNCTION fn_admin_panel_staff(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION fn_admin_panel_staff(text) FROM anon;
REVOKE EXECUTE ON FUNCTION fn_admin_panel_staff(text) FROM PUBLIC;

COMMIT;
