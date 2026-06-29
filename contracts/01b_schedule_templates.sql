-- ============================================================
-- FILE: 01b_schedule_templates.sql
-- LAYER: 1b — Recurring weekly schedule templates
-- APPLY ORDER: After 01_reference_identity_org.sql, before
-- 02_scheduling_attendance_observation.sql (teaching_schedules
-- generation references this table at the application layer,
-- not via FK, so strict ordering vs. 02 isn't required — but
-- it logically belongs right after classes/users exist).
-- ============================================================

-- ------------------------------------------------------------
-- TABLE: schedule_templates
-- One row = one recurring weekly slot (e.g. "every Monday
-- 07:00-07:40, class XI TAV, teacher SUSI.M"). Used by the
-- bulk-import-schedules Edge Function to generate concrete
-- teaching_schedules rows for every matching date within an
-- academic_periods date range.
-- ------------------------------------------------------------
CREATE TABLE schedule_templates (
    template_id     UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    academic_year   VARCHAR(9)   NOT NULL,
    semester        semester     NOT NULL,
    day_of_week     day_of_week  NOT NULL,
    start_time      TIME         NOT NULL,
    end_time        TIME         NOT NULL,
    class_id        UUID         NOT NULL REFERENCES classes(class_id) ON DELETE RESTRICT,
    teacher_id      UUID         NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_schedule_time CHECK (end_time > start_time)
);

CREATE INDEX idx_schedule_templates_teacher ON schedule_templates(teacher_id, day_of_week);
CREATE INDEX idx_schedule_templates_class   ON schedule_templates(class_id, academic_year, semester);

COMMENT ON TABLE schedule_templates IS
    'Recurring weekly schedule slot. bulk-import-schedules expands each row into '
    'concrete teaching_schedules rows for every date in the active academic_periods '
    'range matching day_of_week.';
