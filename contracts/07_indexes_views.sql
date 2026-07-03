-- ============================================================
-- FILE: 07_indexes_views.sql
-- LAYER: Indexes + Views
-- APPLY ORDER: After 06_rls_policies.sql
--
-- PURPOSE:
--   Composite indexes for the most expensive query patterns.
--   Views for dashboard aggregations (Kepsek exception-based).
--   Views for student portal (Perkembangan Positif, Prestasi).
--   Views for offline sync manifest (Category A payload shapes).
-- ============================================================


-- ============================================================
-- COMPOSITE INDEXES
-- Beyond the single-column indexes already defined on tables.
-- ============================================================

-- Attendance summary per class per date (daily dashboard)
CREATE INDEX idx_att_class_date_status
    ON attendance(schedule_id, status)
    INCLUDE (student_id, is_void)
    WHERE is_void = FALSE;

-- Case handler workload (handler dashboard)
CREATE INDEX idx_cases_handler_status_created
    ON cases(current_handler_role, status, created_at DESC)
    WHERE status != 'CLOSED';

-- Case events timeline per case
CREATE INDEX idx_case_events_timeline
    ON case_events(case_id, created_at ASC)
    INCLUDE (event_type, author_user_id, privacy_level);

-- Observation feed per student (student portal)
CREATE INDEX idx_obs_student_visible_date
    ON observations(student_id, observed_at DESC)
    WHERE visibility = 'STUDENT_VISIBLE' AND sentiment = 'POSITIF';

-- Teacher schedule lookup for offline sync
CREATE INDEX idx_schedules_teacher_upcoming
    ON teaching_schedules(scheduled_teacher_id, session_date ASC)
    WHERE teacher_indicator = 'PENDING_EVALUATION';

-- Parent message inbox per student
CREATE INDEX idx_parent_msg_student_date
    ON parent_messages(student_id, created_at DESC);

-- PKL active placement lookup
CREATE INDEX idx_pkl_active_student
    ON pkl_placements(student_id, dudi_user_id)
    WHERE is_active = TRUE;

-- Journal entries by owner and date (offline sync)
CREATE INDEX idx_journals_owner_date
    ON teacher_journals(owner_user_id, entry_date DESC);


-- ============================================================
-- VIEW: v_attendance_daily_summary
-- Used by: Kepsek dashboard, Wali Kelas dashboard.
-- Shows per-class attendance totals for a given date.
-- Exception-based: highlights classes with high absence rate.
-- RLS applies to the underlying tables — this view inherits it.
-- ============================================================

-- CATATAN KEAMANAN (SEC-1, mig 20260703230000): SEMUA view di bawah WAJIB
-- `WITH (security_invoker = true)` agar menegakkan RLS PENANYA. Tanpa itu view
-- berjalan sebagai owner (postgres) → bypass RLS → anon/lintas-tenant bocor.
-- Dijaga oleh tests/tenant-isolation.mjs CHECK 6.
CREATE OR REPLACE VIEW v_attendance_daily_summary
    WITH (security_invoker = true) AS
SELECT
    ts.schedule_id,
    ts.session_date,
    ts.class_id,
    c.name                                              AS class_name,
    ts.scheduled_teacher_id,
    u.full_name                                         AS teacher_name,
    ts.meeting_status,
    ts.teacher_indicator,
    COUNT(a.attendance_id)
        FILTER (WHERE a.is_void = FALSE)                AS total_students,
    COUNT(a.attendance_id)
        FILTER (WHERE a.status = 'HADIR'   AND a.is_void = FALSE) AS hadir,
    COUNT(a.attendance_id)
        FILTER (WHERE a.status = 'TIDAK_HADIR' AND a.is_void = FALSE) AS tidak_hadir,
    COUNT(a.attendance_id)
        FILTER (WHERE a.status = 'IZIN'    AND a.is_void = FALSE) AS izin,
    COUNT(a.attendance_id)
        FILTER (WHERE a.status = 'SAKIT'   AND a.is_void = FALSE) AS sakit,
    ROUND(
        COUNT(a.attendance_id) FILTER (WHERE a.status = 'HADIR' AND a.is_void = FALSE)::NUMERIC
        / NULLIF(COUNT(a.attendance_id) FILTER (WHERE a.is_void = FALSE), 0) * 100,
        1
    )                                                   AS hadir_pct
