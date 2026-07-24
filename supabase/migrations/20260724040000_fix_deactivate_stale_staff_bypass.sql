-- Migration: 20260724040000_fix_deactivate_stale_staff_bypass
--
-- Bug: fn_deactivate_stale_staff() gagal karena trigger
-- trg_guard_users_protected_columns memblokir UPDATE users.is_active.
-- Trigger bukan SECURITY DEFINER sehingga berjalan sebagai current_user
-- (authenticated/KEPSEK), bukan postgres — bypass 1 dan 2 tidak aktif.
--
-- Fix: tambah set_config('app.bypass_users_guard', 'on', true) sebelum
-- UPDATE, identik dengan pola fn_confirm_password_changed(). Parameter
-- ketiga true = LOCAL, reset otomatis di akhir transaksi.

CREATE OR REPLACE FUNCTION fn_deactivate_stale_staff()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = public
AS $$
DECLARE
    v_count integer;
    v_sid   uuid := fn_current_school_id();
BEGIN
    IF NOT (fn_is_kepsek() OR fn_current_user_role() = 'ADMINISTRATIVE') THEN
        RAISE EXCEPTION 'akses ditolak: hanya admin/kepsek'
            USING ERRCODE = '42501';
    END IF;

    -- Bypass trigger trg_guard_users_protected_columns agar is_active
    -- bisa diubah. Flag LOCAL: reset otomatis akhir transaksi.
    PERFORM set_config('app.bypass_users_guard', 'on', true);

    WITH stale AS (
        SELECT user_id FROM fn_get_stale_staff()
    )
    UPDATE users
       SET is_active = FALSE
     WHERE user_id IN (SELECT user_id FROM stale)
       AND school_id = v_sid;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION fn_deactivate_stale_staff() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_deactivate_stale_staff() FROM anon;
