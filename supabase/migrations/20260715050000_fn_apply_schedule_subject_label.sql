-- Update fn_apply_schedule_templates: isi subject_label saat generate sesi baru
-- Kolom subject_label ditambahkan ke teaching_schedules via 20260715040000

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

    -- Untuk loop get-or-create per label unik
    v_label     text;
    v_subj_id   uuid;
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

    -- Pastikan KBM ada sebagai fallback (subject_label NULL/kosong)
    SELECT subject_id INTO v_kbm_id
    FROM subjects WHERE code = 'KBM' AND school_id = p_school_id;
    IF v_kbm_id IS NULL THEN
        INSERT INTO subjects (code, name, is_active, school_id)
        VALUES ('KBM', 'Kegiatan Belajar Mengajar', true, p_school_id)
        RETURNING subject_id INTO v_kbm_id;
    END IF;

    -- Get-or-create per label unik yang ada di template hari ini
    -- Urutan lookup: name (ILIKE) → code (ILIKE) → buat baru
    FOR v_label IN
        SELECT DISTINCT subject_label
        FROM schedule_templates
        WHERE academic_year = p_academic_year AND semester = p_semester
          AND school_id = p_school_id
          AND subject_label IS NOT NULL
          AND TRIM(subject_label) <> ''
    LOOP
        -- Coba cocokkan ke name dulu
        SELECT subject_id INTO v_subj_id
        FROM subjects
        WHERE school_id = p_school_id AND is_active = true
          AND name ILIKE v_label
        LIMIT 1;

        -- Jika tidak ketemu, coba cocokkan ke code
        IF v_subj_id IS NULL THEN
            SELECT subject_id INTO v_subj_id
            FROM subjects
            WHERE school_id = p_school_id AND is_active = true
              AND code ILIKE v_label
            LIMIT 1;
        END IF;

        -- Jika masih tidak ketemu, buat subject baru
        IF v_subj_id IS NULL THEN
            INSERT INTO subjects (code, name, is_active, school_id)
            VALUES (
                UPPER(LEFT(REGEXP_REPLACE(v_label, '\s+', '_', 'g'), 20)),
                v_label,
                true,
                p_school_id
            )
            RETURNING subject_id INTO v_subj_id;
        END IF;

        -- Simpan mapping label → subject_id ke tabel temp
        -- (dipakai oleh INSERT berikutnya)
    END LOOP;

    -- Teaching assignments: satu baris per (guru, kelas, mapel)
    -- Resolve label → subjects via name ILIKE atau code ILIKE; fallback KBM
    INSERT INTO teaching_assignments
        (user_id, class_id, subject_id, academic_year, semester, is_active, school_id)
    SELECT DISTINCT
        t.teacher_id,
        t.class_id,
        COALESCE(
            (SELECT subject_id FROM subjects
             WHERE school_id = p_school_id AND is_active = true
               AND (name ILIKE t.subject_label OR code ILIKE t.subject_label)
             LIMIT 1),
            v_kbm_id
        ),
        p_academic_year,
        p_semester,
        true,
        p_school_id
    FROM schedule_templates t
    WHERE t.academic_year = p_academic_year
      AND t.semester      = p_semester
      AND t.school_id     = p_school_id
    ON CONFLICT (user_id, class_id, subject_id, academic_year, semester)
    DO UPDATE SET is_active = true;
    GET DIAGNOSTICS v_assigns = ROW_COUNT;

    -- Sesi harian dengan subject_id dan subject_label yang benar per template
    INSERT INTO teaching_schedules
        (assignment_id, class_id, subject_id, scheduled_teacher_id,
         session_date, session_start, session_end, subject_label,
         academic_year, semester, meeting_status, teacher_indicator, school_id)
    SELECT
        a.assignment_id,
        t.class_id,
        COALESCE(
            (SELECT subject_id FROM subjects
             WHERE school_id = p_school_id AND is_active = true
               AND (name ILIKE t.subject_label OR code ILIKE t.subject_label)
             LIMIT 1),
            v_kbm_id
        ),
        t.teacher_id,
        gs.d::date,
        t.start_time,
        t.end_time,
        t.subject_label,
        p_academic_year,
        p_semester,
        'NORMAL'::meeting_status,
        'PENDING_EVALUATION'::teacher_attendance_indicator,
        p_school_id
    FROM schedule_templates t
    JOIN teaching_assignments a
      ON a.user_id       = t.teacher_id
     AND a.class_id      = t.class_id
     AND a.subject_id    = COALESCE(
            (SELECT subject_id FROM subjects
             WHERE school_id = p_school_id AND is_active = true
               AND (name ILIKE t.subject_label OR code ILIKE t.subject_label)
             LIMIT 1),
            v_kbm_id
         )
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

REVOKE EXECUTE ON FUNCTION public.fn_apply_schedule_templates(text, semester, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_apply_schedule_templates(text, semester, uuid) FROM anon;