FROM teaching_schedules ts
JOIN classes c ON c.class_id = ts.class_id
JOIN users u   ON u.user_id  = ts.scheduled_teacher_id
LEFT JOIN attendance a ON a.schedule_id = ts.schedule_id
GROUP BY
    ts.schedule_id, ts.session_date, ts.class_id, c.name,
    ts.scheduled_teacher_id, u.full_name,
    ts.meeting_status, ts.teacher_indicator;

COMMENT ON VIEW v_attendance_daily_summary IS
    'Per-schedule attendance aggregation. Used by Kepsek exception dashboard '
    'and Wali Kelas class view. RLS inherited from underlying tables.';


-- ============================================================
-- VIEW: v_kepsek_exception_dashboard
-- Exception-based. Shows only anomalies:
--   - Classes with hadir_pct < 80% today
--   - Open cases not updated in > 3 days
--   - Teachers with TIDAK_HADIR indicator (no substitute)
-- ============================================================

CREATE OR REPLACE VIEW v_kepsek_exception_dashboard
    WITH (security_invoker = true) AS

-- Exception 1: Low attendance classes (today)
SELECT
    'LOW_ATTENDANCE'::TEXT          AS exception_type,
    ads.class_id::TEXT              AS entity_id,
    ads.class_name                  AS entity_label,
    ads.session_date::TEXT          AS context_date,
    ('Kehadiran ' || ads.hadir_pct || '%')::TEXT AS detail
FROM v_attendance_daily_summary ads
WHERE ads.session_date  = CURRENT_DATE
  AND ads.meeting_status = 'NORMAL'
  AND ads.hadir_pct < 80

UNION ALL

-- Exception 2: Stale open cases (> 3 days without new event)
SELECT
    'STALE_CASE'                    AS exception_type,
    c.case_id::TEXT                 AS entity_id,
    c.title                         AS entity_label,
    c.updated_at::DATE::TEXT        AS context_date,
    ('Handler: ' || c.current_handler_role::TEXT
     || ' · ' || EXTRACT(DAY FROM NOW() - c.updated_at)::INT::TEXT || ' hari')
                                    AS detail
FROM cases c
WHERE c.status != 'CLOSED'
  AND c.updated_at < NOW() - INTERVAL '3 days'

UNION ALL

-- Exception 3: Teachers with TIDAK_HADIR today and no substitute
SELECT
    'TEACHER_ABSENT'                AS exception_type,
    ts.scheduled_teacher_id::TEXT   AS entity_id,
    u.full_name                     AS entity_label,
    ts.session_date::TEXT           AS context_date,
    ('Kelas: ' || c.name)          AS detail
FROM teaching_schedules ts
JOIN users  u ON u.user_id   = ts.scheduled_teacher_id
JOIN classes c ON c.class_id = ts.class_id
WHERE ts.session_date    = CURRENT_DATE
  AND ts.teacher_indicator = 'TIDAK_HADIR'
  AND ts.meeting_status    = 'NORMAL'
  AND NOT EXISTS (
      SELECT 1 FROM substitute_schedules ss
      WHERE ss.schedule_id = ts.schedule_id
  );

COMMENT ON VIEW v_kepsek_exception_dashboard IS
    'Exception-based Kepsek dashboard. Three exception types: LOW_ATTENDANCE, '
    'STALE_CASE, TEACHER_ABSENT. Returns only anomalies — not full records.';


