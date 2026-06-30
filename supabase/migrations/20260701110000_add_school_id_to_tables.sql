-- ============================================================
-- FASE 1 Multi-tenant — Langkah 2: Tambah school_id ke semua tabel
-- Semua data existing di-assign ke sekolah pertama.
-- ============================================================

DO $$ BEGIN

-- ── Anchor utama ──────────────────────────────────────────────
ALTER TABLE users               ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(school_id);
ALTER TABLE students            ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(school_id);
ALTER TABLE classes             ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(school_id);
ALTER TABLE programs            ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(school_id);
ALTER TABLE subjects            ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(school_id);
ALTER TABLE academic_periods    ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(school_id);
ALTER TABLE schedule_time_slots ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(school_id);
ALTER TABLE schedule_templates  ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(school_id);
ALTER TABLE school_config       ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(school_id);

-- ── Tabel turunan ─────────────────────────────────────────────
ALTER TABLE class_enrollments    ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(school_id);
ALTER TABLE teaching_assignments ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(school_id);
ALTER TABLE teaching_schedules   ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(school_id);
ALTER TABLE attendance           ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(school_id);
ALTER TABLE pkl_placements       ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(school_id);
ALTER TABLE pkl_attendance       ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(school_id);
ALTER TABLE observations         ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(school_id);
ALTER TABLE cases                ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(school_id);
ALTER TABLE case_events          ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(school_id);
ALTER TABLE achievements         ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(school_id);
ALTER TABLE parent_messages      ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(school_id);
ALTER TABLE student_parents      ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(school_id);
ALTER TABLE substitute_schedules ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(school_id);
ALTER TABLE teacher_journals     ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(school_id);
ALTER TABLE teacher_attendance_log ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(school_id);
ALTER TABLE student_updates      ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(school_id);
ALTER TABLE sync_idempotency     ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(school_id);

END $$;

-- ── Backfill semua data existing ke sekolah pertama ───────────
UPDATE users               SET school_id = '00000000-0000-0000-0000-000000000001' WHERE school_id IS NULL;
UPDATE students            SET school_id = '00000000-0000-0000-0000-000000000001' WHERE school_id IS NULL;
UPDATE classes             SET school_id = '00000000-0000-0000-0000-000000000001' WHERE school_id IS NULL;
UPDATE programs            SET school_id = '00000000-0000-0000-0000-000000000001' WHERE school_id IS NULL;
UPDATE subjects            SET school_id = '00000000-0000-0000-0000-000000000001' WHERE school_id IS NULL;
UPDATE academic_periods    SET school_id = '00000000-0000-0000-0000-000000000001' WHERE school_id IS NULL;
UPDATE schedule_time_slots SET school_id = '00000000-0000-0000-0000-000000000001' WHERE school_id IS NULL;
UPDATE schedule_templates  SET school_id = '00000000-0000-0000-0000-000000000001' WHERE school_id IS NULL;
UPDATE school_config       SET school_id = '00000000-0000-0000-0000-000000000001' WHERE school_id IS NULL;
UPDATE class_enrollments    SET school_id = '00000000-0000-0000-0000-000000000001' WHERE school_id IS NULL;
UPDATE teaching_assignments SET school_id = '00000000-0000-0000-0000-000000000001' WHERE school_id IS NULL;
UPDATE teaching_schedules   SET school_id = '00000000-0000-0000-0000-000000000001' WHERE school_id IS NULL;
UPDATE attendance           SET school_id = '00000000-0000-0000-0000-000000000001' WHERE school_id IS NULL;
UPDATE pkl_placements       SET school_id = '00000000-0000-0000-0000-000000000001' WHERE school_id IS NULL;
UPDATE pkl_attendance       SET school_id = '00000000-0000-0000-0000-000000000001' WHERE school_id IS NULL;
UPDATE observations         SET school_id = '00000000-0000-0000-0000-000000000001' WHERE school_id IS NULL;
UPDATE cases                SET school_id = '00000000-0000-0000-0000-000000000001' WHERE school_id IS NULL;
UPDATE case_events          SET school_id = '00000000-0000-0000-0000-000000000001' WHERE school_id IS NULL;
UPDATE achievements         SET school_id = '00000000-0000-0000-0000-000000000001' WHERE school_id IS NULL;
UPDATE parent_messages      SET school_id = '00000000-0000-0000-0000-000000000001' WHERE school_id IS NULL;
UPDATE student_parents      SET school_id = '00000000-0000-0000-0000-000000000001' WHERE school_id IS NULL;
UPDATE substitute_schedules SET school_id = '00000000-0000-0000-0000-000000000001' WHERE school_id IS NULL;
UPDATE teacher_journals     SET school_id = '00000000-0000-0000-0000-000000000001' WHERE school_id IS NULL;
UPDATE teacher_attendance_log SET school_id = '00000000-0000-0000-0000-000000000001' WHERE school_id IS NULL;
UPDATE student_updates      SET school_id = '00000000-0000-0000-0000-000000000001' WHERE school_id IS NULL;
UPDATE sync_idempotency     SET school_id = '00000000-0000-0000-0000-000000000001' WHERE school_id IS NULL;

-- ── Set NOT NULL setelah backfill ─────────────────────────────
ALTER TABLE users               ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE students            ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE classes             ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE programs            ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE subjects            ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE academic_periods    ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE schedule_time_slots ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE schedule_templates  ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE school_config       ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE class_enrollments    ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE teaching_assignments ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE teaching_schedules   ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE attendance           ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE pkl_placements       ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE pkl_attendance       ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE observations         ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE cases                ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE case_events          ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE achievements         ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE parent_messages      ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE student_parents      ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE substitute_schedules ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE teacher_journals     ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE teacher_attendance_log ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE student_updates      ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE sync_idempotency     ALTER COLUMN school_id SET NOT NULL;

-- ── Index untuk performa RLS ───────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_users_school               ON users(school_id);
CREATE INDEX IF NOT EXISTS idx_students_school            ON students(school_id);
CREATE INDEX IF NOT EXISTS idx_classes_school             ON classes(school_id);
CREATE INDEX IF NOT EXISTS idx_attendance_school          ON attendance(school_id);
CREATE INDEX IF NOT EXISTS idx_observations_school        ON observations(school_id);
CREATE INDEX IF NOT EXISTS idx_teaching_schedules_school  ON teaching_schedules(school_id);
CREATE INDEX IF NOT EXISTS idx_cases_school               ON cases(school_id);
