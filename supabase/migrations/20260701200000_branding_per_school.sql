ALTER TABLE schools ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS secondary_color TEXT NOT NULL DEFAULT '#1e40af';

UPDATE schools
SET slug = 'smkhr'
WHERE school_id = '00000000-0000-0000-0000-000000000001' AND slug IS NULL;

CREATE OR REPLACE FUNCTION fn_school_branding(p_slug text)
RETURNS TABLE(school_id uuid, name text, logo_url text, primary_color text, secondary_color text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    SELECT school_id, name, logo_url, primary_color, secondary_color
    FROM schools
    WHERE slug = p_slug AND is_active = true
    LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION fn_school_branding(text) TO anon;
GRANT EXECUTE ON FUNCTION fn_school_branding(text) TO authenticated;
