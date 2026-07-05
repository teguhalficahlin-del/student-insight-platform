-- ============================================================
-- Migrasi: Notifikasi ke SISWA dan ORTU
--
-- Tiga sumber notif baru:
--   1. Observasi STUDENT_VISIBLE baru  → SISWA + semua ORTU
--   2. Kasus RESTRICTED baru dibuat    → SISWA + semua ORTU
--   3. Komentar STUDENT_VISIBLE di kasus RESTRICTED
--      atau kasus RESTRICTED ditutup   → SISWA + semua ORTU
--
-- Juga: registerLoginDevice kini bisa dipakai portal siswa &
--   orang tua → LOGIN_NEW_DEVICE sudah tercakup constraint lama.
-- ============================================================

BEGIN;

-- ── 1. Perluas constraint tipe notifikasi ────────────────────
ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
    CHECK (type IN (
        'ESCALATION_DM',
        'CASE_BROADCAST',
        'LOGIN_NEW_DEVICE',
        'OBSERVATION_NEW',
        'CASE_RESTRICTED_NEW',
        'CASE_STUDENT_UPDATE'
    ));

-- ── 2. Trigger: observasi baru STUDENT_VISIBLE ───────────────
CREATE OR REPLACE FUNCTION fn_notify_on_observation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_student_user_id UUID;
BEGIN
    IF NEW.visibility <> 'STUDENT_VISIBLE' THEN
        RETURN NEW;
    END IF;

    SELECT user_id INTO v_student_user_id
    FROM   students
    WHERE  student_id = NEW.student_id;

    IF v_student_user_id IS NOT NULL
       AND v_student_user_id <> NEW.author_user_id THEN
        INSERT INTO notifications
            (school_id, recipient_user_id, case_id, type, title, body)
        VALUES (
            NEW.school_id, v_student_user_id, NULL,
            'OBSERVATION_NEW',
            'Catatan guru baru',
            'Guru menambahkan catatan baru untuk Anda.'
        );
    END IF;

    INSERT INTO notifications
        (school_id, recipient_user_id, case_id, type, title, body)
    SELECT
        NEW.school_id, sp.parent_user_id, NULL,
        'OBSERVATION_NEW',
        'Catatan guru baru tentang anak Anda',
        'Guru menambahkan catatan baru tentang anak Anda.'
    FROM   student_parents sp
    WHERE  sp.student_id     = NEW.student_id
      AND  sp.parent_user_id <> NEW.author_user_id;

    RETURN NEW;
END;
$$;

REVOKE ALL     ON FUNCTION fn_notify_on_observation() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION fn_notify_on_observation() TO service_role;

CREATE TRIGGER trg_notify_observation
    AFTER INSERT ON observations
    FOR EACH ROW EXECUTE PROCEDURE fn_notify_on_observation();

-- ── 3. Trigger: kasus RESTRICTED baru dibuat ────────────────
CREATE OR REPLACE FUNCTION fn_notify_on_case_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_student_user_id UUID;
    v_author_name     TEXT;
BEGIN
    IF NEW.audience <> 'RESTRICTED' THEN
        RETURN NEW;
    END IF;

    SELECT full_name INTO v_author_name
    FROM   users WHERE user_id = NEW.created_by_user_id;

    SELECT user_id INTO v_student_user_id
    FROM   students WHERE student_id = NEW.student_id;

    IF v_student_user_id IS NOT NULL
       AND v_student_user_id <> NEW.created_by_user_id THEN
        INSERT INTO notifications
            (school_id, recipient_user_id, case_id, type, title, body)
        VALUES (
            NEW.school_id, v_student_user_id, NEW.case_id,
            'CASE_RESTRICTED_NEW',
            'Kasus baru tentang Anda',
            format('%s membuat kasus baru: "%s"',
                   coalesce(v_author_name, 'Guru'), NEW.title)
        );
    END IF;

    INSERT INTO notifications
        (school_id, recipient_user_id, case_id, type, title, body)
    SELECT
        NEW.school_id, sp.parent_user_id, NEW.case_id,
        'CASE_RESTRICTED_NEW',
        'Kasus baru tentang anak Anda',
        format('%s membuat kasus tentang anak Anda: "%s"',
               coalesce(v_author_name, 'Guru'), NEW.title)
    FROM   student_parents sp
    WHERE  sp.student_id     = NEW.student_id
      AND  sp.parent_user_id <> NEW.created_by_user_id;

    RETURN NEW;
END;
$$;

REVOKE ALL     ON FUNCTION fn_notify_on_case_created() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION fn_notify_on_case_created() TO service_role;

CREATE TRIGGER trg_notify_case_created
    AFTER INSERT ON cases
    FOR EACH ROW EXECUTE PROCEDURE fn_notify_on_case_created();

