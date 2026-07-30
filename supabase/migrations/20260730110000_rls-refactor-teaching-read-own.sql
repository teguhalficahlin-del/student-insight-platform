-- Refactor RLS teaching_schedules + teaching_assignments:
-- Ganti 6 policy per-role dengan 2 policy universal berbasis teacher_code.
--
-- Sebelumnya: policy terpisah untuk GURU, BK, WALI_KELAS, KAPRODI, KEPSEK,
--   WAKA_KURIKULUM, WAKA_KESISWAAN, WAKA_HUMAS — rentan miss saat role baru ditambah.
-- Sesudah: satu policy "siapapun yang punya teacher_code bisa baca jadwal sendiri".
--
-- Policy yang TIDAK disentuh (tetap utuh):
--   teaching_schedules: read_administrative, read_parent, read_student, read_tu,
--                       write_admin, write_administrative
--   teaching_assignments: read_administrative, write_admin, write_administrative

-- ============================================================
-- teaching_schedules
-- ============================================================
DROP POLICY IF EXISTS rls_schedules_read_staff      ON teaching_schedules;
DROP POLICY IF EXISTS rls_schedules_read_waka       ON teaching_schedules;
DROP POLICY IF EXISTS rls_schedules_read_waka_humas ON teaching_schedules;

DROP POLICY IF EXISTS rls_schedules_read_own ON teaching_schedules;
CREATE POLICY rls_schedules_read_own ON teaching_schedules
    FOR SELECT TO authenticated
    USING (
        school_id            = fn_current_school_id()
        AND scheduled_teacher_id = fn_current_user_id()
        AND EXISTS (
            SELECT 1 FROM users
            WHERE user_id      = fn_current_user_id()
              AND teacher_code IS NOT NULL
              AND teacher_code <> ''
        )
    );

-- ============================================================
-- teaching_assignments
-- ============================================================
DROP POLICY IF EXISTS rls_assignments_read_all_staff  ON teaching_assignments;
DROP POLICY IF EXISTS rls_assignments_read_waka       ON teaching_assignments;
DROP POLICY IF EXISTS rls_assignments_read_waka_humas ON teaching_assignments;

DROP POLICY IF EXISTS rls_assignments_read_own ON teaching_assignments;
CREATE POLICY rls_assignments_read_own ON teaching_assignments
    FOR SELECT TO authenticated
    USING (
        school_id  = fn_current_school_id()
        AND user_id    = fn_current_user_id()
        AND EXISTS (
            SELECT 1 FROM users
            WHERE user_id      = fn_current_user_id()
              AND teacher_code IS NOT NULL
              AND teacher_code <> ''
        )
    );