-- ============================================================
-- VIEW: v_student_portal_positif
-- Powers "Perkembangan Positif" section of student portal.
-- Only STUDENT_VISIBLE POSITIF observations.
-- ============================================================

CREATE OR REPLACE VIEW v_student_portal_positif
    WITH (security_invoker = true) AS
SELECT
    o.observation_id,
    o.student_id,
    o.dimension,
    o.content,
    o.observed_at,
    u.full_name     AS author_name,
    u.role_type     AS author_role
FROM observations o
JOIN users u ON u.user_id = o.author_user_id
WHERE o.sentiment   = 'POSITIF'
  AND o.visibility  = 'STUDENT_VISIBLE'
ORDER BY o.observed_at DESC;

COMMENT ON VIEW v_student_portal_positif IS
    'Perkembangan Positif feed for student portal. '
    'Only POSITIF + STUDENT_VISIBLE observations. Ordered newest first.';


-- ============================================================
-- VIEW: v_student_portal_achievements
-- Powers "Prestasi & Penghargaan" section of student portal.
-- ============================================================

CREATE OR REPLACE VIEW v_student_portal_achievements
    WITH (security_invoker = true) AS
SELECT
    a.achievement_id,
    a.student_id,
    a.title,
    a.description,
    a.category,
    a.scope,
    a.achieved_at,
    u.full_name     AS recorded_by_name
FROM achievements a
JOIN users u ON u.user_id = a.recorded_by_user_id
WHERE a.is_voided = FALSE
ORDER BY a.achieved_at DESC;

COMMENT ON VIEW v_student_portal_achievements IS
    'Prestasi & Penghargaan for student portal. Excludes voided achievements.';


-- ============================================================
-- VIEW: v_case_timeline
-- Full event timeline for a case with author metadata.
-- Used by case detail page (all staff roles).
-- Privacy filtering done client-side based on role —
-- or add WHERE privacy_level != 'PRIVATE' for non-KEPSEK roles.
-- ============================================================

CREATE OR REPLACE VIEW v_case_timeline
    WITH (security_invoker = true) AS
SELECT
    ce.event_id,
    ce.case_id,
    ce.event_type,
    ce.privacy_level,
    ce.created_at,
    ce.author_user_id,
    u.full_name                 AS author_name,
    ce.author_role_at_time,
    ce.previous_handler_role,
    ce.new_handler_role,
    ce.previous_status,
    ce.new_status,
    ce.payload,
    -- Student update content if this event has one
    su.content                  AS student_update_content
FROM case_events ce
JOIN users u ON u.user_id = ce.author_user_id
LEFT JOIN student_updates su ON su.case_event_id = ce.event_id
ORDER BY ce.case_id, ce.created_at ASC;

COMMENT ON VIEW v_case_timeline IS
    'Full case event timeline with author metadata and student update content. '
    'Privacy filtering (PRIVATE events) must be applied at query time for non-KEPSEK roles.';


-- ============================================================
-- VIEW: v_offline_sync_manifest_guru
-- Defines the payload shape for Category A offline sync
-- for a GURU user. Returns all data needed for offline operation
-- for a given teacher on a given date window.
--
-- Used by the Service Worker sync logic to determine what to
-- pull into IndexedDB on login / background sync.
-- Returns rows per schedule with nested JSON for students.
-- ============================================================

CREATE OR REPLACE VIEW v_offline_sync_manifest_guru
    WITH (security_invoker = true) AS
SELECT
    ts.schedule_id,
    ts.session_date,
    ts.session_start,
    ts.session_end,
    ts.class_id,
    c.name                              AS class_name,
    ts.subject_id,
    s.name                              AS subject_name,
    ts.scheduled_teacher_id,
    ts.meeting_status,
    -- Enrolled students with their latest attendance status for this session
    JSON_AGG(
        JSON_BUILD_OBJECT(
            'student_id',   st.student_id,
            'nis',          st.nis,
            'full_name',    st.full_name,
            'att_status',   COALESCE(a.status, 'HADIR'),
            'att_source',   COALESCE(a.source::TEXT, 'AUTO_DETECTED'),
            'att_id',       a.attendance_id
        )
        ORDER BY st.full_name
    )                                   AS students_json
