-- ============================================================
-- FILE: 02_scheduling_attendance_observation.sql
-- LAYERS: 4 (scheduling), 5 (transactional)
-- APPLY ORDER: After 01_reference_identity_org.sql
-- ============================================================


-- ============================================================
-- LAYER 4 — SCHEDULING
-- ============================================================

-- ------------------------------------------------------------
-- TABLE: teaching_schedules
-- Defines a specific teaching session (date + time + class).
-- Each row = one meeting slot. Drives attendance records.
-- ------------------------------------------------------------
CREATE TABLE teaching_schedules (
    schedule_id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- Nullable for legacy rows only. Since RC-1 (bulk-import-schedules v2.2.0),
    -- all CSV-imported schedules are generated with assignment_id populated.
    -- Rows without assignment_id are not writable via any active code path.
    assignment_id       UUID            REFERENCES teaching_assignments(assignment_id) ON DELETE RESTRICT,
    class_id            UUID            NOT NULL REFERENCES classes(class_id) ON DELETE RESTRICT,
    -- Nullable for legacy rows only. Since RC-1, all CSV-imported schedules
    -- carry subject_id populated from the kode_mapel column in the import CSV.
    -- subject_id is enforced at the pipeline layer (bulk-import-schedules v2.2.0+).
    subject_id          UUID            REFERENCES subjects(subject_id) ON DELETE RESTRICT,
    scheduled_teacher_id UUID           NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    session_date        DATE            NOT NULL,
    session_start       TIME            NOT NULL,
    session_end         TIME            NOT NULL,
    -- Set by teacher or system when session begins/closes
    meeting_status      meeting_status  NOT NULL DEFAULT 'NORMAL',
    -- TN-02: computed server-side after session window closes
    teacher_indicator   teacher_attendance_indicator NOT NULL DEFAULT 'PENDING_EVALUATION',
    academic_year       VARCHAR(9)      NOT NULL,
    semester            semester        NOT NULL,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_session_time CHECK (session_end > session_start),

    -- One schedule per assignment per date (a teacher cannot teach same class twice on same day for same subject).
    -- Only meaningful when assignment_id is set (assignment-driven schedules).
    CONSTRAINT uq_schedule_per_assignment_date
        UNIQUE (assignment_id, session_date),

    -- One schedule per class+teacher+date+start_time, regardless of assignment_id.
    -- Required as the ON CONFLICT target for CSV-imported schedules
    -- (bulk-import-schedules), which have no assignment_id to dedupe on.
    CONSTRAINT uq_schedule_slot
        UNIQUE (class_id, scheduled_teacher_id, session_date, session_start)
);

CREATE INDEX idx_schedules_class_date   ON teaching_schedules(class_id, session_date);
CREATE INDEX idx_schedules_teacher_date ON teaching_schedules(scheduled_teacher_id, session_date);
CREATE INDEX idx_schedules_date         ON teaching_schedules(session_date);

COMMENT ON TABLE teaching_schedules IS
    'One row = one teaching session. meeting_status and teacher_indicator are '
    'the two state fields for the session-level domain. teacher_indicator is '
    'server-computed (TN-02), never written by client.';


-- ------------------------------------------------------------
-- TABLE: substitute_schedules
-- When a teacher is absent and a substitute is assigned.
-- Must be synced to substitute device at or before grant time (TN-07).
-- A substitute_schedule does not replace the teaching_schedule —
-- it overlays it.
-- ------------------------------------------------------------
CREATE TABLE substitute_schedules (
    substitute_id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    schedule_id         UUID        NOT NULL REFERENCES teaching_schedules(schedule_id) ON DELETE RESTRICT,
    substitute_user_id  UUID        NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    granted_by_user_id  UUID        NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    granted_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Offline sync: token expires at end of session_date
    sync_token          TEXT        NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
    sync_token_expires_at TIMESTAMPTZ NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Only one substitute per schedule
    CONSTRAINT uq_substitute_per_schedule UNIQUE (schedule_id)
);

CREATE INDEX idx_substitute_user  ON substitute_schedules(substitute_user_id);
CREATE INDEX idx_substitute_sched ON substitute_schedules(schedule_id);

COMMENT ON TABLE substitute_schedules IS
    'TN-07: Substitute assignment. sync_token used for offline device auth. '
    'Must be pushed to substitute device at grant time. Token expires at session end.';

-- Substitute cannot be the original teacher.
-- Enforced via trigger because CHECK constraints cannot use subqueries.
CREATE OR REPLACE FUNCTION trg_substitute_not_original() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.substitute_user_id = (
        SELECT scheduled_teacher_id FROM teaching_schedules WHERE schedule_id = NEW.schedule_id
    ) THEN
        RAISE EXCEPTION 'substitute_user_id cannot match the original scheduled teacher';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_substitute_not_original_check
    BEFORE INSERT OR UPDATE ON substitute_schedules
    FOR EACH ROW EXECUTE FUNCTION trg_substitute_not_original();


-- ============================================================
-- LAYER 5 — TRANSACTIONAL
-- ============================================================

