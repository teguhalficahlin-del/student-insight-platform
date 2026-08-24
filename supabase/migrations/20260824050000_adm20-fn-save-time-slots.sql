-- ADM-20: Buat RPC fn_save_time_slots untuk menggantikan DELETE+INSERT sequential
-- di saveTimeSlots() client-side (admin/js/api.js).
-- Menjalankan DELETE dan INSERT dalam satu transaksi PostgreSQL untuk atomicity.
-- school_id diambil dari fn_current_school_id() — tidak perlu parameter eksternal
-- sehingga DELETE tidak bisa menyentuh slot sekolah lain.

DROP FUNCTION IF EXISTS fn_save_time_slots(TEXT, semester, day_of_week, JSONB);

CREATE OR REPLACE FUNCTION fn_save_time_slots(
    p_academic_year TEXT,
    p_semester      semester,
    p_day_of_week   day_of_week,
    p_slots         JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_school_id UUID;
    v_role      TEXT;
    v_slot      JSONB;
    v_idx       INTEGER := 0;
BEGIN
    v_school_id := fn_current_school_id();
    v_role      := fn_current_user_role();

    IF v_role != 'ADMINISTRATIVE' THEN
        RAISE EXCEPTION 'Tidak diizinkan: hanya ADMINISTRATIVE yang dapat menyimpan time slots'
            USING ERRCODE = '42501';
    END IF;

    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'school_id tidak terdeteksi untuk user ini'
            USING ERRCODE = '42501';
    END IF;

    -- Hapus slot lama untuk tahun ajaran, semester, hari, dan sekolah ini
    DELETE FROM schedule_time_slots
    WHERE academic_year = p_academic_year
      AND semester      = p_semester
      AND day_of_week   = p_day_of_week
      AND school_id     = v_school_id;

    -- Insert slot baru jika ada
    IF jsonb_array_length(p_slots) > 0 THEN
        FOR v_slot IN SELECT * FROM jsonb_array_elements(p_slots) LOOP
            v_idx := v_idx + 1;
            INSERT INTO schedule_time_slots (
                academic_year, semester, day_of_week, school_id,
                slot_number, start_time, end_time, is_break, break_label
            ) VALUES (
                p_academic_year,
                p_semester,
                p_day_of_week,
                v_school_id,
                (v_slot->>'slot_number')::INTEGER,
                (v_slot->>'start_time')::TIME,
                (v_slot->>'end_time')::TIME,
                COALESCE((v_slot->>'is_break')::BOOLEAN, FALSE),
                NULLIF(v_slot->>'break_label', '')
            );
        END LOOP;
    END IF;
END;
$$;

GRANT  EXECUTE ON FUNCTION fn_save_time_slots(TEXT, semester, day_of_week, JSONB) TO authenticated;
GRANT  EXECUTE ON FUNCTION fn_save_time_slots(TEXT, semester, day_of_week, JSONB) TO service_role;
REVOKE EXECUTE ON FUNCTION fn_save_time_slots(TEXT, semester, day_of_week, JSONB) FROM anon;
REVOKE EXECUTE ON FUNCTION fn_save_time_slots(TEXT, semester, day_of_week, JSONB) FROM PUBLIC;
