-- ADM-21: Buat RPC fn_save_schedule_templates untuk menggantikan DELETE+chunked INSERT
-- di saveScheduleTemplates() client-side (admin/js/api.js).
-- Menjalankan DELETE dan INSERT dalam satu transaksi PostgreSQL untuk atomicity.
-- school_id diambil dari fn_current_school_id() agar tidak menyentuh data sekolah lain.

DROP FUNCTION IF EXISTS fn_save_schedule_templates(TEXT, semester, day_of_week, JSONB);

CREATE OR REPLACE FUNCTION fn_save_schedule_templates(
    p_academic_year TEXT,
    p_semester      semester,
    p_day_of_week   day_of_week,
    p_templates     JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_school_id UUID;
    v_role      TEXT;
    v_tpl       JSONB;
BEGIN
    v_school_id := fn_current_school_id();
    v_role      := fn_current_user_role();

    IF v_role != 'ADMINISTRATIVE' THEN
        RAISE EXCEPTION 'Tidak diizinkan: hanya ADMINISTRATIVE yang dapat menyimpan schedule templates'
            USING ERRCODE = '42501';
    END IF;

    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'school_id tidak terdeteksi untuk user ini'
            USING ERRCODE = '42501';
    END IF;

    -- Hapus template lama untuk tahun ajaran, semester, hari, dan sekolah ini
    DELETE FROM schedule_templates
    WHERE academic_year = p_academic_year
      AND semester      = p_semester
      AND day_of_week   = p_day_of_week
      AND school_id     = v_school_id;

    -- Insert template baru jika ada
    IF jsonb_array_length(p_templates) > 0 THEN
        FOR v_tpl IN SELECT * FROM jsonb_array_elements(p_templates) LOOP
            INSERT INTO schedule_templates (
                academic_year, semester, day_of_week, school_id,
                start_time, end_time, class_id, teacher_id, subject_label
            ) VALUES (
                p_academic_year,
                p_semester,
                p_day_of_week,
                v_school_id,
                (v_tpl->>'start_time')::TIME,
                (v_tpl->>'end_time')::TIME,
                (v_tpl->>'class_id')::UUID,
                (v_tpl->>'teacher_id')::UUID,
                NULLIF(v_tpl->>'subject_label', '')
            );
        END LOOP;
    END IF;
END;
$$;

GRANT  EXECUTE ON FUNCTION fn_save_schedule_templates(TEXT, semester, day_of_week, JSONB) TO authenticated;
GRANT  EXECUTE ON FUNCTION fn_save_schedule_templates(TEXT, semester, day_of_week, JSONB) TO service_role;
REVOKE EXECUTE ON FUNCTION fn_save_schedule_templates(TEXT, semester, day_of_week, JSONB) FROM anon;
REVOKE EXECUTE ON FUNCTION fn_save_schedule_templates(TEXT, semester, day_of_week, JSONB) FROM PUBLIC;
