-- ============================================================
-- FIX C1 + C2 — fn_apply_schedule_templates sadar-tenant
-- ============================================================
-- C1: INSERT subjects (KBM, tabel "tanpa induk") gagal NOT NULL
--     school_id di service-role. + stamp school_id eksplisit pada
--     teaching_assignments & teaching_schedules.
-- C2: sebelumnya memproses SEMUA template untuk (year, semester)
--     lintas sekolah, dan lookup subject KBM/periode tak discope.
--     Perbaikan: terima p_school_id, scope semua ke sekolah itu.
-- Signature berubah (tambah p_school_id) → drop versi lama.
-- ============================================================

DROP FUNCTION IF EXISTS fn_apply_schedule_templates(text, semester);

CREATE OR REPLACE FUNCTION public.fn_apply_schedule_templates(
    p_academic_year text, p_semester semester, p_school_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_subject_id  uuid;
    v_start       date;
    v_end         date;
    v_templates   integer;
    v_assignments integer;
    v_schedules   integer;
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

    SELECT subject_id INTO v_subject_id
    FROM subjects WHERE code = 'KBM' AND school_id = p_school_id;
    IF v_subject_id IS NULL THEN
        INSERT INTO subjects (code, name, is_active, school_id)
        VALUES ('KBM', 'Kegiatan Belajar Mengajar', true, p_school_id)
        RETURNING subject_id INTO v_subject_id;
    END IF;

    INSERT INTO teaching_assignments (user_id, class_id, subject_id, academic_year, semester, is_active, school_id)
    SELECT DISTINCT t.teacher_id, t.class_id, v_subject_id, p_academic_year, p_semester, true, p_school_id
    FROM schedule_templates t
    WHERE t.academic_year = p_academic_year AND t.semester = p_semester
      AND t.school_id = p_school_id
    ON CONFLICT (user_id, class_id, subject_id, academic_year, semester)
    DO UPDATE SET is_active = true;
    GET DIAGNOSTICS v_assignments = ROW_COUNT;

    INSERT INTO teaching_schedules
        (assignment_id, class_id, subject_id, scheduled_teacher_id,
         session_date, session_start, session_end,
         academic_year, semester, meeting_status, teacher_indicator, school_id)
    SELECT a.assignment_id, t.class_id, v_subject_id, t.teacher_id,
           gs.d::date, t.start_time, t.end_time,
           p_academic_year, p_semester,
           'NORMAL'::meeting_status, 'PENDING_EVALUATION'::teacher_attendance_indicator, p_school_id
    FROM schedule_templates t
    JOIN teaching_assignments a
      ON a.user_id        = t.teacher_id
     AND a.class_id       = t.class_id
     AND a.subject_id     = v_subject_id
     AND a.academic_year  = p_academic_year
     AND a.semester       = p_semester
    JOIN generate_series(v_start::timestamp, v_end::timestamp, interval '1 day') gs(d)
      ON extract(isodow from gs.d) = CASE t.day_of_week::text
            WHEN 'SENIN'  THEN 1 WHEN 'SELASA' THEN 2 WHEN 'RABU' THEN 3
            WHEN 'KAMIS'  THEN 4 WHEN 'JUMAT'  THEN 5 WHEN 'SABTU' THEN 6 END
    WHERE t.academic_year = p_academic_year AND t.semester = p_semester
      AND t.school_id = p_school_id
    ON CONFLICT (class_id, scheduled_teacher_id, session_date, session_start)
    DO NOTHING;
    GET DIAGNOSTICS v_schedules = ROW_COUNT;

    RETURN jsonb_build_object(
        'templates_found',      v_templates,
        'assignments_upserted', v_assignments,
        'schedules_generated',  v_schedules
    );
END;
$function$;
