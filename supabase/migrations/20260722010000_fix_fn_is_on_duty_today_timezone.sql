-- fix: fn_is_on_duty_today() gunakan timezone Asia/Jakarta
-- Root cause: EXTRACT(ISODOW FROM NOW()) pakai UTC, bukan WIB.
-- Akibat: 00:00–06:59 WIB setiap hari fungsi mengembalikan hari sebelumnya.
CREATE OR REPLACE FUNCTION fn_is_on_duty_today()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM duty_schedules ds
        WHERE ds.user_id     = fn_current_user_id()
          AND ds.school_id   = fn_current_school_id()
          AND ds.day_of_week = (
              CASE EXTRACT(ISODOW FROM NOW() AT TIME ZONE 'Asia/Jakarta')::int
                  WHEN 1 THEN 'SENIN'
                  WHEN 2 THEN 'SELASA'
                  WHEN 3 THEN 'RABU'
                  WHEN 4 THEN 'KAMIS'
                  WHEN 5 THEN 'JUMAT'
                  WHEN 6 THEN 'SABTU'
                  WHEN 7 THEN 'MINGGU'
              END
          )::day_of_week
          AND ds.is_active = TRUE
    );
$$;
