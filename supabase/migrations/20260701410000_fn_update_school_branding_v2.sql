-- ============================================================
-- fn_update_school_branding v2 — tambah secondary_color
-- ============================================================

CREATE OR REPLACE FUNCTION fn_update_school_branding(
    p_name            TEXT,
    p_npsn            TEXT,
    p_address         TEXT,
    p_phone           TEXT,
    p_logo_url        TEXT,
    p_primary_color   TEXT,
    p_secondary_color TEXT DEFAULT ''
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_school_id UUID;
BEGIN
    SELECT u.school_id INTO v_school_id
    FROM users u
    WHERE u.auth_user_id = auth.uid()
      AND u.role_type = 'ADMINISTRATIVE'
    LIMIT 1;

    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'Akses ditolak: hanya ADMINISTRATIVE yang dapat mengubah branding sekolah.';
    END IF;

    IF p_primary_color IS NOT NULL AND p_primary_color <> ''
       AND p_primary_color NOT SIMILAR TO '#[0-9A-Fa-f]{6}' THEN
        RAISE EXCEPTION 'Format warna primer tidak valid. Gunakan format hex #RRGGBB.';
    END IF;

    IF p_secondary_color IS NOT NULL AND p_secondary_color <> ''
       AND p_secondary_color NOT SIMILAR TO '#[0-9A-Fa-f]{6}' THEN
        RAISE EXCEPTION 'Format warna sekunder tidak valid. Gunakan format hex #RRGGBB.';
    END IF;

    UPDATE schools
    SET
        name            = COALESCE(NULLIF(TRIM(p_name), ''), name),
        npsn            = NULLIF(TRIM(p_npsn), ''),
        address         = NULLIF(TRIM(p_address), ''),
        phone           = NULLIF(TRIM(p_phone), ''),
        logo_url        = NULLIF(TRIM(p_logo_url), ''),
        primary_color   = COALESCE(NULLIF(TRIM(p_primary_color), ''), primary_color),
        secondary_color = COALESCE(NULLIF(TRIM(p_secondary_color), ''), secondary_color)
    WHERE school_id = v_school_id;
END;
$$;

COMMENT ON FUNCTION fn_update_school_branding(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) IS
    'ADMINISTRATIVE dapat memperbarui profil & branding sekolah. v2: tambah secondary_color.';