-- ------------------------------------------------------------
-- TABLE: attendance
-- Composite identity: (schedule_id, student_id).
-- Default on creation: status = HADIR, source = AUTO_DETECTED.
-- Invariants:
--   - GURU_TIDAK_HADIR → all records for session voided
--   - KEGIATAN_SEKOLAH → no records created
-- Voided records: is_void = TRUE, NOT deleted.
-- ------------------------------------------------------------
CREATE TABLE attendance (
    attendance_id       UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),
    schedule_id         UUID              NOT NULL REFERENCES teaching_schedules(schedule_id) ON DELETE RESTRICT,
    student_id          UUID              NOT NULL REFERENCES students(student_id) ON DELETE RESTRICT,
    status              attendance_status NOT NULL DEFAULT 'HADIR',
    source              attendance_source NOT NULL DEFAULT 'AUTO_DETECTED',
    is_void             BOOLEAN           NOT NULL DEFAULT FALSE,
    void_reason         TEXT,
    recorded_by_user_id UUID              NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    notes               TEXT,
    created_at          TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ       NOT NULL DEFAULT NOW(),

    -- One attendance record per student per session
    CONSTRAINT uq_attendance_per_session UNIQUE (schedule_id, student_id),

    -- void_reason required when voided
    CONSTRAINT chk_void_reason CHECK (is_void = FALSE OR void_reason IS NOT NULL)
);

CREATE INDEX idx_attendance_schedule ON attendance(schedule_id);
CREATE INDEX idx_attendance_student  ON attendance(student_id, schedule_id);
CREATE INDEX idx_attendance_date     ON attendance(schedule_id) INCLUDE (student_id, status);

COMMENT ON TABLE attendance IS
    'Student attendance per session. Default: HADIR / AUTO_DETECTED. '
    'is_void = TRUE for sessions where meeting_status = GURU_TIDAK_HADIR. '
    'Records are never deleted — only voided.';


-- ------------------------------------------------------------
-- TABLE: observations
-- Exception-based. Visibility default asymmetric:
--   POSITIF → STUDENT_VISIBLE (default)
--   NEGATIF → INTERNAL_SCHOOL (default)
-- Visibility is set at creation time only (TN: enforced via trigger).
-- ------------------------------------------------------------
CREATE TABLE observations (
    observation_id      UUID                 PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id          UUID                 NOT NULL REFERENCES students(student_id) ON DELETE RESTRICT,
    author_user_id      UUID                 NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    sentiment           observation_sentiment NOT NULL,
    dimension           observation_dimension NOT NULL,
    content             TEXT                 NOT NULL CHECK (length(content) BETWEEN 10 AND 1000),
    visibility          visibility_level     NOT NULL,
    -- Flag when NEGATIF is published as STUDENT_VISIBLE (audit, not a block)
    visibility_override_flag BOOLEAN         NOT NULL DEFAULT FALSE,
    class_id            UUID                 REFERENCES classes(class_id) ON DELETE RESTRICT,
    schedule_id         UUID                 REFERENCES teaching_schedules(schedule_id) ON DELETE RESTRICT,
    observed_at         DATE                 NOT NULL DEFAULT CURRENT_DATE,
    created_at          TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ          NOT NULL DEFAULT NOW(),

    -- Visibility locked after creation (enforced via trigger trg_observation_visibility_immutable)
    CONSTRAINT chk_content_not_blank CHECK (trim(content) <> '')
);

CREATE INDEX idx_observations_student   ON observations(student_id, observed_at DESC);
CREATE INDEX idx_observations_author    ON observations(author_user_id);
CREATE INDEX idx_observations_student_visible
    ON observations(student_id)
    WHERE visibility = 'STUDENT_VISIBLE' AND sentiment = 'POSITIF';

COMMENT ON TABLE observations IS
    'Exception-based observations. Visibility default: POSITIF→STUDENT_VISIBLE, NEGATIF→INTERNAL_SCHOOL. '
    'Visibility is immutable after creation (trigger: trg_observation_visibility_immutable). '
    'visibility_override_flag = TRUE triggers an audit log entry when NEGATIF is set STUDENT_VISIBLE.';


-- ------------------------------------------------------------
-- TABLE: achievements
-- Formal achievements. Always STUDENT_VISIBLE.
-- Only WALI_KELAS or KAPRODI may create.
-- Cannot be deleted — only voided with reason.
-- ------------------------------------------------------------
CREATE TABLE achievements (
    achievement_id      UUID                 PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id          UUID                 NOT NULL REFERENCES students(student_id) ON DELETE RESTRICT,
    recorded_by_user_id UUID                 NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    title               VARCHAR(200)         NOT NULL,
    description         TEXT,
    category            achievement_category NOT NULL,
    scope               achievement_scope    NOT NULL,
    achieved_at         DATE                 NOT NULL,
    -- Achievements cannot be deleted, only voided
    is_voided           BOOLEAN              NOT NULL DEFAULT FALSE,
    voided_at           TIMESTAMPTZ,
    void_reason         TEXT,
    created_at          TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ          NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_achievement_void
        CHECK (is_voided = FALSE OR (voided_at IS NOT NULL AND void_reason IS NOT NULL)),

    CONSTRAINT chk_title_not_blank CHECK (trim(title) <> '')
);

CREATE INDEX idx_achievements_student ON achievements(student_id, achieved_at DESC) WHERE is_voided = FALSE;

COMMENT ON TABLE achievements IS
    'Formal achievements. Always STUDENT_VISIBLE — no visibility column. '
    'Creatable only by WALI_KELAS or KAPRODI (enforced via RLS). '
    'Deletions prohibited — use is_voided + void_reason.';
