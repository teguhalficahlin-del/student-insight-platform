-- ============================================================
-- Migration: 20260802040000_coaching-cases-rls.sql
-- Coaching Cases — RLS policies untuk semua 4 tabel.
-- Prerequisite: 20260802030000 (functions + triggers).
-- ============================================================
--
-- CATATAN KEAMANAN subquery ke tabel RLS-protected:
--
-- rls_cc_read_student   → subquery ke students:
--   SISWA bisa baca baris sendiri via rls_students_read_own
--   (user_id = fn_current_user_id()). Filter subquery konsisten → aman.
--
-- rls_cc_read_parent    → EXISTS ke student_parents:
--   ORTU bisa baca baris sendiri via rls_student_parents_read_own
--   (parent_user_id = fn_current_user_id()). Filter subquery konsisten → aman.
--
-- rls_cce_insert        → EXISTS ke coaching_cases:
--   Staf yang merupakan current_handler dapat melihat kasus via
--   rls_cc_read_staff → fn_can_see_coaching_case → aman.
--
-- rls_cce_read_student/parent → EXISTS ke coaching_cases JOIN student_parents:
--   Masing-masing role dapat melihat baris terkait via policy yang sudah ada → aman.
-- ============================================================


-- ============================================================
-- §3.1  coaching_cases
-- ============================================================

ALTER TABLE coaching_cases ENABLE ROW LEVEL SECURITY;

-- ── SELECT: Staf (non-siswa, non-ortu, non-stakeholder) ──────────────────────
DROP POLICY IF EXISTS rls_cc_read_staff ON coaching_cases;
CREATE POLICY rls_cc_read_staff ON coaching_cases
    FOR SELECT TO authenticated
    USING (
        school_id              = fn_current_school_id()
        AND fn_current_user_role() != ALL(ARRAY['SISWA','ORTU','STAKEHOLDER']::role_type[])
        AND fn_can_see_coaching_case(case_id)
    );

-- ── SELECT: DUDI — hanya kasus PKL siswa binaannya ──────────────────────────
-- fn_can_see_coaching_case sudah memvalidasi handler/creator; policy ini
-- menambah filter track = PKL agar DUDI tidak bisa lihat kasus SEKOLAH.
DROP POLICY IF EXISTS rls_cc_read_dudi ON coaching_cases;
CREATE POLICY rls_cc_read_dudi ON coaching_cases
    FOR SELECT TO authenticated
    USING (
        school_id              = fn_current_school_id()
        AND fn_current_user_role() = 'DUDI'::role_type
        AND track              = 'PKL'
        AND fn_can_see_coaching_case(case_id)
    );

-- ── SELECT: Siswa — hanya kasus yang dibagikan ke mereka ─────────────────────
-- Subquery ke students aman: rls_students_read_own memperbolehkan SISWA baca
-- baris sendiri (user_id = fn_current_user_id()).
DROP POLICY IF EXISTS rls_cc_read_student ON coaching_cases;
CREATE POLICY rls_cc_read_student ON coaching_cases
    FOR SELECT TO authenticated
    USING (
        school_id                  = fn_current_school_id()
        AND fn_current_user_role() = 'SISWA'::role_type
        AND is_shared_to_student   = TRUE
        AND student_id             = (
            SELECT s.student_id FROM students s
            WHERE s.user_id = fn_current_user_id()
            LIMIT 1
        )
    );

-- ── SELECT: Ortu — hanya kasus yang dibagikan dan menyangkut anak mereka ──────
-- Subquery ke student_parents aman: rls_student_parents_read_own memperbolehkan
-- ORTU baca baris sendiri (parent_user_id = fn_current_user_id()).
DROP POLICY IF EXISTS rls_cc_read_parent ON coaching_cases;
CREATE POLICY rls_cc_read_parent ON coaching_cases
    FOR SELECT TO authenticated
    USING (
        school_id                  = fn_current_school_id()
        AND fn_current_user_role() = 'ORTU'::role_type
        AND is_shared_to_parent    = TRUE
        AND EXISTS (
            SELECT 1 FROM student_parents sp
            WHERE sp.student_id     = coaching_cases.student_id
              AND sp.parent_user_id = fn_current_user_id()
        )
    );

-- ── INSERT: Semua staf (bukan SISWA, ORTU, STAKEHOLDER) ──────────────────────
-- DUDI hanya untuk kasus track = PKL dan siswa binaannya (fn_dudi_supervises_student).
-- Pembuat wajib menetapkan dirinya sebagai created_by dan current_handler.
DROP POLICY IF EXISTS rls_cc_insert ON coaching_cases;
CREATE POLICY rls_cc_insert ON coaching_cases
    FOR INSERT TO authenticated
    WITH CHECK (
        school_id                   = fn_current_school_id()
        AND created_by_user_id      = fn_current_user_id()
        AND current_handler_user_id = fn_current_user_id()
        AND fn_current_user_role()  != ALL(ARRAY['SISWA','ORTU','STAKEHOLDER']::role_type[])
        AND NOT (
            fn_current_user_role() = 'DUDI'::role_type
            AND (track != 'PKL' OR NOT fn_dudi_supervises_student(student_id))
        )
    );

