-- ============================================================
-- FILE: 06_rls_policies.sql
-- LAYER: RLS — Row Level Security
-- APPLY ORDER: After 05_triggers_functions.sql
--
-- STRATEGY:
--   1. Enable RLS on all tables
--   2. Default: deny all (no permissive policy = no access)
--   3. Policies map directly from the permission matrix
--   4. Helper function fn_current_user_role() used throughout
--   5. Service-role bypass handled by Supabase service key
--      (service key bypasses RLS — used only by Edge Functions)
--
-- NAMING CONVENTION:
--   rls_{table}_{action}_{role_or_scope}
-- ============================================================


-- ============================================================
-- HELPER FUNCTIONS
-- Called inside policy expressions. Must be SECURITY DEFINER
-- and STABLE to be usable in RLS.
-- ============================================================

-- Returns the role_type of the authenticated user
CREATE OR REPLACE FUNCTION fn_current_user_role()
RETURNS role_type
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT role_type FROM users WHERE auth_user_id = auth.uid();
$$;

-- Returns the user_id of the authenticated user
CREATE OR REPLACE FUNCTION fn_current_user_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT user_id FROM users WHERE auth_user_id = auth.uid();
$$;

-- Returns TRUE if the current user has an active teaching assignment
-- for the given class (used for GURU case visibility — † condition)
CREATE OR REPLACE FUNCTION fn_has_assignment_for_class(p_class_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT EXISTS (
        SELECT 1 FROM teaching_assignments
        WHERE user_id    = fn_current_user_id()
          AND class_id   = p_class_id
          AND is_active  = TRUE
    );
$$;

-- Returns TRUE if the current DUDI user supervises this student
CREATE OR REPLACE FUNCTION fn_dudi_supervises_student(p_student_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT EXISTS (
        SELECT 1 FROM pkl_placements
        WHERE student_id   = p_student_id
          AND dudi_user_id = fn_current_user_id()
          AND is_active    = TRUE
    );
$$;

-- Returns the class_id of the current WALI_KELAS user
CREATE OR REPLACE FUNCTION fn_wali_kelas_class_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT wali_kelas_class_id FROM users WHERE auth_user_id = auth.uid();
$$;

-- Returns TRUE if the current user has ever been involved in a case
-- (is current_handler_role OR created_by OR has authored a case_event)
CREATE OR REPLACE FUNCTION fn_involved_in_case(p_case_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT EXISTS (
        SELECT 1 FROM cases
        WHERE case_id          = p_case_id
          AND created_by_user_id = fn_current_user_id()
    )
    OR EXISTS (
        SELECT 1 FROM case_events
        WHERE case_id        = p_case_id
          AND author_user_id = fn_current_user_id()
    );
$$;


-- ============================================================
-- ENABLE RLS ON ALL TABLES
-- ============================================================

ALTER TABLE programs                ENABLE ROW LEVEL SECURITY;
ALTER TABLE subjects                ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE students                ENABLE ROW LEVEL SECURITY;
ALTER TABLE classes                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_enrollments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE pkl_placements          ENABLE ROW LEVEL SECURITY;
ALTER TABLE teaching_assignments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE teaching_schedules      ENABLE ROW LEVEL SECURITY;
ALTER TABLE substitute_schedules    ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance              ENABLE ROW LEVEL SECURITY;
ALTER TABLE observations            ENABLE ROW LEVEL SECURITY;
ALTER TABLE achievements            ENABLE ROW LEVEL SECURITY;
ALTER TABLE cases                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_events             ENABLE ROW LEVEL SECURITY;
ALTER TABLE parent_messages         ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_journals        ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_attendance_log  ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_updates         ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_parents         ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_config           ENABLE ROW LEVEL SECURITY;
ALTER TABLE academic_periods        ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_templates      ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- REFERENCE TABLES: programs, subjects, classes
-- All authenticated staff can read. Only KEPSEK/KAPRODI write.
-- ============================================================

CREATE POLICY rls_programs_read_all ON programs
    FOR SELECT USING (auth.uid() IS NOT NULL);

-- ADMINISTRATIVE ditambahkan via migration
-- 20260629130000_allow_administrative_write_programs.sql agar TU dapat
-- menambah/menghapus program keahlian langsung dari wizard onboarding.
CREATE POLICY rls_programs_write_admin ON programs
    FOR ALL
    USING      (fn_current_user_role() IN ('KEPSEK', 'KAPRODI', 'ADMINISTRATIVE'))
    WITH CHECK (fn_current_user_role() IN ('KEPSEK', 'KAPRODI', 'ADMINISTRATIVE'));

CREATE POLICY rls_subjects_read_all ON subjects
    FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY rls_subjects_write_admin ON subjects
    FOR ALL USING (fn_current_user_role() IN ('KEPSEK', 'KAPRODI'));

CREATE POLICY rls_classes_read_all ON classes
    FOR SELECT USING (auth.uid() IS NOT NULL);

-- Write (INSERT/UPDATE/DELETE) restricted to ADMINISTRATIVE only.
-- KEPSEK/KAPRODI keep read access via rls_classes_read_all above.
CREATE POLICY rls_classes_write_admin ON classes
    FOR ALL USING (fn_current_user_role() = 'ADMINISTRATIVE');


-- ============================================================
-- USERS TABLE
-- Staff: can read all users (needed for case/assignment display).
-- SISWA: can only read their own user row.
-- ORTU: can only read their own row + teacher users (for messaging).
-- Write: only KEPSEK/KAPRODI (via service role for provisioning).
-- ============================================================

CREATE POLICY rls_users_read_staff ON users
    FOR SELECT USING (
        fn_current_user_role() IN ('GURU', 'BK', 'WALI_KELAS', 'KAPRODI', 'KEPSEK', 'DUDI')
    );

CREATE POLICY rls_users_read_own ON users
    FOR SELECT USING (auth_user_id = auth.uid());

CREATE POLICY rls_users_update_own ON users
    FOR UPDATE USING (auth_user_id = auth.uid())
    WITH CHECK (
        -- Users cannot change their own role_type
        role_type = (SELECT role_type FROM users WHERE auth_user_id = auth.uid())
    );


-- ============================================================
-- STUDENTS TABLE
-- Staff roles: read all active students.
-- DUDI: only students in their PKL batch.
-- SISWA: own record only.
-- ORTU: their linked student only.
-- ============================================================

CREATE POLICY rls_students_read_staff ON students
    FOR SELECT USING (
        fn_current_user_role() IN ('GURU', 'BK', 'WALI_KELAS', 'KAPRODI', 'KEPSEK')
    );

CREATE POLICY rls_students_read_dudi ON students
    FOR SELECT USING (
        fn_current_user_role() = 'DUDI'
        AND fn_dudi_supervises_student(student_id)
    );

CREATE POLICY rls_students_read_own ON students
    FOR SELECT USING (
        fn_current_user_role() = 'SISWA'
        AND user_id = fn_current_user_id()
    );

CREATE POLICY rls_students_read_parent ON students
    FOR SELECT USING (
        fn_current_user_role() = 'ORTU'
        AND EXISTS (
            SELECT 1 FROM student_parents sp
            WHERE sp.student_id     = students.student_id
              AND sp.parent_user_id = fn_current_user_id()
        )
    );

CREATE POLICY rls_students_write_admin ON students
    FOR ALL USING (fn_current_user_role() IN ('KEPSEK', 'KAPRODI'));


-- ============================================================
-- ATTENDANCE
-- GURU: read/write for their assigned classes.
-- Substitute: read/write for their substitute_schedule sessions.
-- BK, WALI_KELAS, KAPRODI, KEPSEK: read all.
-- SISWA: read own records (non-void only).
-- ORTU: read records of their linked children (non-void only).
-- ============================================================

CREATE POLICY rls_attendance_read_staff ON attendance
    FOR SELECT USING (
        fn_current_user_role() IN ('BK', 'WALI_KELAS', 'KAPRODI', 'KEPSEK')
    );

CREATE POLICY rls_attendance_rw_guru ON attendance
    FOR ALL USING (
        fn_current_user_role() IN ('GURU', 'WALI_KELAS')
        AND EXISTS (
            SELECT 1 FROM teaching_schedules ts
            JOIN teaching_assignments ta ON ta.assignment_id = ts.assignment_id
            WHERE ts.schedule_id = attendance.schedule_id
              AND ta.user_id     = fn_current_user_id()
              AND ta.is_active   = TRUE
        )
    );

CREATE POLICY rls_attendance_rw_substitute ON attendance
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM substitute_schedules ss
            WHERE ss.schedule_id       = attendance.schedule_id
              AND ss.substitute_user_id = fn_current_user_id()
              AND ss.sync_token_expires_at > NOW()
        )
    );

CREATE POLICY rls_attendance_read_student ON attendance
    FOR SELECT USING (
        fn_current_user_role() = 'SISWA'
        AND student_id = (
            SELECT student_id FROM students WHERE user_id = fn_current_user_id()
        )
        AND is_void = FALSE
    );

-- ORTU: kehadiran tiap anak yang tertaut lewat student_parents (non-void).
-- Satu login melihat semua anak — cakupan diresolusikan via student_parents,
-- pola yang sama dengan rls_students_read_parent.
CREATE POLICY rls_attendance_read_parent ON attendance
    FOR SELECT USING (
        fn_current_user_role() = 'ORTU'
        AND is_void = FALSE
        AND EXISTS (
            SELECT 1 FROM student_parents sp
            WHERE sp.student_id     = attendance.student_id
              AND sp.parent_user_id = fn_current_user_id()
        )
    );


-- ============================================================
-- OBSERVATIONS
-- Write: GURU (own assignments), WALI_KELAS (own class), BK, KAPRODI.
-- Read:
--   Staff: all (regardless of visibility).
--   SISWA: only STUDENT_VISIBLE records for their student_id.
--   ORTU: only STUDENT_VISIBLE records of their linked children.
--   DUDI: blocked entirely.
-- ============================================================

-- Pagar ketat PKL: guru tidak boleh observasi siswa yang sedang aktif PKL.
-- Siswa PKL aktif hanya bisa diobservasi via jalur DUDI → PKL track.
CREATE POLICY rls_observations_write_guru ON observations
    FOR INSERT WITH CHECK (
        fn_current_user_role() IN ('GURU', 'WALI_KELAS', 'BK', 'KAPRODI')
        AND author_user_id = fn_current_user_id()
        AND NOT fn_student_is_on_pkl(student_id)
    );

CREATE POLICY rls_observations_read_staff ON observations
    FOR SELECT USING (
        fn_current_user_role() IN ('GURU', 'BK', 'WALI_KELAS', 'KAPRODI', 'KEPSEK')
    );

CREATE POLICY rls_observations_read_student ON observations
    FOR SELECT USING (
        fn_current_user_role() = 'SISWA'
        AND visibility = 'STUDENT_VISIBLE'
        AND student_id = (
            SELECT student_id FROM students WHERE user_id = fn_current_user_id()
        )
    );

-- ORTU: hanya observasi STUDENT_VISIBLE milik anak yang tertaut. Catatan
-- internal guru (INTERNAL_SCHOOL/PRIVATE) tidak pernah terlihat orang tua.
CREATE POLICY rls_observations_read_parent ON observations
    FOR SELECT USING (
        fn_current_user_role() = 'ORTU'
        AND visibility = 'STUDENT_VISIBLE'
        AND EXISTS (
            SELECT 1 FROM student_parents sp
            WHERE sp.student_id     = observations.student_id
              AND sp.parent_user_id = fn_current_user_id()
        )
    );


-- ============================================================
-- ACHIEVEMENTS
-- Write: WALI_KELAS (for their class), KAPRODI, KEPSEK.
-- Read: all staff + SISWA (own, non-voided).
-- ============================================================

CREATE POLICY rls_achievements_write ON achievements
    FOR INSERT WITH CHECK (
        fn_current_user_role() IN ('KAPRODI', 'KEPSEK')
        OR (
            fn_current_user_role() = 'WALI_KELAS'
            AND EXISTS (
                SELECT 1 FROM class_enrollments ce
                WHERE ce.student_id = achievements.student_id
                  AND ce.class_id   = fn_wali_kelas_class_id()
                  AND ce.withdrawn_at IS NULL
            )
        )
    );

CREATE POLICY rls_achievements_read_staff ON achievements
    FOR SELECT USING (
        fn_current_user_role() IN ('GURU', 'BK', 'WALI_KELAS', 'KAPRODI', 'KEPSEK')
    );

CREATE POLICY rls_achievements_read_student ON achievements
    FOR SELECT USING (
        fn_current_user_role() = 'SISWA'
        AND is_voided = FALSE
        AND student_id = (
            SELECT student_id FROM students WHERE user_id = fn_current_user_id()
        )
    );

-- Void (UPDATE is_voided): only KAPRODI, KEPSEK
CREATE POLICY rls_achievements_void ON achievements
    FOR UPDATE USING (
        fn_current_user_role() IN ('KAPRODI', 'KEPSEK')
    );

-- No DELETE on achievements (enforced via no DELETE policy + table comment)


-- ============================================================
-- CASES
-- ⚠️ MODEL AUDIENS (mig 20260703250000, Langkah A) — file ini kontrak LOGIS
--    era-lama; kebenaran = live + migrasi + memory project-case-escalation-design.
--    Sejak audiens per-kasus, baca kasus AUDIENS-AWARE via fn_can_see_case
--    (konsisten cases + case_events), MENGGANTIKAN matriks "BK/Waka lihat semua":
--
-- Read access (audiens-aware, fn_can_see_case):
--   terlibat/penangan → SELALU (fn_involved_in_case / fn_matches_case_handler)
--   audience=PUBLIC     → semua 6 aktor internal kasus (fn_is_internal_case_actor)
--   audience=RESTRICTED → hanya anggota case_audience_members ("orang tertentu")
--   audience=PRIVATE    → hanya terlibat/penangan (default; kasus lahir privat)
--   DUDI ‡: hanya siswa PKL binaannya
--   SISWA §: own cases, STUDENT_VISIBLE events only (case_events)
--   ORTU / WAKA_KURIKULUM / TU: bukan aktor kasus
--
-- Write (CREATE case):
--   6 aktor internal (GURU, BK, WALI_KELAS, KAPRODI, WAKA_KESISWAAN, KEPSEK)
--   + DUDI (siswa binaannya; audiens DUDI selalu PRIVATE).
--
-- Escalation: BEBAS antar-internal; kunci server (trg_case_validate_escalate):
--   target wajib peran internal; DUDI hanya -> KAPRODI.
-- Status/handler updates: via case_events INSERT only. Audiens: UPDATE via
--   rls_cases_update_audience (aktor internal yang bisa lihat kasus).
-- ============================================================

CREATE POLICY rls_cases_read_admin ON cases
    FOR SELECT USING (
        fn_current_user_role() IN ('BK', 'WALI_KELAS', 'KAPRODI', 'KEPSEK')
    );

CREATE POLICY rls_cases_read_guru ON cases
    FOR SELECT USING (
        fn_current_user_role() IN ('GURU', 'WALI_KELAS')
        AND (
            fn_involved_in_case(case_id)
            OR EXISTS (
                SELECT 1 FROM class_enrollments ce
                JOIN teaching_assignments ta ON ta.class_id = ce.class_id
                WHERE ce.student_id    = cases.student_id
                  AND ta.user_id       = fn_current_user_id()
                  AND ta.is_active     = TRUE
                  AND ce.withdrawn_at  IS NULL
            )
        )
    );

CREATE POLICY rls_cases_read_dudi ON cases
    FOR SELECT USING (
        fn_current_user_role() = 'DUDI'
        AND fn_dudi_supervises_student(student_id)
    );

CREATE POLICY rls_cases_read_student ON cases
    FOR SELECT USING (
        fn_current_user_role() = 'SISWA'
        AND student_id = (
            SELECT student_id FROM students WHERE user_id = fn_current_user_id()
        )
    );

-- Semua 7 aktor internal + DUDI boleh buat kasus.
-- DUDI: hanya siswa binaannya, audiens wajib PRIVATE.
-- Pagar ketat PKL: aktor sekolah tidak boleh buat kasus untuk siswa aktif PKL
-- (hanya DUDI yang boleh — kasus PKL masuk track PKL via DUDI).
CREATE POLICY rls_cases_insert ON cases
    FOR INSERT WITH CHECK (
        (
            fn_current_user_role() = 'DUDI'
            OR (
                fn_current_user_role() IN ('GURU','BK','WALI_KELAS','KAPRODI','WAKA_KESISWAAN','WAKA_HUMAS','KEPSEK')
                AND NOT fn_student_is_on_pkl(student_id)
            )
            OR (fn_is_bk()             AND NOT fn_student_is_on_pkl(student_id))
            OR (fn_is_kepsek()         AND NOT fn_student_is_on_pkl(student_id))
            OR (fn_is_waka_kesiswaan() AND NOT fn_student_is_on_pkl(student_id))
        )
        AND created_by_user_id = fn_current_user_id()
        AND (fn_current_user_role() <> 'DUDI' OR audience = 'PRIVATE')
    );

-- UPDATE on cases is restricted to the sync trigger path only
-- (fn_case_guard_denormalized enforces this at DB level)
CREATE POLICY rls_cases_update_sync ON cases
    FOR UPDATE USING (TRUE);   -- Guard is enforced by trigger, not RLS


-- ============================================================
-- CASE_EVENTS
-- INSERT: determined by role + handler + lock state
--   All roles in matrix can insert IF current_handler matches
--   (except FINAL_DECISION_MADE which only KEPSEK can insert).
--   Lock check (INV-4): COMMENT_ADDED blocked for non-handler
--   when locked — enforced here via RLS + trigger.
--
-- SELECT: staff reads all events; student reads STUDENT_VISIBLE only.
-- UPDATE/DELETE: blocked by trigger (append-only).
-- ============================================================

CREATE POLICY rls_case_events_read_staff ON case_events
    FOR SELECT USING (
        fn_current_user_role() IN ('GURU', 'BK', 'WALI_KELAS', 'KAPRODI', 'KEPSEK', 'DUDI')
        -- Access to the parent case is governed by cases RLS above;
        -- this policy grants event-row access to any staff who can see the case
        AND EXISTS (
            SELECT 1 FROM cases c WHERE c.case_id = case_events.case_id
        )
    );

CREATE POLICY rls_case_events_read_student ON case_events
    FOR SELECT USING (
        fn_current_user_role() = 'SISWA'
        AND privacy_level = 'STUDENT_VISIBLE'
        AND EXISTS (
            SELECT 1 FROM cases c
            WHERE c.case_id    = case_events.case_id
              AND c.student_id = (
                  SELECT student_id FROM students WHERE user_id = fn_current_user_id()
              )
        )
    );

-- CATATAN: Disinkronkan ke kondisi LIVE (mig 330000/340000 + 20260703240000).
-- Perbedaan dari versi awal: (a) row di-scope school_id = fn_current_school_id();
-- (b) handler-match kini FLAG-AWARE via fn_matches_case_handler (GURU dgn is_bk,
-- wali/kaprodi student-spesifik, dst.); (c) authorship diverifikasi
-- (author_user_id & author_role_at_time = user login) di KEDUA policy (E3-2).
-- INV-1 (no event on CLOSED) dijaga trigger trg_case_events_no_closed.

-- INSERT: staf dapat insert bila mereka handler kasus saat ini (flag-aware)
CREATE POLICY rls_case_events_insert_handler ON case_events
    FOR INSERT WITH CHECK (
        school_id = fn_current_school_id()
        AND author_user_id      = fn_current_user_id()
        AND author_role_at_time = fn_current_user_role()
        AND EXISTS (
            SELECT 1 FROM cases c
            WHERE c.case_id = case_events.case_id
              AND fn_matches_case_handler(c.current_handler_role, c.student_id)
              AND c.status <> 'CLOSED'
        )
    );

-- INSERT: KEPSEK — semua event type (termasuk FINAL_DECISION_MADE)
CREATE POLICY rls_case_events_insert_kepsek ON case_events
    FOR INSERT WITH CHECK (
        school_id = fn_current_school_id()
        AND fn_is_kepsek()
        AND author_user_id      = fn_current_user_id()
        AND author_role_at_time = fn_current_user_role()
    );


-- ============================================================
-- PARENT_MESSAGES
-- TN-08: visibility is per-row UUID array.
-- SELECT: auth.uid() must be in visible_to_user_ids.
-- INSERT: ORTU only (INBOUND). Replies (OUTBOUND) by staff handlers.
-- ============================================================

CREATE POLICY rls_parent_msg_read ON parent_messages
    FOR SELECT USING (
        fn_current_user_id() = ANY(visible_to_user_ids)
    );

CREATE POLICY rls_parent_msg_insert_ortu ON parent_messages
    FOR INSERT WITH CHECK (
        fn_current_user_role() = 'ORTU'
        AND direction = 'INBOUND'
        AND sender_user_id = fn_current_user_id()
    );

CREATE POLICY rls_parent_msg_reply_staff ON parent_messages
    FOR INSERT WITH CHECK (
        fn_current_user_role() IN ('GURU', 'BK', 'WALI_KELAS', 'KAPRODI', 'KEPSEK')
        AND direction = 'OUTBOUND'
        AND sender_user_id = fn_current_user_id()
    );


-- ============================================================
-- TEACHER_JOURNALS
-- Strictly private. Only owner can read or write.
-- ============================================================

CREATE POLICY rls_journals_owner ON teacher_journals
    FOR ALL USING (
        owner_user_id = fn_current_user_id()
    );


-- ============================================================
-- TEACHING_ASSIGNMENTS + TEACHING_SCHEDULES
-- Read: all staff (needed for attendance, dashboard).
-- Write: KAPRODI, KEPSEK.
-- GURU: read their own assignments + all schedules for their classes.
-- ============================================================

CREATE POLICY rls_assignments_read_all_staff ON teaching_assignments
    FOR SELECT USING (
        fn_current_user_role() IN ('GURU', 'BK', 'WALI_KELAS', 'KAPRODI', 'KEPSEK')
    );

CREATE POLICY rls_assignments_write_admin ON teaching_assignments
    FOR ALL USING (fn_current_user_role() IN ('KAPRODI', 'KEPSEK'));

CREATE POLICY rls_schedules_read_staff ON teaching_schedules
    FOR SELECT USING (
        fn_current_user_role() IN ('GURU', 'BK', 'WALI_KELAS', 'KAPRODI', 'KEPSEK')
    );

CREATE POLICY rls_schedules_write_admin ON teaching_schedules
    FOR ALL USING (fn_current_user_role() IN ('KAPRODI', 'KEPSEK'));

-- Substitute: read their own substitute schedules
CREATE POLICY rls_substitute_read_own ON substitute_schedules
    FOR SELECT USING (
        substitute_user_id = fn_current_user_id()
    );

CREATE POLICY rls_substitute_write_admin ON substitute_schedules
    FOR ALL USING (fn_current_user_role() IN ('KAPRODI', 'KEPSEK'));


-- ============================================================
-- STUDENT_UPDATES
-- Read: staff (all), SISWA (own cases only).
-- Write: current_handler_role only (enforced via case FK check).
-- ============================================================

CREATE POLICY rls_student_updates_read_staff ON student_updates
    FOR SELECT USING (
        fn_current_user_role() IN ('GURU', 'BK', 'WALI_KELAS', 'KAPRODI', 'KEPSEK', 'DUDI')
    );

CREATE POLICY rls_student_updates_read_student ON student_updates
    FOR SELECT USING (
        fn_current_user_role() = 'SISWA'
        AND EXISTS (
            SELECT 1 FROM cases c
            WHERE c.case_id    = student_updates.case_id
              AND c.student_id = (
                  SELECT student_id FROM students WHERE user_id = fn_current_user_id()
              )
        )
    );

CREATE POLICY rls_student_updates_insert ON student_updates
    FOR INSERT WITH CHECK (
        author_user_id = fn_current_user_id()
        AND EXISTS (
            SELECT 1 FROM cases c
            WHERE c.case_id              = student_updates.case_id
              AND c.current_handler_role = fn_current_user_role()
              AND c.status              != 'CLOSED'
        )
    );


-- ============================================================
-- TEACHER_ATTENDANCE_LOG
-- Read: owner only (their own signals). KEPSEK reads all.
-- Write: system only (via service role / Edge Function).
--   No client INSERT policy — service key bypasses RLS.
-- ============================================================

CREATE POLICY rls_teacher_att_log_read_own ON teacher_attendance_log
    FOR SELECT USING (
        user_id = fn_current_user_id()
        OR fn_current_user_role() = 'KEPSEK'
    );


-- ============================================================
-- PKL_PLACEMENTS, CLASS_ENROLLMENTS
-- Read: staff + DUDI (own students).
-- Write: KAPRODI, KEPSEK.
-- ============================================================

-- WAKA_HUMAS: akses detail PKL/DUDI lintas program (setara Kepsek di domain PKL).
-- WAKA_KESISWAAN: tidak punya akses PKL (pagar ketat — PKL hanya domain DUDI/Kaprodi/Waka Humas/Kepsek).
CREATE POLICY rls_pkl_read_staff ON pkl_placements
    FOR SELECT USING (
        fn_current_user_role() IN ('GURU', 'BK', 'WALI_KELAS', 'KAPRODI', 'KEPSEK', 'WAKA_HUMAS')
    );

CREATE POLICY rls_pkl_read_dudi ON pkl_placements
    FOR SELECT USING (
        fn_current_user_role() = 'DUDI'
        AND dudi_user_id = fn_current_user_id()
    );

CREATE POLICY rls_pkl_write_admin ON pkl_placements
    FOR ALL USING (fn_current_user_role() IN ('KAPRODI', 'KEPSEK', 'WAKA_HUMAS'));

CREATE POLICY rls_enrollments_read_staff ON class_enrollments
    FOR SELECT USING (
        fn_current_user_role() IN ('GURU', 'BK', 'WALI_KELAS', 'KAPRODI', 'KEPSEK')
    );

CREATE POLICY rls_enrollments_write_admin ON class_enrollments
    FOR ALL USING (fn_current_user_role() IN ('KAPRODI', 'KEPSEK'));


-- ============================================================
-- STUDENT_PARENTS
-- Read: staff (all), ORTU (own relations only).
-- Write: ADMINISTRATIVE only (provisioning during import/setup).
-- ============================================================

CREATE POLICY rls_student_parents_read_staff ON student_parents
    FOR SELECT USING (
        fn_current_user_role() IN ('GURU', 'BK', 'WALI_KELAS', 'KAPRODI', 'KEPSEK')
    );

CREATE POLICY rls_student_parents_read_own ON student_parents
    FOR SELECT USING (
        fn_current_user_role() = 'ORTU'
        AND parent_user_id = fn_current_user_id()
    );

CREATE POLICY rls_student_parents_write_administrative ON student_parents
    FOR ALL USING (fn_current_user_role() = 'ADMINISTRATIVE');


-- ============================================================
-- SCHOOL_CONFIG
-- Read: any authenticated user (needed for login redirect logic).
-- Write: ADMINISTRATIVE and KEPSEK only.
-- ============================================================

CREATE POLICY rls_school_config_read_all ON school_config
    FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY rls_school_config_write_admin ON school_config
    FOR ALL USING (fn_current_user_role() IN ('ADMINISTRATIVE', 'KEPSEK'));


-- ============================================================
-- ACADEMIC_PERIODS
-- Read: any authenticated user (needed to check lock status client-side).
-- Write: ADMINISTRATIVE only — INSERT/UPDATE, no DELETE
-- (period history must never be removed, only closed).
-- ============================================================

CREATE POLICY rls_academic_periods_read_all ON academic_periods
    FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY rls_academic_periods_insert_administrative ON academic_periods
    FOR INSERT WITH CHECK (fn_current_user_role() = 'ADMINISTRATIVE');

CREATE POLICY rls_academic_periods_update_administrative ON academic_periods
    FOR UPDATE USING (fn_current_user_role() = 'ADMINISTRATIVE')
    WITH CHECK (fn_current_user_role() = 'ADMINISTRATIVE');


-- ============================================================
-- SCHEDULE_TEMPLATES
-- Read: all teaching/academic staff.
-- Write: ADMINISTRATIVE only (INSERT/UPDATE/DELETE via FOR ALL,
-- which also grants ADMINISTRATIVE implicit SELECT).
-- ============================================================

CREATE POLICY rls_schedule_templates_read_staff ON schedule_templates
    FOR SELECT USING (
        fn_current_user_role() IN ('GURU', 'BK', 'WALI_KELAS', 'KAPRODI', 'KEPSEK')
    );

CREATE POLICY rls_schedule_templates_write_administrative ON schedule_templates
    FOR ALL USING (fn_current_user_role() = 'ADMINISTRATIVE');


-- ============================================================
-- ADMINISTRATIVE ROLE — cross-cutting master-data access
--
-- Scope (per onboarding/admin tooling spec):
--   READ:  users, students, classes, programs, subjects,
--          teaching_assignments, teaching_schedules
--          (classes/programs/subjects already covered by their
--          existing rls_*_read_all policies — auth.uid() IS NOT NULL)
--   WRITE: users, students, class_enrollments, teaching_assignments,
--          teaching_schedules, substitute_schedules, school_config,
--          student_parents
--          (school_config, student_parents handled above)
--   NO ACCESS: cases, case_events, observations, achievements,
--          teacher_journals, parent_messages — intentionally NOT
--          granted here. No permissive policy for ADMINISTRATIVE
--          exists on those tables, so RLS denies by default.
-- ============================================================

CREATE POLICY rls_users_read_administrative ON users
    FOR SELECT USING (fn_current_user_role() = 'ADMINISTRATIVE');

CREATE POLICY rls_users_write_administrative ON users
    FOR ALL USING (fn_current_user_role() = 'ADMINISTRATIVE');

CREATE POLICY rls_students_read_administrative ON students
    FOR SELECT USING (fn_current_user_role() = 'ADMINISTRATIVE');

CREATE POLICY rls_students_write_administrative ON students
    FOR ALL USING (fn_current_user_role() = 'ADMINISTRATIVE');

CREATE POLICY rls_assignments_read_administrative ON teaching_assignments
    FOR SELECT USING (fn_current_user_role() = 'ADMINISTRATIVE');

CREATE POLICY rls_assignments_write_administrative ON teaching_assignments
    FOR ALL USING (fn_current_user_role() = 'ADMINISTRATIVE');

CREATE POLICY rls_schedules_read_administrative ON teaching_schedules
    FOR SELECT USING (fn_current_user_role() = 'ADMINISTRATIVE');

CREATE POLICY rls_schedules_write_administrative ON teaching_schedules
    FOR ALL USING (fn_current_user_role() = 'ADMINISTRATIVE');

CREATE POLICY rls_substitute_write_administrative ON substitute_schedules
    FOR ALL USING (fn_current_user_role() = 'ADMINISTRATIVE');

CREATE POLICY rls_enrollments_write_administrative ON class_enrollments
    FOR ALL USING (fn_current_user_role() = 'ADMINISTRATIVE');

-- DELETE on transactional tables — needed for cascade delete when
-- removing students via wizard (observations, etc. must be cleared
-- before the student row can be deleted).
-- NOTE: attendance DELETE policy removed (Item 8 / ABS-3) —
--   TU tidak boleh hapus absensi; hanya void via meeting_status.

CREATE POLICY rls_observations_delete_administrative ON observations
    FOR DELETE USING (fn_current_user_role() = 'ADMINISTRATIVE');

CREATE POLICY rls_cases_delete_administrative ON cases
    FOR DELETE USING (fn_current_user_role() = 'ADMINISTRATIVE');

CREATE POLICY rls_case_events_delete_administrative ON case_events
    FOR DELETE USING (fn_current_user_role() = 'ADMINISTRATIVE');

CREATE POLICY rls_parent_msg_delete_administrative ON parent_messages
    FOR DELETE USING (fn_current_user_role() = 'ADMINISTRATIVE');

-- ============================================================
-- NOTIFICATIONS (tabel notifikasi kasus — mig 20260703280000)
-- ============================================================
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
