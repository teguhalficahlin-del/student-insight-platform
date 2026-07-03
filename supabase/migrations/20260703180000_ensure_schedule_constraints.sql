-- ============================================================
-- Migration 20260703180000: Pastikan constraint schedule ada
--
-- Schema asli (contracts/) di-apply sebelum sistem migrasi.
-- Constraint ini dibutuhkan oleh bulk-import-schedules ON CONFLICT.
-- Menggunakan DO $$ BEGIN ... EXCEPTION END $$ agar idempotent:
-- tidak error jika constraint sudah ada.
-- ============================================================

-- uq_assignment: dipakai oleh teaching_assignments ON CONFLICT
-- (user_id, class_id, subject_id, academic_year, semester)
DO $$
BEGIN
    ALTER TABLE teaching_assignments
        ADD CONSTRAINT uq_assignment
        UNIQUE (user_id, class_id, subject_id, academic_year, semester);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN
    NULL; -- constraint sudah ada, lanjut
END $$;

-- UNIQUE untuk teaching_schedules ON CONFLICT
-- (class_id, scheduled_teacher_id, session_date, session_start)
DO $$
BEGIN
    ALTER TABLE teaching_schedules
        ADD CONSTRAINT uq_teaching_schedule_slot
        UNIQUE (class_id, scheduled_teacher_id, session_date, session_start);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN
    NULL;
END $$;
