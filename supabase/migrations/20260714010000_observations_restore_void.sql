-- ============================================================
-- Pulihkan mekanisme void observasi pasca-refactor 20260712020000.
--
-- Migration 20260712020000 menghapus semua policy lama termasuk
-- rls_observations_void_admin dan rls_observations_read_administrative,
-- dan policy siswa/ortu yang baru tidak menyertakan filter is_void.
-- Kolom is_void / void_reason / voided_by / voided_at tetap ada
-- di tabel tapi tidak terpagar — observasi yang divoid bisa terbaca
-- siswa/ortu.
--
-- Perubahan:
--   1. Tambah is_void = FALSE ke rls_observations_read_student
--   2. Tambah is_void = FALSE ke rls_observations_read_parent
--   3. Pulihkan rls_observations_void_admin (ADMINISTRATIVE saja, tidak KEPSEK)
--   4. Pulihkan rls_observations_read_administrative
--
-- ROLLBACK:
--   DROP POLICY IF EXISTS rls_observations_void_admin        ON observations;
--   DROP POLICY IF EXISTS rls_observations_read_administrative ON observations;
--   <re-create rls_observations_read_student + read_parent tanpa is_void filter
--    dari migration 20260712020000>
-- ============================================================

-- ── 1. Siswa: tambah is_void = FALSE ─────────────────────────
DROP POLICY IF EXISTS rls_observations_read_student ON observations;
CREATE POLICY rls_observations_read_student ON observations FOR SELECT
    USING (
        fn_current_user_role() = 'SISWA'
        AND visibility = ANY (
            ARRAY['SISWA_SAJA','SISWA_DAN_ORTU']::visibility_level[]
        )
        AND is_void = FALSE
        AND EXISTS (
            SELECT 1 FROM students s
            WHERE s.student_id = observations.student_id
              AND s.user_id    = fn_current_user_id()
              AND s.school_id  = fn_current_school_id()
        )
    );

-- ── 2. Ortu: tambah is_void = FALSE ──────────────────────────
DROP POLICY IF EXISTS rls_observations_read_parent ON observations;
CREATE POLICY rls_observations_read_parent ON observations FOR SELECT
    USING (
        fn_current_user_role() = 'ORTU'
        AND visibility = ANY (
            ARRAY['ORTU_SAJA','SISWA_DAN_ORTU']::visibility_level[]
        )
        AND is_void = FALSE
        AND EXISTS (
            SELECT 1 FROM student_parents sp
            WHERE sp.student_id     = observations.student_id
              AND sp.parent_user_id = fn_current_user_id()
        )
    );

-- ── 3. Admin: boleh void (UPDATE) — ADMINISTRATIVE saja ──────
DROP POLICY IF EXISTS rls_observations_void_admin ON observations;
CREATE POLICY rls_observations_void_admin ON observations
    FOR UPDATE
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type
    )
    WITH CHECK (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type
    );

-- ── 4. Admin: boleh baca semua observasi (termasuk yang divoid) ─
DROP POLICY IF EXISTS rls_observations_read_administrative ON observations;
CREATE POLICY rls_observations_read_administrative ON observations
    FOR SELECT
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type
    );
