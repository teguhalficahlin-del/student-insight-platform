-- ============================================================
-- FILE: 04_communication_teacher_ops.sql
-- LAYERS: 7 (communication), 8 (teacher operations)
-- APPLY ORDER: After 03_cases.sql
-- ============================================================


-- ============================================================
-- LAYER 7 — COMMUNICATION
-- ============================================================

-- ------------------------------------------------------------
-- TABLE: parent_messages
-- Aggregate root for parent-initiated communication.
--
-- Visibility is per-row by actor list (TN-08):
--   visible_to_user_ids: UUID[] — the explicit list of user_id
--   values who can see this message. RLS policy uses:
--   auth.uid() = ANY(visible_to_user_ids)
--
-- Only ORTU users can create INBOUND messages.
-- link_type: STANDALONE or CASE_LINKED.
-- When CASE_LINKED, a PARENT_MESSAGE_LINKED event is appended
-- to the referenced case (done at application layer in a
-- single transaction).
--
-- INV-4: INBOUND messages cannot be created when linked case
--         is locked (enforced via trigger trg_parent_msg_lock_check).
-- ------------------------------------------------------------
CREATE TABLE parent_messages (
    message_id          UUID                PRIMARY KEY DEFAULT uuid_generate_v4(),
    sender_user_id      UUID                NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    student_id          UUID                NOT NULL REFERENCES students(student_id) ON DELETE RESTRICT,
    direction           message_direction   NOT NULL,
    link_type           message_link_type   NOT NULL DEFAULT 'STANDALONE',
    case_id             UUID                REFERENCES cases(case_id) ON DELETE RESTRICT,

    -- TN-08: Selective visibility by actor list. NOT role-based.
    -- Application populates this at creation time.
    -- RLS: auth.uid() = ANY(visible_to_user_ids)
    visible_to_user_ids UUID[]              NOT NULL DEFAULT '{}',

    subject             VARCHAR(200),
    body                TEXT                NOT NULL CHECK (length(body) >= 1),
    -- For OUTBOUND: which INBOUND message this replies to
    reply_to_message_id UUID                REFERENCES parent_messages(message_id) ON DELETE RESTRICT,

    created_at          TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ         NOT NULL DEFAULT NOW(),

    -- CASE_LINKED requires a case_id
    CONSTRAINT chk_case_linked_has_case
        CHECK (link_type != 'CASE_LINKED' OR case_id IS NOT NULL),

    -- OUTBOUND messages must have a reply_to (always a response to an INBOUND)
    CONSTRAINT chk_outbound_has_reply_target
        CHECK (direction != 'OUTBOUND' OR reply_to_message_id IS NOT NULL),

    -- Visibility list must not be empty
    CONSTRAINT chk_visible_to_not_empty
        CHECK (array_length(visible_to_user_ids, 1) > 0)
);

CREATE INDEX idx_parent_msg_sender   ON parent_messages(sender_user_id);
CREATE INDEX idx_parent_msg_student  ON parent_messages(student_id);
CREATE INDEX idx_parent_msg_case     ON parent_messages(case_id) WHERE case_id IS NOT NULL;
-- GIN index for the UUID array — enables efficient RLS policy evaluation
CREATE INDEX idx_parent_msg_visible  ON parent_messages USING GIN(visible_to_user_ids);

COMMENT ON TABLE parent_messages IS
    'Parent communication. TN-08: visibility is per-row UUID array, not role-based. '
    'RLS: auth.uid() = ANY(visible_to_user_ids). '
    'INV-4: INBOUND blocked when linked case is_locked (trigger trg_parent_msg_lock_check). '
    'CASE_LINKED messages generate a case_events row in same transaction.';

-- Add FK from case_events.parent_message_id now that parent_messages exists
ALTER TABLE case_events
    ADD CONSTRAINT fk_case_events_parent_message
    FOREIGN KEY (parent_message_id)
    REFERENCES parent_messages(message_id)
    ON DELETE RESTRICT;


-- ============================================================
-- LAYER 8 — TEACHER OPERATIONS
-- ============================================================

