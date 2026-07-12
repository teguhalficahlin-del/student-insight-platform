-- Fix: fn_is_schoolwide_observer tidak menyertakan WAKA_KURIKULUM.
-- Root cause: migration sebelumnya menimpa fungsi ini tanpa WAKA_KURIKULUM.
-- Verified live: prosrc hanya mengandung BK, KEPSEK, WAKA_KESISWAAN.

CREATE OR REPLACE FUNCTION fn_is_schoolwide_observer()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM users u
        WHERE u.auth_user_id = auth.uid()
          AND ( u.role_type IN ('BK','KEPSEK','WAKA_KURIKULUM','WAKA_KESISWAAN')
                OR u.is_bk OR u.is_kepsek OR u.is_waka_kurikulum OR u.is_waka_kesiswaan )
    );
$$;
