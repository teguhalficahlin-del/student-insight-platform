-- Admin portal hardening:
-- * reject inactive/deleted administrators at the SECURITY DEFINER boundary;
-- * make an empty secondary color a deterministic darker variant of primary.

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
    SELECT u.school_id INTO v_school_id
    FROM users u
    WHERE u.auth_user_id = auth.uid()
      AND u.role_type = 'ADMINISTRATIVE'
      AND u.is_active IS TRUE
      AND u.deleted_at IS NULL
    LIMIT 1;

    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'Akses ditolak: hanya ADMINISTRATIVE aktif yang dapat mengubah branding sekolah.';
    END IF;

    IF NULLIF(TRIM(p_primary_color), '') IS NOT NULL
       AND TRIM(p_primary_color) NOT SIMILAR TO '#[0-9A-Fa-f]{6}' THEN
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
    v_primary_color TEXT;
    v_secondary_color TEXT;
BEGIN
    SELECT u.school_id INTO v_school_id
    FROM users u
    WHERE u.auth_user_id = auth.uid()
      AND u.role_type = 'ADMINISTRATIVE'
      AND u.is_active IS TRUE
      AND u.deleted_at IS NULL
    LIMIT 1;

    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'Akses ditolak: hanya ADMINISTRATIVE aktif yang dapat mengubah branding sekolah.';
    END IF;

    IF NULLIF(TRIM(p_primary_color), '') IS NOT NULL
       AND TRIM(p_primary_color) NOT SIMILAR TO '#[0-9A-Fa-f]{6}' THEN
        RAISE EXCEPTION 'Format warna primer tidak valid. Gunakan format hex #RRGGBB.';
    END IF;

    IF NULLIF(TRIM(p_secondary_color), '') IS NOT NULL
       AND TRIM(p_secondary_color) NOT SIMILAR TO '#[0-9A-Fa-f]{6}' THEN
        RAISE EXCEPTION 'Format warna sekunder tidak valid. Gunakan format hex #RRGGBB.';
    END IF;

    SELECT COALESCE(NULLIF(TRIM(p_primary_color), ''), s.primary_color, '#1a56db')
      INTO v_primary_color
    FROM schools s
    WHERE s.school_id = v_school_id;

    v_secondary_color := NULLIF(TRIM(p_secondary_color), '');
    IF v_secondary_color IS NULL THEN
        v_secondary_color := '#'
            || lpad(to_hex(floor(get_byte(decode(substr(v_primary_color, 2), 'hex'), 0) * 0.8)::INT), 2, '0')
            || lpad(to_hex(floor(get_byte(decode(substr(v_primary_color, 2), 'hex'), 1) * 0.8)::INT), 2, '0')
            || lpad(to_hex(floor(get_byte(decode(substr(v_primary_color, 2), 'hex'), 2) * 0.8)::INT), 2, '0');
    END IF;

    UPDATE schools
    SET
        name            = COALESCE(NULLIF(TRIM(p_name), ''), name),
        npsn            = NULLIF(TRIM(p_npsn), ''),
        address         = NULLIF(TRIM(p_address), ''),
        phone           = NULLIF(TRIM(p_phone), ''),
        logo_url        = NULLIF(TRIM(p_logo_url), ''),
        primary_color   = COALESCE(NULLIF(TRIM(p_primary_color), ''), primary_color),
        secondary_color = v_secondary_color
    WHERE school_id = v_school_id;
END;
$$;

COMMENT ON FUNCTION fn_update_school_branding(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) IS
    'ADMINISTRATIVE aktif dapat memperbarui profil sekolah.';

COMMENT ON FUNCTION fn_update_school_branding(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) IS
    'ADMINISTRATIVE aktif dapat memperbarui profil & branding sekolah; warna sekunder kosong diturunkan dari primer.';
