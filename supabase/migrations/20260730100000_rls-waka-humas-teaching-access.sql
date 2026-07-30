-- Fix: WAKA_HUMAS dapat membaca jadwal mengajar dan assignment miliknya sendiri.
-- Root cause: rls_schedules_read_staff dan rls_assignments_read_all_staff tidak
-- mencakup role WAKA_HUMAS, sehingga guru dengan jabatan Waka Humas tidak bisa
-- melihat jadwalnya di dashboard guru portal.
--
-- Strategi: tambah dua policy baru dengan filter teacher_id = fn_current_user_id()
-- agar WAKA_HUMAS hanya baca jadwal/assignment miliknya sendiri, bukan seluruh sekolah.

-- ============================================================
-- teaching_schedules: WAKA_HUMAS baca jadwal mengajarnya sendiri
-- ============================================================
DROP POLICY IF EXISTS rls_schedules_read_waka_humas ON teaching_schedules;
CREATE POLICY rls_schedules_read_waka_humas ON teaching_schedules
    FOR SELECT
    USING (
        school_id              = fn_current_school_id()
        AND fn_current_user_role() = 'WAKA_HUMAS'::role_type
        AND scheduled_teacher_id  = fn_current_user_id()
    );

-- ============================================================
-- teaching_assignments: WAKA_HUMAS baca assignment mengajarnya sendiri
-- ============================================================
DROP POLICY IF EXISTS rls_assignments_read_waka_humas ON teaching_assignments;
CREATE POLICY rls_assignments_read_waka_humas ON teaching_assignments
    FOR SELECT
    USING (
        school_id              = fn_current_school_id()
        AND fn_current_user_role() = 'WAKA_HUMAS'::role_type
        AND user_id               = fn_current_user_id()
    );
