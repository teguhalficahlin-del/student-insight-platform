CREATE OR REPLACE FUNCTION fn_close_semester(
    p_period_id  UUID,
    p_config_id  UUID,
    p_semester   TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Validasi school_id: period harus milik sekolah caller
    IF NOT EXISTS (
        SELECT 1 FROM academic_periods
        WHERE id = p_period_id
          AND school_id = fn_current_school_id()
    ) THEN
        RAISE EXCEPTION 'domain_invariant_violation: period tidak ditemukan di sekolah ini';
    END IF;

    -- UPDATE #1: tutup semester
    UPDATE academic_periods
    SET status            = 'CLOSED',
        closed_at         = now(),
        closed_by_user_id = auth.uid()
    WHERE id        = p_period_id
      AND school_id = fn_current_school_id();

    -- UPDATE #2: jika semester 1, update current_semester ke '2'
    IF p_semester = '1' THEN
        UPDATE school_config
        SET current_semester = '2'
        WHERE config_id = p_config_id
          AND school_id = fn_current_school_id();
    END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION fn_close_semester(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_close_semester(UUID, UUID, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION fn_close_semester(UUID, UUID, TEXT) TO authenticated;
