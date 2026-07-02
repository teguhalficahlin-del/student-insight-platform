-- Index untuk fn_kepsek_monitoring: filter school_id + session_date
-- Query: WHERE ts.session_date BETWEEN x AND y AND ts.school_id = v
CREATE INDEX IF NOT EXISTS idx_schedules_school_date
    ON teaching_schedules(school_id, session_date);
