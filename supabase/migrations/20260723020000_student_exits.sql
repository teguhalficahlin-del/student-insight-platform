BEGIN;

-- Perluas constraint type notifications
ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
    CHECK (type IN (
        'ESCALATION_DM','CASE_BROADCAST','LOGIN_NEW_DEVICE',
        'OBSERVATION_NEW','CASE_RESTRICTED_NEW','CASE_STUDENT_UPDATE',
        'FORUM_POST_NEW','FORUM_COMMENT_NEW','PERANGKAT_AJAR',
        'LATE_ARRIVAL','EXIT_NOTIFICATION'
    ));

-- Tabel student_exits
CREATE TABLE student_exits (
    exit_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id       UUID NOT NULL REFERENCES schools(school_id),
    student_id      UUID NOT NULL REFERENCES students(student_id),
    exit_date       DATE NOT NULL DEFAULT (NOW() AT TIME ZONE 'Asia/Jakarta')::date,
    exit_time       TIME NOT NULL,
    return_time     TIME,
    reason          TEXT,
    recorded_by     UUID NOT NULL REFERENCES users(user_id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE student_exits ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_exits_school_date ON student_exits(school_id, exit_date);
CREATE INDEX idx_exits_student     ON student_exits(student_id);

-- RLS INSERT: guru piket yang bertugas hari ini
CREATE POLICY rls_exits_insert_piket ON student_exits
    FOR INSERT WITH CHECK (
        school_id = fn_current_school_id()
        AND recorded_by = fn_current_user_id()
        AND fn_is_on_duty_today()
    );

-- RLS SELECT: guru piket hari ini
CREATE POLICY rls_exits_read_piket ON student_exits
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND exit_date = (NOW() AT TIME ZONE 'Asia/Jakarta')::date
        AND fn_is_on_duty_today()
    );

-- RLS SELECT: waka kesiswaan + kepsek
CREATE POLICY rls_exits_read_waka ON student_exits
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() IN ('WAKA_KESISWAAN','KEPSEK')
    );

-- RLS SELECT: TU
CREATE POLICY rls_exits_read_tu ON student_exits
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'TU'::role_type
    );

-- RLS SELECT: siswa sendiri
CREATE POLICY rls_exits_read_student ON student_exits
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND student_id = (
            SELECT s.student_id FROM students s
            WHERE s.user_id = fn_current_user_id()
            LIMIT 1
        )
    );

-- RLS SELECT: ortu dari siswa tersebut
CREATE POLICY rls_exits_read_parent ON student_exits
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND EXISTS (
            SELECT 1 FROM student_parents sp
            WHERE sp.student_id = student_exits.student_id
              AND sp.parent_user_id = fn_current_user_id()
              AND sp.school_id = fn_current_school_id()
        )
    );

-- RLS UPDATE: hanya pencatat sendiri (untuk isi return_time)
CREATE POLICY rls_exits_update_own ON student_exits
    FOR UPDATE USING (
        school_id = fn_current_school_id()
        AND recorded_by = fn_current_user_id()
        AND fn_is_on_duty_today()
    ) WITH CHECK (
        school_id = fn_current_school_id()
        AND recorded_by = fn_current_user_id()
    );

-- RLS DELETE: hanya pencatat sendiri
CREATE POLICY rls_exits_delete_own ON student_exits
    FOR DELETE USING (
        school_id = fn_current_school_id()
        AND recorded_by = fn_current_user_id()
        AND fn_is_on_duty_today()
    );

-- Trigger notifikasi
CREATE OR REPLACE FUNCTION fn_notify_on_exit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
    v_student_name TEXT;
    v_class_id     UUID;
    v_title_ortu   TEXT;
    v_body_ortu    TEXT;
    v_title_guru   TEXT;
    v_body_guru    TEXT;
BEGIN
    SELECT u.full_name INTO v_student_name
    FROM students s JOIN users u ON u.user_id = s.user_id
    WHERE s.student_id = NEW.student_id;

    SELECT ce.class_id INTO v_class_id
    FROM class_enrollments ce
    WHERE ce.student_id = NEW.student_id AND ce.withdrawn_at IS NULL
    ORDER BY ce.academic_year DESC, ce.semester DESC LIMIT 1;

    v_title_ortu := 'Anak Anda izin keluar sekolah';
    v_body_ortu  := format('%s izin keluar pada %s pukul %s.%s',
        coalesce(v_student_name,'Siswa'),
        to_char(NEW.exit_date,'DD Mon YYYY'),
        to_char(NEW.exit_time,'HH24:MI'),
        CASE WHEN NEW.reason IS NOT NULL THEN ' Alasan: ' || NEW.reason ELSE '' END);

    v_title_guru := 'Siswa izin keluar dari kelas Anda';
    v_body_guru  := format('%s izin keluar pada %s pukul %s.',
        coalesce(v_student_name,'Siswa'),
        to_char(NEW.exit_date,'DD Mon YYYY'),
        to_char(NEW.exit_time,'HH24:MI'));

    INSERT INTO notifications(school_id, recipient_user_id, type, title, body)
    SELECT NEW.school_id, sp.parent_user_id, 'EXIT_NOTIFICATION', v_title_ortu, v_body_ortu
    FROM student_parents sp
    WHERE sp.student_id = NEW.student_id AND sp.school_id = NEW.school_id;

    IF v_class_id IS NOT NULL THEN
        INSERT INTO notifications(school_id, recipient_user_id, type, title, body)
        SELECT DISTINCT ON (ts.scheduled_teacher_id)
            NEW.school_id, ts.scheduled_teacher_id, 'EXIT_NOTIFICATION', v_title_guru, v_body_guru
        FROM teaching_schedules ts
        WHERE ts.class_id = v_class_id
          AND ts.session_date = NEW.exit_date
          AND ts.scheduled_teacher_id <> NEW.recorded_by
          AND EXISTS (
              SELECT 1 FROM users u
              WHERE u.user_id = ts.scheduled_teacher_id
                AND u.school_id = NEW.school_id
                AND u.is_active = true AND u.deleted_at IS NULL
          );
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION fn_notify_on_exit() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fn_notify_on_exit() TO service_role;

CREATE TRIGGER trg_notify_exit
    AFTER INSERT ON student_exits
    FOR EACH ROW EXECUTE PROCEDURE fn_notify_on_exit();

COMMIT;
