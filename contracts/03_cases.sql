-- ============================================================
-- FILE: 03_cases.sql
-- LAYER: 6 — Case Management
-- APPLY ORDER: After 02_scheduling_attendance_observation.sql
-- ============================================================
--
-- DESIGN NOTES:
--
-- cases: aggregate root. Two denormalized fields:
--   current_handler_role — maintained by trigger trg_case_sync_handler
--   is_locked            — maintained by trigger trg_case_sync_handler
-- Both fields must never be written directly by the application.
--
-- case_events: append-only event log. UPDATE and DELETE are
-- blocked by trigger trg_case_events_immutable.
--
-- Invariants enforced:
--   INV-1: trigger trg_case_events_no_closed blocks any INSERT
--           on case_events when case.status = CLOSED
--   INV-2: application layer validates DECISION_ESCALATE changes handler
--   INV-3: trigger trg_case_sync_handler keeps current_handler_role non-null
--   INV-4: RLS + trigger blocks COMMENT_ADDED when locked
--           for non-current-handler; FINAL_DECISION_MADE always passes
-- ============================================================


-- ------------------------------------------------------------
-- TABLE: cases
-- Aggregate root for Case Management bounded context.
--
-- initiated_by_role: immutable. Who opened the case.
-- current_handler_role: denormalized, synced by trigger.
-- is_locked: denormalized, synced by trigger.
-- track: SEKOLAH or PKL — determines escalation chain.
-- ------------------------------------------------------------
CREATE TABLE cases (
    case_id                 UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id              UUID         NOT NULL REFERENCES students(student_id) ON DELETE RESTRICT,
    created_by_user_id      UUID         NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,

    -- Immutable after creation (trigger: trg_case_initiated_by_immutable)
    initiated_by_role       role_type    NOT NULL,

    -- Denormalized. Maintained by trigger trg_case_sync_handler.
    -- Application must never write this directly.
    current_handler_role    role_type    NOT NULL,

    -- Denormalized. Maintained by trigger trg_case_sync_handler.
    is_locked               BOOLEAN      NOT NULL DEFAULT FALSE,
    locked_by_user_id       UUID         REFERENCES users(user_id) ON DELETE RESTRICT,
    locked_at               TIMESTAMPTZ,

    status                  case_status  NOT NULL DEFAULT 'OPEN',
    track                   case_track   NOT NULL,
    title                   VARCHAR(200) NOT NULL,
    description             TEXT         NOT NULL CHECK (length(description) >= 20),

    -- Audiens per-kasus (ala-FB), diatur pembuat/penangan (mig 20260703250000).
    -- PRIVATE (default; lahir privat) / RESTRICTED (case_audience_members) /
    -- PUBLIC (semua aktor internal kasus). DUDI selalu PRIVATE.
    audience                case_audience NOT NULL DEFAULT 'PRIVATE',

    -- Closed metadata (populated by DECISION_CLOSE or FINAL_DECISION_MADE)
    closed_at               TIMESTAMPTZ,
    closed_by_user_id       UUID         REFERENCES users(user_id) ON DELETE RESTRICT,

    created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_case_title_not_blank CHECK (trim(title) <> ''),

    -- When locked, locked_by and locked_at must be set
    CONSTRAINT chk_lock_metadata
        CHECK (is_locked = FALSE OR (locked_by_user_id IS NOT NULL AND locked_at IS NOT NULL)),

    -- When closed, closed metadata must be set
    CONSTRAINT chk_closed_metadata
        CHECK (status != 'CLOSED' OR (closed_at IS NOT NULL AND closed_by_user_id IS NOT NULL)),

    -- INV-3 enforced here as NOT NULL on current_handler_role (already above)
    -- Additional check: CLOSED cases may have null handler (safe state after close)
    CONSTRAINT chk_handler_not_null_when_open
        CHECK (status = 'CLOSED' OR current_handler_role IS NOT NULL)
);

CREATE INDEX idx_cases_student     ON cases(student_id, status);
CREATE INDEX idx_cases_handler     ON cases(current_handler_role, status) WHERE status != 'CLOSED';
CREATE INDEX idx_cases_status      ON cases(status);
CREATE INDEX idx_cases_created_by  ON cases(created_by_user_id);

COMMENT ON TABLE cases IS
    'Case aggregate root. current_handler_role and is_locked are denormalized — '
    'maintained by trigger trg_case_sync_handler. Never write these directly. '
    'initiated_by_role is immutable after creation.';
COMMENT ON COLUMN cases.current_handler_role IS
    'TN-04: Denormalized from last DECISION_ESCALATE or FINAL_DECISION_MADE event. '
    'Maintained by trigger. INV-3: must be non-null while status != CLOSED.';
COMMENT ON COLUMN cases.is_locked IS
    'TN-04: Denormalized from last CASE_LOCKED/CASE_UNLOCKED event. '
    'INV-4: when TRUE, COMMENT_ADDED blocked for non-current-handler.';


