-- Hapus constraint duplikat di teaching_schedules.
-- uq_schedule_slot dan uq_teaching_schedule_slot punya kolom identik:
-- (class_id, scheduled_teacher_id, session_date, session_start).
-- Cukup satu; sisakan uq_teaching_schedule_slot.

ALTER TABLE teaching_schedules DROP CONSTRAINT IF EXISTS uq_schedule_slot;
