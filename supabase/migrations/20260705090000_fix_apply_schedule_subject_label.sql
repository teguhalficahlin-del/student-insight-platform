-- ============================================================
-- FIX: fn_apply_schedule_templates — resolve subject_label
--
-- Masalah: fungsi sebelumnya selalu memakai subject KBM untuk
-- semua sesi, mengabaikan subject_label di schedule_templates.
--
-- Solusi: untuk setiap baris template, lookup subject berdasarkan
-- subject_label vs subjects.code (case-insensitive, scoped per sekolah).
-- Jika tidak ditemukan → fallback ke KBM (tetap aman).
--
-- fn_reapply_schedule_templates memanggil fn_apply_schedule_templates
-- sehingga fix ini berlaku untuk keduanya.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_apply_schedule_templates(
    p_academic_year text, p_semester semester, p_school_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_kbm_id    uuid;
    v_start     date;
    v_end       date;
    v_templates integer;
    v_assigns   integer;
    v_schedules integer;
BEGIN
    SELECT count(*) INTO v_templates
    FROM schedule_templates
    WHERE academic_year = p_academic_year AND semester = p_semester
      AND school_id = p_school_id;

    IF v_templates = 0 THEN
        RETURN jsonb_build_object('templates_found', 0, 'assignments_upserted', 0, 'schedules_generated', 0);
    END IF;

    SELECT start_date, end_date INTO v_start, v_end
    FROM academic_periods
    WHERE academic_year = p_academic_year AND semester = p_semester
      AND school_id = p_school_id;

    IF v_start IS NULL THEN
        RAISE EXCEPTION 'Periode akademik % semester % belum terdaftar', p_academic_year, p_semester;
    END IF;

    -- Pastikan KBM ada sebagai fallback
    SELECT subject_id INTO v_kbm_id
    FROM subjects WHERE code = 'KBM' AND school_id = p_school_id;
    IF v_kbm_id IS NULL THEN
        INSERT INTO subjects (code, name, is_active, school_id)
        VALUES ('KBM', 'Kegiatan Belajar Mengajar', true, p_school_id)
        RETURNING subject_id INTO v_kbm_id;
    END IF;

    -- Teaching assignments: satu baris per (guru, kelas, mapel)
    -- subject_label di-resolve ke subjects.code (case-insensitive).
    -- Jika tidak cocok → pakai KBM.
    INSERT INTO teaching_assignments
        (user_id, class_id, subject_id, academic_year, semester, is_active, school_id)
    SELECT DISTINCT
        t.teacher_id,
        t.class_id,
        COALESCE(s.subject_id, v_kbm_id),
        p_academic_year,
        p_semester,
        true,
        p_school_id
    FROM schedule_templates t
    LEFT JOIN subjects s
           ON s.school_id = p_school_id
          AND s.is_active = true
          AND t.subject_label IS NOT NULL
          AND UPPER(s.code) = UPPER(t.subject_label)
    WHERE t.academic_year = p_academic_year
      AND t.semester      = p_semester
      AND t.school_id     = p_school_id
    ON CONFLICT (user_id, class_id, subject_id, academic_year, semester)
    DO UPDATE SET is_active = true;
    GET DIAGNOSTICS v_assigns = ROW_COUNT;

    -- Sesi harian: gunakan subject_id yang sudah di-resolve per template
    INSERT INTO teaching_schedules
        (assignment_id, class_id, subject_id, scheduled_teacher_id,
         session_date, session_start, session_end,
         academic_year, semester, meeting_status, teacher_indicator, school_id)
    SELECT
        a.assignment_id,
        t.class_id,
        COALESCE(s.subject_id, v_kbm_id),
        t.teacher_id,
        gs.d::date,
        t.start_time,
        t.end_time,
        p_academic_year,
        p_semester,
        'NORMAL'::meeting_status,
        'PENDING_EVALUATION'::teacher_attendance_indicator,
        p_school_id
    FROM schedule_templates t
    LEFT JOIN subjects s
           ON s.school_id = p_school_id
          AND s.is_active = true
          AND t.subject_label IS NOT NULL
          AND UPPER(s.code) = UPPER(t.subject_label)
    JOIN teaching_assignments a
      ON a.user_id       = t.teacher_id
     AND a.class_id      = t.class_id
     AND a.subject_id    = COALESCE(s.subject_id, v_kbm_id)
     AND a.academic_year = p_academic_year
     AND a.semester      = p_semester
    JOIN generate_series(v_start::timestamp, v_end::timestamp, interval '1 day') gs(d)
      ON extract(isodow from gs.d) = CASE t.day_of_week::text
            WHEN 'SENIN'  THEN 1 WHEN 'SELASA' THEN 2 WHEN 'RABU' THEN 3
            WHEN 'KAMIS'  THEN 4 WHEN 'JUMAT'  THEN 5 WHEN 'SABTU' THEN 6 END
    WHERE t.academic_year = p_academic_year
      AND t.semester      = p_semester
      AND t.school_id     = p_school_id
    ON CONFLICT (class_id, scheduled_teacher_id, session_date, session_start)
    DO NOTHING;
    GET DIAGNOSTICS v_schedules = ROW_COUNT;

    RETURN jsonb_build_object(
        'templates_found',      v_templates,
        'assignments_upserted', v_assigns,
        'schedules_generated',  v_schedules
    );
END;
$function$;
