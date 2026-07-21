-- Fix #2: fn_notify_on_late_arrival — tambah filter school_id pada query student_parents
-- Fix #1: REVOKE direct INSERT ke forum_posts — paksa semua lewat fn_create_forum_post

BEGIN;

-- ── Fix #2: tambah sp.school_id filter ──────────────────────
CREATE OR REPLACE FUNCTION fn_notify_on_late_arrival()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_student_name    TEXT;
    v_class_id        UUID;
    v_title_ortu      TEXT;
    v_body_ortu       TEXT;
    v_title_guru      TEXT;
    v_body_guru       TEXT;
BEGIN
    SELECT u.full_name
    INTO   v_student_name
    FROM   students s
    JOIN   users u ON u.user_id = s.user_id
    WHERE  s.student_id = NEW.student_id;

    SELECT ce.class_id
    INTO   v_class_id
    FROM   class_enrollments ce
    WHERE  ce.student_id   = NEW.student_id
      AND  ce.withdrawn_at IS NULL
    ORDER BY ce.academic_year DESC, ce.semester DESC
    LIMIT  1;

    v_title_ortu := 'Anak Anda terlambat masuk sekolah';
    v_body_ortu  := format(
        '%s datang terlambat pada %s pukul %s.%s',
        coalesce(v_student_name, 'Siswa'),
        to_char(NEW.late_date, 'DD Mon YYYY'),
        to_char(NEW.arrival_time, 'HH24:MI'),
        CASE WHEN NEW.reason IS NOT NULL
             THEN ' Keterangan: ' || NEW.reason
             ELSE ''
        END
    );

    v_title_guru := 'Siswa terlambat di kelas Anda';
    v_body_guru  := format(
        '%s terlambat masuk pada %s pukul %s.',
        coalesce(v_student_name, 'Siswa'),
        to_char(NEW.late_date, 'DD Mon YYYY'),
        to_char(NEW.arrival_time, 'HH24:MI')
    );

    -- Kirim ke semua orang tua (dengan filter school_id)
    INSERT INTO notifications
        (school_id, recipient_user_id, case_id, late_arrival_id,
         type, title, body)
    SELECT
        NEW.school_id,
        sp.parent_user_id,
        NULL,
        NEW.late_id,
        'LATE_ARRIVAL',
        v_title_ortu,
        v_body_ortu
    FROM student_parents sp
    WHERE sp.student_id = NEW.student_id
      AND sp.school_id  = NEW.school_id;

    -- Kirim ke guru yang mengajar hari ini di kelas siswa
    IF v_class_id IS NOT NULL THEN
        INSERT INTO notifications
            (school_id, recipient_user_id, case_id, late_arrival_id,
             type, title, body)
        SELECT DISTINCT ON (ts.scheduled_teacher_id)
            NEW.school_id,
            ts.scheduled_teacher_id,
            NULL,
            NEW.late_id,
            'LATE_ARRIVAL',
            v_title_guru,
            v_body_guru
        FROM teaching_schedules ts
        WHERE ts.class_id               = v_class_id
          AND ts.session_date           = NEW.late_date
          AND ts.scheduled_teacher_id  <> NEW.recorded_by
          AND EXISTS (
              SELECT 1 FROM users u
              WHERE  u.user_id    = ts.scheduled_teacher_id
                AND  u.school_id  = NEW.school_id
                AND  u.is_active  = true
                AND  u.deleted_at IS NULL
          );
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL     ON FUNCTION fn_notify_on_late_arrival() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION fn_notify_on_late_arrival() TO service_role;

-- ── Fix #1: REVOKE direct INSERT ke forum_posts ──────────────
REVOKE INSERT ON forum_posts FROM authenticated;
DROP POLICY IF EXISTS rls_forum_posts_insert ON forum_posts;

COMMIT;
