-- Migration: fix_forum_assignment_rls
-- Tujuan: ubah policy write bk_class_assignments dan
-- guru_wali_assignments dari KEPSEK+WAKA_KESISWAAN
-- menjadi ADMINISTRATIVE saja.
-- Alasan: penugasan BK & Guru Wali dilakukan oleh Admin
-- via wizard — bukan oleh KEPSEK/WAKA_KESISWAAN langsung.

-- bk_class_assignments
DROP POLICY IF EXISTS rls_bk_class_write ON bk_class_assignments;
CREATE POLICY rls_bk_class_write ON bk_class_assignments
    FOR ALL
    TO authenticated
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'
    )
    WITH CHECK (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'
    );

-- guru_wali_assignments
DROP POLICY IF EXISTS rls_guru_wali_write ON guru_wali_assignments;
CREATE POLICY rls_guru_wali_write ON guru_wali_assignments
    FOR ALL
    TO authenticated
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'
    )
    WITH CHECK (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'
    );