-- ── 4. Perluas fn_notify_on_case_event → tambah Blok C ──────
--    (SISWA + ORTU untuk komentar STUDENT_VISIBLE & penutupan
--     pada kasus RESTRICTED — Blok A & B tidak diubah)
CREATE OR REPLACE FUNCTION fn_notify_on_case_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_case            cases%ROWTYPE;
    v_actor_name      TEXT;
    v_title           TEXT;
    v_body            TEXT;
    v_student_user_id UUID;
BEGIN
    IF NEW.event_type NOT IN (
        'DECISION_ESCALATE','COMMENT_ADDED','DECISION_CLOSE','STATUS_CHANGED'
    ) THEN
        RETURN NEW;
    END IF;

    SELECT * INTO v_case FROM cases WHERE case_id = NEW.case_id;
    SELECT full_name INTO v_actor_name FROM users WHERE user_id = NEW.author_user_id;

    -- ── A. Eskalasi → handler baru (tidak berubah) ────────────
    IF NEW.event_type = 'DECISION_ESCALATE'
       AND NEW.new_handler_role IS NOT NULL THEN
        v_title := 'Kasus diteruskan ke Anda';
        v_body  := format('%s meneruskan kasus "%s" kepada Anda.',
                          coalesce(v_actor_name,'Seseorang'), v_case.title);
        INSERT INTO notifications
            (school_id, recipient_user_id, case_id, type, title, body)
        SELECT v_case.school_id, u.user_id, v_case.case_id,
               'ESCALATION_DM', v_title, v_body
        FROM   users u
        WHERE  u.school_id  = v_case.school_id
          AND  u.role_type  = NEW.new_handler_role
          AND  u.is_active  = true
          AND  u.deleted_at IS NULL;
    END IF;

    -- ── B. Siaran internal → kasus PUBLIC (tidak berubah) ─────
    IF v_case.audience = 'PUBLIC'
       AND NEW.event_type IN (
           'COMMENT_ADDED','DECISION_ESCALATE','DECISION_CLOSE','STATUS_CHANGED'
       )
    THEN
        v_title := CASE NEW.event_type
            WHEN 'COMMENT_ADDED'     THEN 'Komentar baru di kasus'
            WHEN 'DECISION_ESCALATE' THEN 'Kasus diteruskan ke handler baru'
            WHEN 'DECISION_CLOSE'    THEN 'Kasus ditutup'
            WHEN 'STATUS_CHANGED'    THEN 'Status kasus berubah'
            ELSE                          'Update kasus'
        END;
        v_body  := format('%s — kasus "%s"',
                          coalesce(v_actor_name,'Seseorang'), v_case.title);
        INSERT INTO notifications
            (school_id, recipient_user_id, case_id, type, title, body)
        SELECT v_case.school_id, u.user_id, v_case.case_id,
               'CASE_BROADCAST', v_title, v_body
        FROM   users u
        WHERE  u.school_id = v_case.school_id
          AND  u.role_type IN (
              'GURU','BK','WALI_KELAS','KAPRODI','WAKA_KESISWAAN','KEPSEK'
          )
          AND  u.is_active  = true
          AND  u.deleted_at IS NULL
          AND  u.user_id   != NEW.author_user_id;
    END IF;

    -- ── C. Update STUDENT_VISIBLE / penutupan → SISWA + ORTU ─
    IF v_case.audience = 'RESTRICTED'
       AND (
           (NEW.event_type = 'COMMENT_ADDED'
            AND NEW.privacy_level = 'STUDENT_VISIBLE')
           OR NEW.event_type = 'DECISION_CLOSE'
       )
    THEN
        SELECT user_id INTO v_student_user_id
        FROM   students WHERE student_id = v_case.student_id;

        v_title := CASE NEW.event_type
            WHEN 'DECISION_CLOSE' THEN 'Kasus Anda ditutup'
            ELSE                       'Komentar baru di kasus Anda'
        END;
        v_body := CASE NEW.event_type
            WHEN 'DECISION_CLOSE'
                THEN format('Kasus "%s" telah ditutup.', v_case.title)
            ELSE format('%s menambahkan komentar pada kasus "%s".',
                        coalesce(v_actor_name,'Guru'), v_case.title)
        END;

        IF v_student_user_id IS NOT NULL
           AND v_student_user_id <> NEW.author_user_id THEN
            INSERT INTO notifications
                (school_id, recipient_user_id, case_id, type, title, body)
            VALUES (
                v_case.school_id, v_student_user_id, v_case.case_id,
                'CASE_STUDENT_UPDATE', v_title, v_body
            );
        END IF;

        INSERT INTO notifications
            (school_id, recipient_user_id, case_id, type, title, body)
        SELECT
            v_case.school_id, sp.parent_user_id, v_case.case_id,
            'CASE_STUDENT_UPDATE',
            replace(v_title, 'Anda', 'anak Anda'),
            v_body
        FROM   student_parents sp
        WHERE  sp.student_id     = v_case.student_id
          AND  sp.parent_user_id <> NEW.author_user_id;
    END IF;

    RETURN NEW;
END;
$$;

COMMIT;
