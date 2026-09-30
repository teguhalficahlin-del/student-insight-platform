-- ============================================================
-- Migration: 20260930120000_fix-admin-panel-staff-enum-cast.sql
--
-- BUG: fn_admin_panel_staff gagal dengan
--      "operator does not exist: role_type = text"
--      -> panel Stakeholder dan Tata Usaha di konsol admin blank.
--      PostgREST memetakan ERRCODE 42883 ke HTTP 404, sehingga di
--      konsol browser terlihat seperti RPC hilang padahal fungsinya
--      ada dan ter-deploy - hanya gagal saat dieksekusi.
--
-- SEBAB: kolom users.role_type bertipe enum `role_type`, sedangkan
--        parameter p_role_type bertipe text. PostgreSQL tidak punya
--        operator enum = text. Literal seperti 'ADMINISTRATIVE' di
--        blok guard lolos karena bertipe unknown dan dicor otomatis
--        ke enum; variabel bertipe text tidak mendapat perlakuan itu.
--        Itu sebabnya guard lewat tapi query utama jatuh.
--
-- FIX: cast eksplisit p_role_type::role_type. Aman tanpa syarat
--      karena allowlist di atasnya sudah membatasi nilai ke
--      'STAKEHOLDER' | 'TU' sebelum baris ini tercapai, keduanya
--      label enum yang sah - cast tidak akan pernah gagal.
--
-- Tanda tangan fungsi TIDAK berubah (text) -> tidak perlu DROP,
-- tidak ada jendela waktu fungsi hilang, tidak ada perubahan klien.
--
-- Referensi bug asal: 20260824100000_sprint-c-admin-panel-rpcs.sql:117
-- Preseden pola cast di repo ini: p_meeting_status::meeting_status
-- ============================================================

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
      AND u.role_type  = p_role_type::role_type
      AND u.deleted_at IS NULL
    ORDER BY u.full_name;
END;
$$;

GRANT  EXECUTE ON FUNCTION fn_admin_panel_staff(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION fn_admin_panel_staff(text) FROM anon;
REVOKE EXECUTE ON FUNCTION fn_admin_panel_staff(text) FROM PUBLIC;