-- ------------------------------------------------------------
-- TABLE: case_events
-- Append-only event log. UPDATE and DELETE are blocked by trigger.
--
-- author_user_id: the actor who triggered the event.
-- author_role_at_time: snapshot of their role at event time.
--   Stored because roles could theoretically change.
-- new_handler_role: populated only for DECISION_ESCALATE.
--   Must differ from previous handler (INV-2) — validated in app.
-- privacy_level: per-event, not per-case.
-- payload: JSONB for event-type-specific data (content, notes, etc.)
-- ------------------------------------------------------------
CREATE TABLE case_events (
    event_id                UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_id                 UUID              NOT NULL REFERENCES cases(case_id) ON DELETE RESTRICT,
    event_type              case_event_type   NOT NULL,
    author_user_id          UUID              NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    author_role_at_time     role_type         NOT NULL,  -- snapshot
    privacy_level           visibility_level  NOT NULL DEFAULT 'INTERNAL_SCHOOL',

    -- Populated for DECISION_ESCALATE (INV-2: must differ from previous handler)
    previous_handler_role   role_type,
    new_handler_role        role_type,

    -- Populated for STATUS_CHANGED, DECISION_ESCALATE, DECISION_CLOSE, FINAL_DECISION_MADE
    previous_status         case_status,
    new_status              case_status,

    -- Populated for PARENT_MESSAGE_LINKED, PARENT_MESSAGE_RECEIVED, PARENT_REPLY_SENT
    parent_message_id       UUID,   -- FK added after parent_messages table created

    -- Flexible payload for event-type-specific data:
    -- COMMENT_ADDED: { "text": "..." }
    -- STUDENT_UPDATE_ADDED: { "text": "..." }
    -- DECISION_ESCALATE: { "reason": "..." }
    -- DECISION_CLOSE: { "summary": "...", "outcome": "..." }
    -- FINAL_DECISION_MADE: { "decision": "...", "notes": "..." }
    -- CASE_LOCKED/UNLOCKED: { "reason": "..." }
    payload                 JSONB             NOT NULL DEFAULT '{}',

    -- INV-2 enforcement helper: for DECISION_ESCALATE, new != previous
    CONSTRAINT chk_escalate_handler_differs
        CHECK (
            event_type != 'DECISION_ESCALATE'
            OR (new_handler_role IS NOT NULL
                AND previous_handler_role IS NOT NULL
                AND new_handler_role != previous_handler_role)
        ),

    -- DECISION_ESCALATE must have new_handler_role populated
    CONSTRAINT chk_escalate_has_handler
        CHECK (event_type != 'DECISION_ESCALATE' OR new_handler_role IS NOT NULL),

    -- STUDENT_UPDATE_ADDED is always STUDENT_VISIBLE
    CONSTRAINT chk_student_update_visibility
        CHECK (event_type != 'STUDENT_UPDATE_ADDED' OR privacy_level = 'STUDENT_VISIBLE'),

    created_at              TIMESTAMPTZ       NOT NULL DEFAULT NOW()
    -- No updated_at: this table is append-only. UPDATE blocked by trigger.
);

CREATE INDEX idx_case_events_case     ON case_events(case_id, created_at DESC);
CREATE INDEX idx_case_events_author   ON case_events(author_user_id);
CREATE INDEX idx_case_events_type     ON case_events(case_id, event_type);
CREATE INDEX idx_case_events_visible  ON case_events(case_id, privacy_level);

COMMENT ON TABLE case_events IS
    'Append-only event log. UPDATE and DELETE blocked by trigger trg_case_events_immutable. '
    'INV-1: INSERT blocked when case.status = CLOSED (trigger trg_case_events_no_closed). '
    'INV-2: chk_escalate_handler_differs enforces handler change on DECISION_ESCALATE. '
    'STUDENT_UPDATE_ADDED is always STUDENT_VISIBLE (constraint). '
    'payload is JSONB — schema validated at application layer.';


-- ------------------------------------------------------------
-- TABLE: case_audience_members  (mig 20260703250000)
-- Penonton pilihan untuk kasus beraudiens RESTRICTED ("orang tertentu").
-- Hanya aktor internal kasus yang boleh jadi anggota
-- (dijaga RLS via fn_user_is_internal_case_actor).
-- ------------------------------------------------------------
CREATE TABLE case_audience_members (
    case_id          UUID        NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
    user_id          UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    school_id        UUID        NOT NULL,
    added_by_user_id UUID        REFERENCES users(user_id) ON DELETE SET NULL,
    added_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (case_id, user_id)
);
CREATE INDEX idx_case_audience_user ON case_audience_members(user_id);
CREATE INDEX idx_case_audience_case ON case_audience_members(case_id);