-- ------------------------------------------------------------
-- TABLE: teacher_journals
-- Private to the owning user. No shared read path whatsoever.
-- RLS: strict — auth.uid() = (SELECT auth_user_id FROM users WHERE user_id = owner_user_id)
-- Not exposed via any API endpoint that serves other roles.
-- ------------------------------------------------------------
CREATE TABLE teacher_journals (
    journal_id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_user_id       UUID        NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    schedule_id         UUID        REFERENCES teaching_schedules(schedule_id) ON DELETE RESTRICT,
    class_id            UUID        REFERENCES classes(class_id) ON DELETE RESTRICT,
    entry_date          DATE        NOT NULL DEFAULT CURRENT_DATE,
    content             TEXT        NOT NULL CHECK (length(content) >= 1),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_journals_owner ON teacher_journals(owner_user_id, entry_date DESC);

COMMENT ON TABLE teacher_journals IS
    'Private teacher journal. No shared read access. '
    'RLS policy: owner only (auth.uid() matches owner_user_id). '
    'Offline Category A: synced to teacher device, never exposed to other roles.';


-- ------------------------------------------------------------
-- TABLE: teacher_attendance_log
-- Stores the system-activity signals used to derive
-- TeacherAttendanceIndicator. This is NOT a human-input table.
-- Written only by system processes (edge functions, triggers).
-- The derived indicator is stored on teaching_schedules.teacher_indicator.
--
-- activity_type: what kind of system activity was detected.
--   Drives the PENDING_EVALUATION → HADIR transition (TN-02).
-- ------------------------------------------------------------
CREATE TABLE teacher_attendance_log (
    log_id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    schedule_id         UUID        NOT NULL REFERENCES teaching_schedules(schedule_id) ON DELETE RESTRICT,
    user_id             UUID        NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    activity_type       VARCHAR(50) NOT NULL CHECK (activity_type IN (
                            'ATTENDANCE_SUBMITTED',
                            'OBSERVATION_CREATED',
                            'JOURNAL_ENTRY_CREATED',
                            'SUBSTITUTE_ATTENDANCE_SUBMITTED'
                        )),
    activity_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    -- No updated_at: append-only signal log
);

CREATE INDEX idx_teacher_att_log_schedule ON teacher_attendance_log(schedule_id);
CREATE INDEX idx_teacher_att_log_user     ON teacher_attendance_log(user_id, activity_at DESC);

COMMENT ON TABLE teacher_attendance_log IS
    'TN-02: System-activity signals for deriving teacher_indicator. '
    'Written only by system (edge functions / triggers after DML on attendance, '
    'observations, teacher_journals). Never written by client directly. '
    'Edge function trg_evaluate_teacher_indicator runs after session window closes '
    'and updates teaching_schedules.teacher_indicator from PENDING_EVALUATION to '
    'HADIR or TIDAK_HADIR based on whether any log rows exist for that schedule.';


-- ------------------------------------------------------------
-- TABLE: student_updates
-- Optional narrative update authored by current_handler_role.
-- Linked to a case. Always STUDENT_VISIBLE.
-- Falls back to generic text per case_status if no row exists.
-- Stored separately from case_events for clean retrieval,
-- but also generates a STUDENT_UPDATE_ADDED case_event
-- in the same transaction.
-- ------------------------------------------------------------
CREATE TABLE student_updates (
    update_id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_id             UUID        NOT NULL REFERENCES cases(case_id) ON DELETE RESTRICT,
    author_user_id      UUID        NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    content             TEXT        NOT NULL CHECK (length(content) >= 10),
    -- Links to the corresponding case_events row
    case_event_id       UUID        REFERENCES case_events(event_id) ON DELETE RESTRICT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_student_updates_case ON student_updates(case_id, created_at DESC);

COMMENT ON TABLE student_updates IS
    'Optional narrative for student-facing case view. Always STUDENT_VISIBLE. '
    'Authored by current_handler_role only. '
    'Generating a student_update also appends a STUDENT_UPDATE_ADDED case_event '
    'in the same transaction. If no update exists for a case, client falls back '
    'to generic text keyed on case.status.';
