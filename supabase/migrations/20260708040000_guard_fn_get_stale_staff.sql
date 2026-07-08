-- Migration: 20260708040000_guard_fn_get_stale_staff.sql
--
-- LATAR BELAKANG:
-- fn_get_stale_staff() mengembalikan login_identifier (NIP) guru dan dapat
-- dipanggil oleh SEMUA authenticated tanpa guard role — ditemukan saat scan
-- sistemik SECURITY DEFINER (8 Juli 2026). Data sensitif ini sengaja
-- dikecualikan dari v_users_staff_directory, tapi bocor lewat RPC ini.
-- Hanya dipanggil dari admin/js/api.js:1050 (portal admin), tapi grant EXECUTE
-- terbuka ke semua authenticated. fn_deactivate_stale_staff (yang memanggil
-- fungsi ini) sudah punya guard KEPSEK/ADMINISTRATIVE — fn_get_stale_staff
-- sendiri tidak, meski sama-sama sensitif.
--
-- FIX: Tambah guard identik dengan fn_deactivate_stale_staff. Konversi dari
-- LANGUAGE sql ke plpgsql agar bisa pakai IF/RAISE. Body SELECT identik dengan
-- definisi live (verified 8 Juli 2026, TARGET 1). Tidak ada perubahan pemanggil.
-- fn_deactivate_stale_staff tetap berjalan normal: guard baru di fn_get_stale_staff
-- akan pass karena fn_deactivate_stale_staff sudah memvalidasi KEPSEK/ADMINISTRATIVE
-- sebelum memanggil fn_get_stale_staff.

CREATE OR REPLACE FUNCTION public.fn_get_stale_staff()
RETURNS TABLE(user_id uuid, full_name text, login_identifier text, teacher_code text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    IF NOT (fn_is_kepsek() OR fn_current_user_role() = 'ADMINISTRATIVE') THEN
        RAISE EXCEPTION 'akses ditolak: hanya admin/kepsek'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT u.user_id, u.full_name::text, u.login_identifier::text, u.teacher_code::text
    FROM   users u
    JOIN   school_config sc ON sc.school_id = fn_current_school_id()
    WHERE  u.school_id   = fn_current_school_id()
    AND    u.is_active   = TRUE
    AND    u.role_type   = 'GURU'
    AND    u.is_kepsek          IS NOT TRUE
    AND    u.is_bk              IS NOT TRUE
    AND    u.is_waka_kurikulum  IS NOT TRUE
    AND    u.is_waka_kesiswaan  IS NOT TRUE
    AND    u.is_waka_humas      IS NOT TRUE
    AND    u.wali_kelas_class_id IS NULL
    AND    u.kaprodi_program_id  IS NULL
    AND NOT EXISTS (
        SELECT 1 FROM teaching_assignments ta
        WHERE  ta.user_id       = u.user_id
        AND    ta.school_id     = fn_current_school_id()
        AND    ta.academic_year = sc.current_academic_year
    )
    ORDER BY u.full_name;
END;
$$;