-- ── UPDATE: Hanya via trigger sync (app.coaching_sync_active = 'true') ────────
-- Direct UPDATE dari klien tidak diizinkan — semua perubahan state melalui
-- INSERT ke coaching_case_events → fn_coaching_case_sync_handler.
-- Klien authenticated tidak bisa set session variable di Supabase.
DROP POLICY IF EXISTS rls_cc_update ON coaching_cases;
CREATE POLICY rls_cc_update ON coaching_cases
    FOR UPDATE TO authenticated
    USING (
        school_id = fn_current_school_id()
        AND current_setting('app.coaching_sync_active', TRUE) = 'true'
    )
    WITH CHECK (
        school_id = fn_current_school_id()
    );

-- ── DELETE: Hanya ADMINISTRATIVE via fn_admin_delete_coaching_case RPC ─────────
-- Defense-in-depth: validasi utama (alasan, tenant check) ada di RPC function.
DROP POLICY IF EXISTS rls_cc_delete ON coaching_cases;
CREATE POLICY rls_cc_delete ON coaching_cases
    FOR DELETE TO authenticated
    USING (
        school_id              = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type
    );

GRANT SELECT, INSERT, UPDATE, DELETE ON coaching_cases TO authenticated;
GRANT ALL                             ON coaching_cases TO service_role;


-- ============================================================
-- §3.2  coaching_case_handlers
-- ============================================================

ALTER TABLE coaching_case_handlers ENABLE ROW LEVEL SECURITY;

-- ── SELECT: Staf yang bisa lihat kasus bisa lihat riwayat handler ─────────────
DROP POLICY IF EXISTS rls_cch_read_staff ON coaching_case_handlers;
CREATE POLICY rls_cch_read_staff ON coaching_case_handlers
    FOR SELECT TO authenticated
    USING (
        school_id              = fn_current_school_id()
        AND fn_current_user_role() != ALL(ARRAY['SISWA','ORTU','STAKEHOLDER']::role_type[])
        AND fn_can_see_coaching_case(case_id)
    );

-- ── INSERT: Hanya via trigger sync ───────────────────────────────────────────
-- fn_coaching_case_log_create dan fn_coaching_case_sync_handler (keduanya
-- SECURITY DEFINER) set coaching_sync_active = 'true' sebelum INSERT.
DROP POLICY IF EXISTS rls_cch_insert ON coaching_case_handlers;
CREATE POLICY rls_cch_insert ON coaching_case_handlers
    FOR INSERT TO authenticated
    WITH CHECK (
        school_id = fn_current_school_id()
        AND current_setting('app.coaching_sync_active', TRUE) = 'true'
    );

-- ── UPDATE: Hanya via trigger sync (untuk set handover_at saat eskalasi) ──────
DROP POLICY IF EXISTS rls_cch_update ON coaching_case_handlers;
CREATE POLICY rls_cch_update ON coaching_case_handlers
    FOR UPDATE TO authenticated
    USING (
        school_id = fn_current_school_id()
        AND current_setting('app.coaching_sync_active', TRUE) = 'true'
    );

GRANT SELECT, INSERT, UPDATE ON coaching_case_handlers TO authenticated;
GRANT ALL                     ON coaching_case_handlers TO service_role;


-- ============================================================
-- §3.3  coaching_case_events
-- ============================================================

ALTER TABLE coaching_case_events ENABLE ROW LEVEL SECURITY;

-- ── SELECT: Staf yang bisa lihat kasus bisa lihat semua event-nya ─────────────
DROP POLICY IF EXISTS rls_cce_read_staff ON coaching_case_events;
CREATE POLICY rls_cce_read_staff ON coaching_case_events
    FOR SELECT TO authenticated
    USING (
        school_id              = fn_current_school_id()
        AND fn_current_user_role() != ALL(ARRAY['SISWA','ORTU','STAKEHOLDER']::role_type[])
        AND fn_can_see_coaching_case(case_id)
    );

