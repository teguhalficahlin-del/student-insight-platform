-- ============================================================
-- FILE: 00_APPLY_ORDER.sql
-- PURPOSE: Master execution guide
--
-- Run files in this exact order against Supabase Postgres.
-- Each file is idempotent where possible (IF NOT EXISTS,
-- ON CONFLICT DO NOTHING). Safe to re-run on a clean DB.
--
-- PREREQUISITES:
--   - Supabase project created
--   - Connection string available (Settings > Database)
--   - Run as postgres role (owner) or service_role
-- ============================================================

-- STEP 1: Extensions + all enums
\i 00_extensions_enums.sql

-- STEP 2: Reference tables, core identity, organizational tables
--   Creates: programs, subjects, users, students, student_parents,
--            classes, class_enrollments, pkl_placements,
--            teaching_assignments, school_config
\i 01_reference_identity_org.sql

-- STEP 2b: Recurring weekly schedule templates
--   Creates: schedule_templates
\i 01b_schedule_templates.sql

-- STEP 3: Scheduling + transactional tables
--   Creates: teaching_schedules, substitute_schedules,
--            attendance, observations, achievements
\i 02_scheduling_attendance_observation.sql

-- STEP 4: Case management
--   Creates: cases, case_events
\i 03_cases.sql

-- STEP 5: Communication + teacher operations
--   Creates: parent_messages, teacher_journals,
--            teacher_attendance_log, student_updates
--   Adds: FK case_events → parent_messages
\i 04_communication_teacher_ops.sql

-- STEP 6: All triggers and functions
--   Enforces: all domain invariants (INV-1 through INV-4)
--   Implements: TN-02, TN-04, TN-07 mechanisms
\i 05_triggers_functions.sql

-- STEP 7: Row Level Security policies
--   Maps: full permission matrix from requirements
\i 06_rls_policies.sql

-- STEP 8: Composite indexes + all views
--   Creates: dashboard views, student portal views,
--            offline sync manifest views
\i 07_indexes_views.sql

-- STEP 9: Reference seed data
--   Seeds: programs, subjects
--   NOTE: Review seed data before running on production
\i 08_seed_reference.sql


-- ============================================================
-- POST-APPLY VALIDATION QUERIES
-- Run these after apply to verify correctness.
-- All should return the expected result.
-- ============================================================

-- 1. All enums exist
SELECT typname FROM pg_type
WHERE typname IN (
    'role_type','student_status','attendance_status','attendance_source',
    'meeting_status','teacher_attendance_indicator','observation_sentiment',
    'observation_dimension','visibility_level','achievement_scope',
    'achievement_category','case_status','case_track','case_event_type',
    'message_direction','message_link_type','semester'
)
ORDER BY typname;
-- Expected: 17 rows

-- 2. All tables exist
SELECT tablename FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
-- Expected: 21 tables

-- 3. All triggers exist
SELECT trigger_name, event_object_table, event_manipulation
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table, trigger_name;

-- 4. RLS enabled on all tables
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public' AND rowsecurity = FALSE;
-- Expected: 0 rows (all tables have RLS enabled)

-- 5. All views exist
SELECT viewname FROM pg_views WHERE schemaname = 'public' ORDER BY viewname;
-- Expected: 7 views

-- 6. Seed data loaded
SELECT COUNT(*) FROM programs;  -- Expected: 10
SELECT COUNT(*) FROM subjects;  -- Expected: 26
