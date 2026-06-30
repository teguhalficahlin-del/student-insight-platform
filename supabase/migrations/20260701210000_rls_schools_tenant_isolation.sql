DROP POLICY IF EXISTS rls_schools_read_all ON schools;

CREATE POLICY rls_schools_read_own
    ON schools FOR SELECT
    TO authenticated
    USING (
        school_id = (
            SELECT school_id FROM users
            WHERE auth_user_id = auth.uid()
            LIMIT 1
        )
    );
