-- ============================================================
-- Migration 20260722020000: notifikasi keterlambatan siswa
--
-- AFTER INSERT ON late_arrivals → kirim LATE_ARRIVAL ke:
--   1. Semua orang tua siswa (via student_parents)
--   2. Semua guru yang mengajar di kelas siswa HARI INI
--      (via teaching_schedules session_date = late_date)
--      kecuali guru piket yang mencatat (recorded_by)
-- ============================================================

BEGIN;

-- ── 1. Tambah kolom late_arrival_id (nullable) ───────────────
ALTER TABLE notifications
    ADD COLUMN late_arrival_id UUID
        REFERENCES late_arrivals(late_id) ON DELETE SET NULL;

-- ── 2. Perluas constraint type ───────────────────────────────
ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
    CHECK (type IN (
        'ESCALATION_DM',
        'CASE_BROADCAST',
        'LOGIN_NEW_DEVICE',
        'OBSERVATION_NEW',
        'CASE_RESTRICTED_NEW',
        'CASE_STUDENT_UPDATE',
        'FORUM_POST_NEW',
        'FORUM_COMMENT_NEW',
        'PERANGKAT_AJAR',
        'LATE_ARRIVAL'
    ));

-- ── 3. Index untuk late_arrival_id ───────────────────────────
CREATE INDEX idx_notif_late_arrival
    ON notifications(late_arrival_id)
    WHERE late_arrival_id IS NOT NULL;

-- ── 4. Fungsi trigger ────────────────────────────────────────
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
    -- Ambil nama siswa
    SELECT u.full_name
    INTO   v_student_name
    FROM   students s
    JOIN   users u ON u.user_id = s.user_id
    WHERE  s.student_id = NEW.student_id;

    -- Ambil class_id enrollment aktif siswa
    SELECT ce.class_id
    INTO   v_class_id
    FROM   class_enrollments ce
    WHERE  ce.student_id   = NEW.student_id
      AND  ce.withdrawn_at IS NULL
    ORDER BY ce.academic_year DESC, ce.semester DESC
    LIMIT  1;

    -- Susun pesan
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

    -- ── A. Kirim ke semua orang tua ──────────────────────────
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
    WHERE sp.student_id = NEW.student_id;

    -- ── B. Kirim ke guru yang mengajar hari ini di kelas siswa
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
        WHERE ts.class_id          = v_class_id
          AND ts.session_date      = NEW.late_date
          AND ts.scheduled_teacher_id <> NEW.recorded_by
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

-- ── 5. Trigger ───────────────────────────────────────────────
CREATE TRIGGER trg_notify_late_arrival
    AFTER INSERT ON late_arrivals
    FOR EACH ROW EXECUTE PROCEDURE fn_notify_on_late_arrival();

COMMIT;
