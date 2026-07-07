-- ============================================================
-- Migration: 20260706190000_fix_pkl_ortu_rls_school_filter.sql
--
-- Fase 2.1 audit menemukan dua policy RLS tidak menyertakan filter
-- school_id, sehingga ortu yang (secara anomali) memiliki baris di
-- student_parents yang menunjuk ke siswa di sekolah lain bisa membaca
-- data PKL lintas tenant.
--
-- Kedua policy sebelumnya:
--   USING (fn_current_user_role() = 'ORTU' AND EXISTS (...student_parents...))
-- Tidak ada: school_id = fn_current_school_id()
--
-- Fix: tambahkan school_id = fn_current_school_id() sebagai kondisi
-- pertama (short-circuit evaluation) sebelum EXISTS subquery.
-- Sisa logika dipertahankan persis.
-- ============================================================

-- ── pkl_attendance ──────────────────────────────────────────

DROP POLICY IF EXISTS rls_pkl_attendance_read_ortu ON pkl_attendance;

CREATE POLICY rls_pkl_attendance_read_ortu ON pkl_attendance
    FOR SELECT
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ORTU'::role_type
        AND EXISTS (
            SELECT 1
            FROM student_parents sp
            WHERE sp.student_id     = pkl_attendance.student_id
              AND sp.parent_user_id = fn_current_user_id()
        )
    );


-- ── pkl_placements ──────────────────────────────────────────

DROP POLICY IF EXISTS rls_pkl_read_ortu ON pkl_placements;

CREATE POLICY rls_pkl_read_ortu ON pkl_placements
    FOR SELECT
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ORTU'::role_type
        AND EXISTS (
            SELECT 1
            FROM student_parents sp
            WHERE sp.student_id     = pkl_placements.student_id
              AND sp.parent_user_id = fn_current_user_id()
        )
    );
