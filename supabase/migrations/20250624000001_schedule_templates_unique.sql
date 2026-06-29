-- ============================================================
-- Add UNIQUE constraint to schedule_templates natural key.
-- Prevents duplicate weekly slots for the same
-- (academic_year, semester, day_of_week, start_time,
--  class_id, teacher_id) combination.
-- Enables native ON CONFLICT upsert in bulk-import-schedules.
-- ============================================================

ALTER TABLE schedule_templates
    ADD CONSTRAINT uq_schedule_template_slot
    UNIQUE (academic_year, semester, day_of_week, start_time, class_id, teacher_id);