FROM teaching_schedules ts
JOIN classes c ON c.class_id = ts.class_id
JOIN subjects s ON s.subject_id = ts.subject_id
JOIN class_enrollments ce ON ce.class_id = ts.class_id
    AND ce.academic_year = ts.academic_year
    AND ce.semester      = ts.semester
    AND ce.withdrawn_at  IS NULL
JOIN students st ON st.student_id = ce.student_id
LEFT JOIN attendance a ON a.schedule_id = ts.schedule_id
    AND a.student_id = st.student_id
    AND a.is_void    = FALSE
WHERE ts.session_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
GROUP BY
    ts.schedule_id, ts.session_date, ts.session_start, ts.session_end,
    ts.class_id, c.name, ts.subject_id, s.name,
    ts.scheduled_teacher_id, ts.meeting_status;

COMMENT ON VIEW v_offline_sync_manifest_guru IS
    'Category A offline sync payload for GURU. '
    'Returns next 7 days of schedules with enrolled students and current attendance. '
    'Service Worker queries this filtered by scheduled_teacher_id = current user. '
    'Substitute schedules are handled separately via v_offline_sync_manifest_substitute.';


-- ============================================================
-- VIEW: v_offline_sync_manifest_substitute
-- Same shape as guru manifest but for substitute teachers.
-- Scoped to sessions where a valid substitute_schedule exists
-- for the current user with a non-expired token.
-- ============================================================

CREATE OR REPLACE VIEW v_offline_sync_manifest_substitute
    WITH (security_invoker = true) AS
SELECT
    ts.schedule_id,
    ts.session_date,
    ts.session_start,
    ts.session_end,
    ts.class_id,
    c.name                              AS class_name,
    ts.subject_id,
    s.name                              AS subject_name,
    ss.substitute_user_id,
    ss.sync_token,
    ss.sync_token_expires_at,
    ts.meeting_status,
    JSON_AGG(
        JSON_BUILD_OBJECT(
            'student_id',   st.student_id,
            'nis',          st.nis,
            'full_name',    st.full_name,
            'att_status',   COALESCE(a.status, 'HADIR'),
            'att_source',   COALESCE(a.source::TEXT, 'AUTO_DETECTED'),
            'att_id',       a.attendance_id
        )
        ORDER BY st.full_name
    )                                   AS students_json
FROM substitute_schedules ss
JOIN teaching_schedules ts ON ts.schedule_id = ss.schedule_id
JOIN classes c ON c.class_id = ts.class_id
JOIN subjects s ON s.subject_id = ts.subject_id
JOIN class_enrollments ce ON ce.class_id   = ts.class_id
    AND ce.academic_year = ts.academic_year
    AND ce.semester      = ts.semester
    AND ce.withdrawn_at  IS NULL
JOIN students st ON st.student_id = ce.student_id
LEFT JOIN attendance a ON a.schedule_id = ts.schedule_id
    AND a.student_id = st.student_id
    AND a.is_void    = FALSE
WHERE ss.sync_token_expires_at > NOW()
GROUP BY
    ts.schedule_id, ts.session_date, ts.session_start, ts.session_end,
    ts.class_id, c.name, ts.subject_id, s.name,
    ss.substitute_user_id, ss.sync_token, ss.sync_token_expires_at,
    ts.meeting_status;

COMMENT ON VIEW v_offline_sync_manifest_substitute IS
    'TN-07: Category A offline sync payload for substitute teachers. '
    'Filtered by non-expired sync_token. Service Worker queries filtered by substitute_user_id.';
