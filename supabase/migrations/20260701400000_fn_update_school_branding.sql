-- ============================================================
-- Edit Branding Sekolah — RPC SECURITY DEFINER
-- Admin portal (role ADMINISTRATIVE) boleh update nama, logo,
-- warna, alamat, telepon, NPSN untuk sekolahnya sendiri.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_update_school_branding(
    p_name          TEXT,
    p_npsn          TEXT,
    p_address       TEXT,
    p_phone         TEXT,
    p_logo_url      TEXT,
    p_primary_color TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_school_id UUID;
BEGIN
    -- Pastikan pemanggil adalah ADMINISTRATIVE
    SELECT u.school_id INTO v_school_id
    FROM users u
    WHERE u.auth_user_id = auth.uid()
      AND u.role_type = 'ADMINISTRATIVE'
    LIMIT 1;

    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'Akses ditolak: hanya ADMINISTRATIVE yang dapat mengubah branding sekolah.';
    END IF;

    -- Validasi warna hex (#RRGGBB)
    IF p_primary_color IS NOT NULL AND p_primary_color NOT SIMILAR TO '#[0-9A-Fa-f]{6}' THEN
        RAISE EXCEPTION 'Format warna tidak valid. Gunakan format hex #RRGGBB.';
    END IF;

    UPDATE schools
    SET
        name          = COALESCE(NULLIF(TRIM(p_name), ''), name),
        npsn          = NULLIF(TRIM(p_npsn), ''),
        address       = NULLIF(TRIM(p_address), ''),
        phone         = NULLIF(TRIM(p_phone), ''),
        logo_url      = NULLIF(TRIM(p_logo_url), ''),
        primary_color = COALESCE(NULLIF(TRIM(p_primary_color), ''), primary_color)
    WHERE school_id = v_school_id;
END;
$$;

COMMENT ON FUNCTION fn_update_school_branding IS
    'ADMINISTRATIVE dapat memperbarui profil sekolah (nama, NPSN, alamat, telepon, logo, warna primer). SECURITY DEFINER — bypass RLS schools yang read-only untuk portal.';
