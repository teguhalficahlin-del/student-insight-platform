-- ============================================================
-- Migrasi: Akses baca kasus untuk SISWA dan ORTU
--
-- Perubahan:
--   1. rls_cases_read_student   — hanya kasus audience=RESTRICTED
--      (sebelumnya: semua kasus tentang siswa termasuk PRIVATE)
--   2. rls_cases_read_parent    — kasus RESTRICTED tentang anak (baru)
--   3. rls_case_events_read_parent — event STUDENT_VISIBLE (baru)
--
-- Tidak menyentuh: fn_can_see_case, fn_user_is_internal_case_actor,
-- case_audience_members, semua policy staf/dudi.
-- ============================================================

BEGIN;

-- ── 1. Fix rls_cases_read_student ─────────────────────────────
-- Sebelum: siswa bisa baca semua kasus tentang dirinya (PRIVATE sekalipun).
-- Sesudah: hanya kasus dengan audience = RESTRICTED.
DROP POLICY IF EXISTS rls_cases_read_student ON cases;
CREATE POLICY rls_cases_read_student ON cases
    FOR SELECT USING (
        school_id              = fn_current_school_id()
        AND fn_current_user_role() = 'SISWA'
        AND audience           = 'RESTRICTED'
        AND student_id = (
            SELECT s.student_id FROM students s
            WHERE s.user_id = fn_current_user_id()
        )
    );

-- ── 2. Tambah rls_cases_read_parent ───────────────────────────
-- Orang tua hanya melihat kasus audience=RESTRICTED tentang anaknya.
DROP POLICY IF EXISTS rls_cases_read_parent ON cases;
CREATE POLICY rls_cases_read_parent ON cases
    FOR SELECT USING (
        school_id              = fn_current_school_id()
        AND fn_current_user_role() = 'ORTU'
        AND audience           = 'RESTRICTED'
        AND EXISTS (
            SELECT 1 FROM student_parents sp
            WHERE sp.student_id    = cases.student_id
              AND sp.parent_user_id = fn_current_user_id()
        )
    );

-- ── 3. Tambah rls_case_events_read_parent ─────────────────────
-- Orang tua hanya melihat event yang ditandai STUDENT_VISIBLE,
-- pada kasus yang bisa mereka lihat (filter kasus via subquery).
DROP POLICY IF EXISTS rls_case_events_read_parent ON case_events;
CREATE POLICY rls_case_events_read_parent ON case_events
    FOR SELECT USING (
        school_id              = fn_current_school_id()
        AND fn_current_user_role() = 'ORTU'
        AND privacy_level      = 'STUDENT_VISIBLE'
        AND EXISTS (
            SELECT 1 FROM cases c
            WHERE c.case_id  = case_events.case_id
              AND c.audience = 'RESTRICTED'
              AND EXISTS (
                  SELECT 1 FROM student_parents sp
                  WHERE sp.student_id    = c.student_id
                    AND sp.parent_user_id = fn_current_user_id()
              )
        )
    );

COMMIT;
