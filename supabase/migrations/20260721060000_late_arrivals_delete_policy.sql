-- Guru piket hanya bisa hapus catatan keterlambatan miliknya sendiri,
-- hanya pada hari ia bertugas, dan hanya di sekolahnya sendiri.
CREATE POLICY rls_late_arrivals_delete_own
    ON late_arrivals
    FOR DELETE
    USING (
        school_id = fn_current_school_id()
        AND recorded_by = fn_current_user_id()
        AND fn_is_on_duty_today()
    );
