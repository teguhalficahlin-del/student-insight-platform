-- ============================================================
-- Migration: 20260630230000_fix_apply_schedule.sql
-- Perbaiki "Terapkan Jadwal" yang gagal 500.
--
-- AKAR MASALAH
-- teaching_schedules punya constraint uq_schedule_per_assignment_date
-- UNIQUE (assignment_id, session_date). Pada alur apply-templates, satu
-- guru×kelas memakai satu assignment (subject default KBM), padahal guru
-- mengajar kelas yang sama BEBERAPA jam pelajaran dalam sehari (460
-- kombinasi guru,kelas,hari dengan >1 jam). Maka banyak sesi punya
-- assignment_id + session_date yang sama → melanggar constraint itu.
-- Klausa ON CONFLICT hanya menangani uq_schedule_slot, jadi pelanggaran
-- ini melempar unique_violation → 500, dan teaching_schedules tetap 0.
--
-- Keunikan yang BENAR sudah dijaga uq_schedule_slot
-- (class_id, scheduled_teacher_id, session_date, session_start) yang
-- membolehkan banyak jam berbeda di hari sama. Jadi constraint
-- per-assignment-per-date itu over-restriktif dan dibuang.
--
-- Sekalian: pindahkan generasi dari edge function (34k baris dibangun
-- di klien + ~70 round-trip, rawan timeout) ke RPC set-based di DB —
-- jauh lebih cepat dan atomik.
-- ============================================================

ALTER TABLE teaching_schedules DROP CONSTRAINT IF EXISTS uq_schedule_per_assignment_date;

CREATE OR REPLACE FUNCTION fn_apply_schedule_templates(p_academic_year text, p_semester semester)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    WHERE academic_year = p_academic_year AND semester = p_semester;

    IF v_templates = 0 THEN
        RETURN jsonb_build_object('templates_found', 0, 'assignments_upserted', 0, 'schedules_generated', 0);
    END IF;

    SELECT start_date, end_date INTO v_start, v_end
    FROM academic_periods
    WHERE academic_year = p_academic_year AND semester = p_semester;

    IF v_start IS NULL THEN
        RAISE EXCEPTION 'Periode akademik % semester % belum terdaftar', p_academic_year, p_semester;
    END IF;

    -- Subject default KBM (get-or-create)
    SELECT subject_id INTO v_subject_id FROM subjects WHERE code = 'KBM';
    IF v_subject_id IS NULL THEN
        INSERT INTO subjects (code, name, is_active)
        VALUES ('KBM', 'Kegiatan Belajar Mengajar', true)
        RETURNING subject_id INTO v_subject_id;
    END IF;

    -- Assignment per (guru,kelas) unik. DISTINCT → tak ada kunci-konflik
    -- kembar dalam satu perintah.
    INSERT INTO teaching_assignments (user_id, class_id, subject_id, academic_year, semester, is_active)
    SELECT DISTINCT t.teacher_id, t.class_id, v_subject_id, p_academic_year, p_semester, true
    FROM schedule_templates t
    WHERE t.academic_year = p_academic_year AND t.semester = p_semester
    ON CONFLICT (user_id, class_id, subject_id, academic_year, semester)
    DO UPDATE SET is_active = true;
    GET DIAGNOSTICS v_assignments = ROW_COUNT;

    -- Sesi bertanggal, set-based: tiap template × tiap tanggal di periode
    -- yang hari-nya cocok. DO NOTHING agar sesi yang sudah ada (mis. yang
    -- sudah ada absensi) tidak ditimpa.
    INSERT INTO teaching_schedules
        (assignment_id, class_id, subject_id, scheduled_teacher_id,
         session_date, session_start, session_end,
         academic_year, semester, meeting_status, teacher_indicator)
    SELECT a.assignment_id, t.class_id, v_subject_id, t.teacher_id,
           gs.d::date, t.start_time, t.end_time,
           p_academic_year, p_semester,
           'NORMAL'::meeting_status, 'PENDING_EVALUATION'::teacher_attendance_indicator
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
    ON CONFLICT (class_id, scheduled_teacher_id, session_date, session_start)
    DO NOTHING;
    GET DIAGNOSTICS v_schedules = ROW_COUNT;

    RETURN jsonb_build_object(
        'templates_found',      v_templates,
        'assignments_upserted', v_assignments,
        'schedules_generated',  v_schedules
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION fn_apply_schedule_templates(text, semester) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION fn_apply_schedule_templates(text, semester) TO service_role;

COMMENT ON FUNCTION fn_apply_schedule_templates IS
    'Generate teaching_schedules dari schedule_templates untuk satu periode '
    '(set-based). Dipanggil edge function apply-schedule-templates.';