-- ── SELECT: Siswa — hanya event is_visible_to_student = TRUE ─────────────────
-- dan hanya untuk kasus yang memang di-share ke mereka.
-- Subquery ke coaching_cases: SISWA bisa lihat kasus via rls_cc_read_student.
-- Subquery ke students: aman via rls_students_read_own.
DROP POLICY IF EXISTS rls_cce_read_student ON coaching_case_events;
CREATE POLICY rls_cce_read_student ON coaching_case_events
    FOR SELECT TO authenticated
    USING (
        school_id                  = fn_current_school_id()
        AND fn_current_user_role() = 'SISWA'::role_type
        AND is_visible_to_student  = TRUE
        AND EXISTS (
            SELECT 1 FROM coaching_cases c
            WHERE c.case_id              = coaching_case_events.case_id
              AND c.is_shared_to_student = TRUE
              AND c.student_id           = (
                  SELECT s.student_id FROM students s
                  WHERE s.user_id = fn_current_user_id() LIMIT 1
              )
        )
    );

-- ── SELECT: Ortu — event is_visible_to_student = TRUE untuk kasus is_shared_to_parent
-- dan menyangkut anak mereka.
-- JOIN student_parents: aman via rls_student_parents_read_own.
DROP POLICY IF EXISTS rls_cce_read_parent ON coaching_case_events;
CREATE POLICY rls_cce_read_parent ON coaching_case_events
    FOR SELECT TO authenticated
    USING (
        school_id                  = fn_current_school_id()
        AND fn_current_user_role() = 'ORTU'::role_type
        AND is_visible_to_student  = TRUE
        AND EXISTS (
            SELECT 1 FROM coaching_cases c
            JOIN student_parents sp ON sp.student_id = c.student_id
            WHERE c.case_id             = coaching_case_events.case_id
              AND c.is_shared_to_parent = TRUE
              AND sp.parent_user_id     = fn_current_user_id()
        )
    );

-- ── INSERT: Handler aktif bisa insert event ke kasusnya ───────────────────────
-- author_user_id wajib = fn_current_user_id() (tidak bisa impersonate).
-- Dua jalur diizinkan:
--   (a) via coaching_sync_active = 'true' (trigger path untuk event state-changing)
--   (b) langsung sebagai current_handler_user_id (NOTE_ADDED, SHARED_*, dst)
-- Subquery ke coaching_cases: staf handler bisa lihat kasus via rls_cc_read_staff.
DROP POLICY IF EXISTS rls_cce_insert ON coaching_case_events;
CREATE POLICY rls_cce_insert ON coaching_case_events
    FOR INSERT TO authenticated
    WITH CHECK (
        school_id          = fn_current_school_id()
        AND author_user_id = fn_current_user_id()
        AND (
            current_setting('app.coaching_sync_active', TRUE) = 'true'
            OR EXISTS (
                SELECT 1 FROM coaching_cases c
                WHERE c.case_id                 = coaching_case_events.case_id
                  AND c.current_handler_user_id = fn_current_user_id()
                  AND c.status                 != 'CLOSED'
            )
        )
    );

-- DELETE dan UPDATE diblokir trigger trg_coaching_case_events_immutable

GRANT SELECT, INSERT ON coaching_case_events TO authenticated;
GRANT ALL             ON coaching_case_events TO service_role;


-- ============================================================
-- §3.4  coaching_case_templates
-- ============================================================

ALTER TABLE coaching_case_templates ENABLE ROW LEVEL SECURITY;

-- ── SELECT: Semua staf internal (bukan siswa/ortu/stakeholder) ────────────────
DROP POLICY IF EXISTS rls_cct_read ON coaching_case_templates;
CREATE POLICY rls_cct_read ON coaching_case_templates
    FOR SELECT TO authenticated
    USING (
        school_id              = fn_current_school_id()
        AND is_active          = TRUE
        AND fn_current_user_role() != ALL(ARRAY['SISWA','ORTU','STAKEHOLDER']::role_type[])
    );

-- ── INSERT: Hanya ADMINISTRATIVE ─────────────────────────────────────────────
DROP POLICY IF EXISTS rls_cct_insert ON coaching_case_templates;
CREATE POLICY rls_cct_insert ON coaching_case_templates
    FOR INSERT TO authenticated
    WITH CHECK (
        school_id              = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type
    );

-- ── UPDATE: Hanya ADMINISTRATIVE ─────────────────────────────────────────────
DROP POLICY IF EXISTS rls_cct_update ON coaching_case_templates;
CREATE POLICY rls_cct_update ON coaching_case_templates
    FOR UPDATE TO authenticated
    USING (
        school_id              = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type
    );

-- ── DELETE: Hanya ADMINISTRATIVE (rekomendasi: soft delete via is_active = FALSE) ─
DROP POLICY IF EXISTS rls_cct_delete ON coaching_case_templates;
CREATE POLICY rls_cct_delete ON coaching_case_templates
    FOR DELETE TO authenticated
    USING (
        school_id              = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type
    );

GRANT SELECT, INSERT, UPDATE, DELETE ON coaching_case_templates TO authenticated;
GRANT ALL                              ON coaching_case_templates TO service_role;
