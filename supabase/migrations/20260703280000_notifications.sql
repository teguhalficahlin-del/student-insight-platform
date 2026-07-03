-- ============================================================
-- Migration 20260703280000: tabel notifications + trigger
--
-- Fase 2 Langkah B: mesin notifikasi kasus.
-- Dua jenis:
--   ESCALATION_DM  → japri ke new_handler_role, SELALU (termasuk privat)
--   CASE_BROADCAST → siaran ke semua internal, HANYA kasus PUBLIC
-- Privat = SENYAP (hanya DM eskalasi yang tetap jalan).
-- ============================================================

-- ── 1. Tabel ─────────────────────────────────────────────────
CREATE TABLE notifications (
    notification_id   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id         UUID        NOT NULL REFERENCES schools(school_id),
    recipient_user_id UUID        NOT NULL REFERENCES users(user_id),
    case_id           UUID        REFERENCES cases(case_id) ON DELETE SET NULL,
    type              TEXT        NOT NULL CHECK (type IN ('ESCALATION_DM','CASE_BROADCAST')),
    title             TEXT        NOT NULL,
    body              TEXT        NOT NULL DEFAULT '',
    is_read           BOOLEAN     NOT NULL DEFAULT false,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notif_recipient ON notifications(recipient_user_id, is_read, created_at DESC);
CREATE INDEX idx_notif_school    ON notifications(school_id, created_at DESC);

COMMENT ON TABLE notifications IS
    'Notifikasi per-user untuk kasus BK. '
    'ESCALATION_DM: japri ke handler baru (selalu). '
    'CASE_BROADCAST: siaran ke semua internal (kasus PUBLIC saja).';

-- ── 2. RLS ──────────────────────────────────────────────────
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Baca: hanya notif milik sendiri, di sekolah sendiri
CREATE POLICY rls_notif_read ON notifications FOR SELECT
    USING (
        recipient_user_id = fn_current_user_id()
        AND school_id     = fn_current_school_id()
    );

-- Update: boleh mark is_read=true saja, notif milik sendiri
CREATE POLICY rls_notif_update_read ON notifications FOR UPDATE
    USING  (recipient_user_id = fn_current_user_id() AND school_id = fn_current_school_id())
    WITH CHECK (recipient_user_id = fn_current_user_id());

GRANT SELECT ON notifications TO authenticated;
GRANT UPDATE(is_read) ON notifications TO authenticated;
GRANT ALL ON notifications TO service_role;

-- ── 3. Fungsi trigger ────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_notify_on_case_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_case       cases%ROWTYPE;
    v_actor_name TEXT;
    v_title      TEXT;
    v_body       TEXT;
BEGIN
    -- Hanya event bermakna untuk notif
    IF NEW.event_type NOT IN ('DECISION_ESCALATE','COMMENT_ADDED','DECISION_CLOSE','STATUS_CHANGED') THEN
        RETURN NEW;
    END IF;

    SELECT * INTO v_case FROM cases WHERE case_id = NEW.case_id;
    SELECT full_name INTO v_actor_name FROM users WHERE user_id = NEW.author_user_id;

    -- ── A. JAPRI ESKALASI → new_handler_role (SELALU, apa pun audiens) ──
    IF NEW.event_type = 'DECISION_ESCALATE' AND NEW.new_handler_role IS NOT NULL THEN
        v_title := 'Kasus diteruskan ke Anda';
        v_body  := format('%s meneruskan kasus "%s" kepada Anda.',
                          coalesce(v_actor_name,'Seseorang'), v_case.title);
        INSERT INTO notifications (school_id, recipient_user_id, case_id, type, title, body)
        SELECT  v_case.school_id, u.user_id, v_case.case_id,
                'ESCALATION_DM', v_title, v_body
        FROM    users u
        WHERE   u.school_id  = v_case.school_id
          AND   u.role_type  = NEW.new_handler_role
          AND   u.is_active  = true
          AND   u.deleted_at IS NULL;
    END IF;

    -- ── B. SIARAN → semua internal (HANYA kasus PUBLIC, bukan ke author) ──
    IF v_case.audience = 'PUBLIC'
       AND NEW.event_type IN ('COMMENT_ADDED','DECISION_ESCALATE','DECISION_CLOSE','STATUS_CHANGED')
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
        INSERT INTO notifications (school_id, recipient_user_id, case_id, type, title, body)
        SELECT  v_case.school_id, u.user_id, v_case.case_id,
                'CASE_BROADCAST', v_title, v_body
        FROM    users u
        WHERE   u.school_id = v_case.school_id
          AND   u.role_type IN ('GURU','BK','WALI_KELAS','KAPRODI','WAKA_KESISWAAN','KEPSEK')
          AND   u.is_active  = true
          AND   u.deleted_at IS NULL
          AND   u.user_id   != NEW.author_user_id;  -- jangan notif ke diri sendiri
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION fn_notify_on_case_event() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fn_notify_on_case_event() TO service_role;

-- ── 4. Trigger ───────────────────────────────────────────────
CREATE TRIGGER trg_notify_on_case_event
    AFTER INSERT ON case_events
    FOR EACH ROW
    EXECUTE PROCEDURE fn_notify_on_case_event();

-- ── 5. RPC helper: hitung notif belum-baca ───────────────────
-- Menggantikan countNewCaseEvents (localStorage) di frontend.
CREATE OR REPLACE FUNCTION fn_count_unread_notifications()
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path TO 'public'
AS $$
    SELECT count(*)
    FROM   notifications
    WHERE  recipient_user_id = fn_current_user_id()
      AND  school_id         = fn_current_school_id()
      AND  is_read           = false;
$$;

REVOKE ALL ON FUNCTION fn_count_unread_notifications() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION fn_count_unread_notifications() TO authenticated;

-- ── 6. Guard-rail: tambah ke allowlist CHECK 4 ───────────────
-- (fn_count_unread_notifications boleh authenticated, bukan anon — sudah aman)
