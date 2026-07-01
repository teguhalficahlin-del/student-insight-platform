-- ============================================================
-- Migration: 20260701230000_rls_isolate_kaprodi_pkl.sql
-- Perbaiki privasi PKL: KAPRODI hanya boleh baca data PKL
-- (penempatan & kehadiran) untuk siswa di program keahliannya.
--
-- AKAR MASALAH
-- rls_pkl_read_staff & rls_pkl_attendance_read_staff memberi
-- KAPRODI akses ke seluruh data PKL sekolah lintas program.
--
-- PENDEKATAN
-- Pisah KAPRODI dari policy "semua staf" → ganti dengan policy
-- khusus yang filter via students.program_id = fn_kaprodi_program_id().
-- fn_kaprodi_program_id() sudah ada (migrasi 20260701220000).
-- ============================================================

-- ── pkl_placements ───────────────────────────────────────────

DROP POLICY IF EXISTS rls_pkl_read_staff    ON pkl_placements;
DROP POLICY IF EXISTS rls_pkl_read_kaprodi  ON pkl_placements;

CREATE POLICY rls_pkl_read_staff ON pkl_placements FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['GURU','BK','WALI_KELAS','KEPSEK']::role_type[]));

CREATE POLICY rls_pkl_read_kaprodi ON pkl_placements FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_kaprodi_program_id() IS NOT NULL
        AND EXISTS (
            SELECT 1 FROM students s
            WHERE s.student_id = pkl_placements.student_id
              AND s.program_id = fn_kaprodi_program_id()
        ));

-- ── pkl_attendance ───────────────────────────────────────────

DROP POLICY IF EXISTS rls_pkl_attendance_read_staff   ON pkl_attendance;
DROP POLICY IF EXISTS rls_pkl_attendance_read_kaprodi ON pkl_attendance;

CREATE POLICY rls_pkl_attendance_read_staff ON pkl_attendance FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['GURU','BK','WALI_KELAS','KEPSEK','WAKA_KESISWAAN']::role_type[]));

CREATE POLICY rls_pkl_attendance_read_kaprodi ON pkl_attendance FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_kaprodi_program_id() IS NOT NULL
        AND EXISTS (
            SELECT 1 FROM students s
            WHERE s.student_id = pkl_attendance.student_id
              AND s.program_id = fn_kaprodi_program_id()
        ));
