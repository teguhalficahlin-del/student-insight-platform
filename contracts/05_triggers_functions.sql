-- ============================================================
-- FILE: 05_triggers_functions.sql
-- LAYER: 9 — Triggers + Functions
-- APPLY ORDER: After 04_communication_teacher_ops.sql
--
-- This file enforces every domain invariant that cannot be
-- expressed as a simple column constraint.
--
-- INVENTORY:
--   fn/trg_set_updated_at              — universal updated_at maintenance
--   fn/trg_student_nis_immutable       — NIS cannot be changed after creation
--   fn/trg_observation_visibility_lock — visibility immutable after INSERT
--   fn/trg_case_initiated_by_immutable — initiated_by_role immutable
--   fn/trg_case_events_immutable       — case_events append-only (no UPDATE/DELETE)
--   fn/trg_case_events_no_closed       — INV-1: no events on CLOSED case
--   fn/trg_case_sync_handler           — TN-04: sync denormalized fields on cases
--   fn/trg_parent_msg_lock_check       — INV-4: block INBOUND on locked case
--   fn/trg_teacher_attendance_signal   — TN-02: write activity signal after DML
--   fn/trg_evaluate_teacher_indicator  — TN-02: resolve PENDING after session close
--   fn/trg_pkl_status_consistency      — PKL status requires active placement
--   fn_is_period_closed                — checks if a date falls in a CLOSED academic_period
--   trg_attendance_period_lock         — blocks attendance writes for CLOSED periods
--   trg_observation_period_lock        — blocks observation writes for CLOSED periods
--   trg_journal_period_lock            — blocks journal writes for CLOSED periods
-- ============================================================


-- ============================================================
-- UTILITY: updated_at auto-maintenance
-- Applied to every table that has an updated_at column.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$;

-- Apply to all tables with updated_at
DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'programs', 'subjects', 'users', 'students',
        'classes', 'class_enrollments', 'pkl_placements',
        'teaching_assignments', 'teaching_schedules',
        'substitute_schedules', 'attendance',
        'observations', 'achievements', 'cases',
        'parent_messages', 'teacher_journals',
        'student_updates', 'academic_periods'
    ]
    LOOP
        EXECUTE format(
            'CREATE TRIGGER trg_set_updated_at_%I
             BEFORE UPDATE ON %I
             FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at()',
            t, t
        );
    END LOOP;
END;
$$;


-- ============================================================
-- INVARIANT: NIS is immutable after creation
-- ============================================================

CREATE OR REPLACE FUNCTION fn_student_nis_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.nis IS DISTINCT FROM OLD.nis THEN
        RAISE EXCEPTION
            'domain_invariant_violation: nis is immutable after creation. '
            'student_id=%, old_nis=%, attempted_nis=%',
            OLD.student_id, OLD.nis, NEW.nis
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_student_nis_immutable
    BEFORE UPDATE ON students
    FOR EACH ROW
    WHEN (NEW.nis IS DISTINCT FROM OLD.nis)
    EXECUTE FUNCTION fn_student_nis_immutable();


-- ============================================================
-- INVARIANT: Observation visibility is immutable after INSERT
-- Also sets correct default based on sentiment if not provided.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_observation_visibility_default()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Set default visibility based on sentiment if not explicitly provided
    -- (application should always pass this, but DB enforces the rule)
    IF NEW.sentiment = 'POSITIF' AND NEW.visibility IS NULL THEN
        NEW.visibility := 'STUDENT_VISIBLE';
    ELSIF NEW.sentiment = 'NEGATIF' AND NEW.visibility IS NULL THEN
        NEW.visibility := 'INTERNAL_SCHOOL';
    END IF;

    -- Flag audit when NEGATIF is published STUDENT_VISIBLE
    IF NEW.sentiment = 'NEGATIF' AND NEW.visibility = 'STUDENT_VISIBLE' THEN
        NEW.visibility_override_flag := TRUE;
        -- Audit insert will be handled by application layer logging
        -- DB records the flag; audit trail lives in a separate audit_log table
        -- if required in a future iteration.
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_observation_visibility_default
    BEFORE INSERT ON observations
    FOR EACH ROW
    EXECUTE FUNCTION fn_observation_visibility_default();


CREATE OR REPLACE FUNCTION fn_observation_visibility_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.visibility IS DISTINCT FROM OLD.visibility THEN
        RAISE EXCEPTION
            'domain_invariant_violation: observation visibility is immutable after creation. '
            'observation_id=%',
            OLD.observation_id
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_observation_visibility_immutable
    BEFORE UPDATE ON observations
    FOR EACH ROW
    WHEN (NEW.visibility IS DISTINCT FROM OLD.visibility)
    EXECUTE FUNCTION fn_observation_visibility_immutable();


-- ============================================================
-- INVARIANT: Case.initiated_by_role is immutable after creation
-- ============================================================

CREATE OR REPLACE FUNCTION fn_case_initiated_by_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.initiated_by_role IS DISTINCT FROM OLD.initiated_by_role THEN
        RAISE EXCEPTION
            'domain_invariant_violation: initiated_by_role is immutable. case_id=%',
            OLD.case_id
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_case_initiated_by_immutable
    BEFORE UPDATE ON cases
    FOR EACH ROW
    WHEN (NEW.initiated_by_role IS DISTINCT FROM OLD.initiated_by_role)
    EXECUTE FUNCTION fn_case_initiated_by_immutable();


-- ============================================================
-- INV-1: case_events is append-only
-- No UPDATE or DELETE allowed on any row.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_case_events_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION
            'domain_invariant_violation: case_events is append-only. UPDATE is not permitted. '
            'event_id=%',
            OLD.event_id
            USING ERRCODE = 'P0001';
    ELSIF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION
            'domain_invariant_violation: case_events is append-only. DELETE is not permitted. '
            'event_id=%',
            OLD.event_id
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER trg_case_events_immutable
    BEFORE UPDATE OR DELETE ON case_events
    FOR EACH ROW
    EXECUTE FUNCTION fn_case_events_immutable();


-- ============================================================
-- INV-1: No new events when case.status = CLOSED
-- Fires before INSERT on case_events.
-- Exception: this trigger checks status BEFORE the event is
-- applied. FINAL_DECISION_MADE sets status to CLOSED in the
-- same transaction AFTER the event is inserted — this is safe
-- because FINAL_DECISION_MADE is only valid when status != CLOSED.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_case_events_no_closed()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_status case_status;
BEGIN
    SELECT status INTO v_status
    FROM cases
    WHERE case_id = NEW.case_id;

    IF v_status = 'CLOSED' THEN
        RAISE EXCEPTION
            'domain_invariant_violation (INV-1): cannot add event to a CLOSED case. '
            'case_id=%',
            NEW.case_id
            USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_case_events_no_closed
    BEFORE INSERT ON case_events
    FOR EACH ROW
    EXECUTE FUNCTION fn_case_events_no_closed();


-- ============================================================
-- TN-04: Sync denormalized fields on cases after event INSERT
--
-- After a case_event is inserted, this trigger updates:
--   cases.current_handler_role  — on DECISION_ESCALATE, FINAL_DECISION_MADE
--   cases.is_locked             — on CASE_LOCKED, CASE_UNLOCKED
--   cases.status                — on STATUS_CHANGED, DECISION_CLOSE, FINAL_DECISION_MADE
--   cases.closed_at / closed_by — on DECISION_CLOSE, FINAL_DECISION_MADE
--
-- This is the ONLY place these fields are written after initial INSERT.
-- Application must never write them directly.
-- ============================================================

-- ============================================================
-- INV-4: Block INBOUND parent messages when case is locked
-- ============================================================

CREATE OR REPLACE FUNCTION fn_parent_msg_lock_check()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_is_locked BOOLEAN;
BEGIN
    -- Only relevant for INBOUND messages linked to a case
    IF NEW.direction = 'INBOUND' AND NEW.case_id IS NOT NULL THEN
        SELECT is_locked INTO v_is_locked
        FROM cases
        WHERE case_id = NEW.case_id;

        IF v_is_locked = TRUE THEN
            RAISE EXCEPTION
                'domain_invariant_violation (INV-4): cannot send parent message to a locked case. '
                'case_id=%',
                NEW.case_id
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_parent_msg_lock_check
    BEFORE INSERT ON parent_messages
    FOR EACH ROW
    EXECUTE FUNCTION fn_parent_msg_lock_check();


-- ============================================================
-- TN-02: Write teacher activity signal after relevant DML
-- Fires AFTER INSERT on attendance, observations, teacher_journals.
-- Inserts a row into teacher_attendance_log.
-- Only fires when the action is within an active session window.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_teacher_attendance_signal()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_schedule_id UUID;
    v_user_id     UUID;
    v_activity    VARCHAR(50);
BEGIN
    IF TG_TABLE_NAME = 'attendance' THEN
        v_schedule_id := NEW.schedule_id;
        v_user_id     := NEW.recorded_by_user_id;
        v_activity    := 'ATTENDANCE_SUBMITTED';

    ELSIF TG_TABLE_NAME = 'observations' THEN
        -- Observations only signal if linked to a schedule
        IF NEW.schedule_id IS NULL THEN
            RETURN NEW;
        END IF;
        v_schedule_id := NEW.schedule_id;
        v_user_id     := NEW.author_user_id;
        v_activity    := 'OBSERVATION_CREATED';

    ELSIF TG_TABLE_NAME = 'teacher_journals' THEN
        IF NEW.schedule_id IS NULL THEN
            RETURN NEW;
        END IF;
        v_schedule_id := NEW.schedule_id;
        v_user_id     := NEW.owner_user_id;
        v_activity    := 'JOURNAL_ENTRY_CREATED';
    END IF;

    -- Only insert signal if schedule's teacher_indicator is still PENDING
    -- and the session is today (guard against backdated entries changing old indicators)
    INSERT INTO teacher_attendance_log (schedule_id, user_id, activity_type)
    SELECT v_schedule_id, v_user_id, v_activity
    WHERE EXISTS (
        SELECT 1 FROM teaching_schedules
        WHERE schedule_id    = v_schedule_id
          AND session_date   = CURRENT_DATE
          AND teacher_indicator = 'PENDING_EVALUATION'
    )
    ON CONFLICT DO NOTHING;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_teacher_signal_attendance
    AFTER INSERT ON attendance
    FOR EACH ROW
    EXECUTE FUNCTION fn_teacher_attendance_signal();

CREATE TRIGGER trg_teacher_signal_observation
    AFTER INSERT ON observations
    FOR EACH ROW
    EXECUTE FUNCTION fn_teacher_attendance_signal();

CREATE TRIGGER trg_teacher_signal_journal
    AFTER INSERT ON teacher_journals
    FOR EACH ROW
    EXECUTE FUNCTION fn_teacher_attendance_signal();


-- ============================================================
-- TN-02: Evaluate teacher_indicator after session window closes
-- This function is called by a Supabase scheduled Edge Function
-- (cron: end of each school day, e.g., 17:00 WIB).
-- It resolves all PENDING_EVALUATION schedules for the given date.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_evaluate_teacher_indicators(p_session_date DATE DEFAULT CURRENT_DATE)
RETURNS TABLE (
    schedule_id   UUID,
    resolved_to   teacher_attendance_indicator
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH resolved AS (
        UPDATE teaching_schedules ts
        SET teacher_indicator = CASE
            WHEN EXISTS (
                SELECT 1 FROM teacher_attendance_log tal
                WHERE tal.schedule_id = ts.schedule_id
            ) THEN 'HADIR'::teacher_attendance_indicator
            ELSE 'TIDAK_HADIR'::teacher_attendance_indicator
        END
        WHERE ts.session_date       = p_session_date
          AND ts.teacher_indicator  = 'PENDING_EVALUATION'
          AND ts.meeting_status     = 'NORMAL'
          -- Do not resolve substituted sessions here; substitute signal handled separately
          AND NOT EXISTS (
              SELECT 1 FROM substitute_schedules ss
              WHERE ss.schedule_id = ts.schedule_id
          )
        RETURNING ts.schedule_id, ts.teacher_indicator
    )
    SELECT r.schedule_id, r.teacher_indicator FROM resolved r;
END;
$$;

COMMENT ON FUNCTION fn_evaluate_teacher_indicators IS
    'TN-02: Called by scheduled Edge Function at end of school day. '
    'Resolves PENDING_EVALUATION → HADIR or TIDAK_HADIR based on '
    'teacher_attendance_log activity signals. Returns resolved rows for logging.';


-- ============================================================
-- CONSISTENCY: PKL student must have active placement
-- Fires BEFORE UPDATE on students when status changes to PKL.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_pkl_status_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Transitioning TO PKL status
    IF NEW.student_status = 'PKL' AND OLD.student_status != 'PKL' THEN
        IF NOT EXISTS (
            SELECT 1 FROM pkl_placements
            WHERE student_id = NEW.student_id
              AND is_active  = TRUE
              AND start_date <= CURRENT_DATE
              AND end_date   >= CURRENT_DATE
        ) THEN
            RAISE EXCEPTION
                'domain_invariant_violation: student cannot be set to PKL status '
                'without an active pkl_placement. student_id=%',
                NEW.student_id
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    -- Transitioning AWAY from PKL status: deactivate placement
    IF OLD.student_status = 'PKL' AND NEW.student_status != 'PKL' THEN
        UPDATE pkl_placements
        SET is_active  = FALSE,
            updated_at = NOW()
        WHERE student_id = NEW.student_id
          AND is_active  = TRUE;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_pkl_status_consistency
    BEFORE UPDATE ON students
    FOR EACH ROW
    WHEN (NEW.student_status IS DISTINCT FROM OLD.student_status)
    EXECUTE FUNCTION fn_pkl_status_consistency();


-- ============================================================
-- UTILITY: Void all attendance records for a session
-- Called when teaching_schedules.meeting_status is set to
-- GURU_TIDAK_HADIR. Records are voided, not deleted.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_void_session_attendance()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Fires when meeting_status transitions to GURU_TIDAK_HADIR
    IF NEW.meeting_status = 'GURU_TIDAK_HADIR'
       AND OLD.meeting_status IS DISTINCT FROM 'GURU_TIDAK_HADIR' THEN

        UPDATE attendance
        SET is_void     = TRUE,
            void_reason = 'GURU_TIDAK_HADIR: session voided automatically',
            updated_at  = NOW()
        WHERE schedule_id = NEW.schedule_id
          AND is_void     = FALSE;

    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_void_session_attendance
    AFTER UPDATE ON teaching_schedules
    FOR EACH ROW
    WHEN (NEW.meeting_status = 'GURU_TIDAK_HADIR'
          AND OLD.meeting_status IS DISTINCT FROM NEW.meeting_status)
    EXECUTE FUNCTION fn_void_session_attendance();


-- ============================================================
-- UTILITY: Prevent direct writes to denormalized case fields
-- Guards against application accidentally bypassing the trigger.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_case_guard_denormalized()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Allow only if triggered from within fn_case_sync_handler
    -- Implementation: use a session-level flag set by fn_case_sync_handler
    -- This is a lightweight advisory guard — not a hard cryptographic lock.
    -- The authoritative enforcement is the event-sourced contract.
    IF NEW.current_handler_role IS DISTINCT FROM OLD.current_handler_role
       OR NEW.is_locked IS DISTINCT FROM OLD.is_locked
    THEN
        -- Check that the change originates from the sync trigger
        -- by verifying a session variable set in fn_case_sync_handler
        IF current_setting('app.case_sync_active', TRUE) IS DISTINCT FROM 'true' THEN
            RAISE EXCEPTION
                'integrity_guard: current_handler_role and is_locked must only be '
                'modified via case_events INSERT (trigger trg_case_sync_handler). '
                'Direct UPDATE is not permitted. case_id=%',
                NEW.case_id
                USING ERRCODE = 'P0003';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

-- Update fn_case_sync_handler to set the session flag
CREATE OR REPLACE FUNCTION fn_case_sync_handler()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Set advisory flag so guard trigger allows this update
    PERFORM set_config('app.case_sync_active', 'true', TRUE);

    IF NEW.event_type = 'DECISION_ESCALATE' THEN
        UPDATE cases SET
            current_handler_role = NEW.new_handler_role,
            status               = COALESCE(NEW.new_status, status)
        WHERE case_id = NEW.case_id;

    ELSIF NEW.event_type = 'FINAL_DECISION_MADE' THEN
        UPDATE cases SET
            status            = 'CLOSED',
            closed_at         = NOW(),
            closed_by_user_id = NEW.author_user_id
        WHERE case_id = NEW.case_id;

    ELSIF NEW.event_type = 'DECISION_CLOSE' THEN
        UPDATE cases SET
            status            = 'CLOSED',
            closed_at         = NOW(),
            closed_by_user_id = NEW.author_user_id
        WHERE case_id = NEW.case_id;

    ELSIF NEW.event_type = 'STATUS_CHANGED' THEN
        IF NEW.new_status IS NULL THEN
            RAISE EXCEPTION
                'trigger_error: STATUS_CHANGED event must include new_status. event_id=%',
                NEW.event_id USING ERRCODE = 'P0002';
        END IF;
        UPDATE cases SET status = NEW.new_status WHERE case_id = NEW.case_id;

    ELSIF NEW.event_type = 'CASE_LOCKED' THEN
        UPDATE cases SET
            is_locked         = TRUE,
            locked_by_user_id = NEW.author_user_id,
            locked_at         = NOW()
        WHERE case_id = NEW.case_id;

    ELSIF NEW.event_type = 'CASE_UNLOCKED' THEN
        UPDATE cases SET
            is_locked         = FALSE,
            locked_by_user_id = NULL,
            locked_at         = NULL
        WHERE case_id = NEW.case_id;
    END IF;

    -- Reset flag
    PERFORM set_config('app.case_sync_active', 'false', TRUE);

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_case_sync_handler
    AFTER INSERT ON case_events
    FOR EACH ROW
    EXECUTE FUNCTION fn_case_sync_handler();

CREATE TRIGGER trg_case_guard_denormalized
    BEFORE UPDATE ON cases
    FOR EACH ROW
    EXECUTE FUNCTION fn_case_guard_denormalized();


-- ============================================================
-- AUDIENS KASUS + KUNCI ESKALASI (mig 20260703250000, Langkah A)
-- ============================================================

-- "Aktor internal kasus" = 6 peran (via role_type ATAU jabatan-flag).
CREATE OR REPLACE FUNCTION fn_is_internal_case_actor()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
    SELECT fn_current_user_role() = ANY (ARRAY['GURU','BK','WALI_KELAS','KAPRODI','WAKA_KESISWAAN','KEPSEK']::role_type[])
        OR fn_is_bk() OR fn_is_kepsek() OR fn_is_waka_kesiswaan();
$$;

-- Apakah user (by id) aktor internal kasus — untuk validasi anggota audiens.
CREATE OR REPLACE FUNCTION fn_user_is_internal_case_actor(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
    SELECT EXISTS (
        SELECT 1 FROM users u
        WHERE u.user_id = p_user_id
          AND ( u.role_type = ANY (ARRAY['GURU','BK','WALI_KELAS','KAPRODI','WAKA_KESISWAAN','KEPSEK']::role_type[])
                OR u.is_bk OR u.is_kepsek OR u.is_waka_kesiswaan )
    );
$$;

-- Boleh-lihat-kasus TERPADU (dipakai baca cases & case_events → konsisten).
-- Sertakan fn_matches_case_handler agar penangan yang BARU dieskalasi (belum
-- menulis event) tetap bisa melihat kasus PRIVAT-nya.
CREATE OR REPLACE FUNCTION fn_can_see_case(p_case_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
    SELECT EXISTS (
        SELECT 1 FROM cases c
        WHERE c.case_id   = p_case_id
          AND c.school_id = fn_current_school_id()
          AND (
                fn_involved_in_case(p_case_id)
             OR fn_matches_case_handler(c.current_handler_role, c.student_id)
             OR (c.audience = 'PUBLIC'     AND fn_is_internal_case_actor())
             OR (c.audience = 'RESTRICTED' AND EXISTS (
                    SELECT 1 FROM case_audience_members m
                    WHERE m.case_id = p_case_id AND m.user_id = fn_current_user_id()))
             OR (fn_current_user_role() = 'DUDI' AND fn_dudi_supervises_student(c.student_id))
          )
    );
$$;

-- Kunci KERAS eskalasi: target wajib peran internal; DUDI hanya -> KAPRODI.
-- (Eskalasi antar-internal tetap BEBAS — tak ada penegakan urutan rantai.)
CREATE OR REPLACE FUNCTION fn_case_validate_escalate()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.event_type = 'DECISION_ESCALATE' THEN
        IF NEW.new_handler_role IS NULL
           OR NOT (NEW.new_handler_role = ANY (ARRAY['GURU','BK','WALI_KELAS','KAPRODI','WAKA_KESISWAAN','KEPSEK']::role_type[]))
        THEN
            RAISE EXCEPTION 'escalate_target_invalid: % bukan peran internal penangan kasus', NEW.new_handler_role
                USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.author_role_at_time = 'DUDI' AND NEW.new_handler_role <> 'KAPRODI' THEN
            RAISE EXCEPTION 'escalate_dudi_only_kaprodi: DUDI hanya boleh eskalasi ke KAPRODI'
                USING ERRCODE = 'check_violation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_case_validate_escalate
    BEFORE INSERT ON case_events
    FOR EACH ROW
    EXECUTE FUNCTION fn_case_validate_escalate();


-- ============================================================
-- PERIOD LOCKING
-- Locks period-bound data (attendance, observations, journals)
-- by event date, not by record FK. See contracts/01 academic_periods
-- and the design rationale: cases/intervensi/komunikasi orang tua
-- are long-lived and intentionally NOT locked here.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_is_period_closed(p_date DATE)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
    SELECT EXISTS (
        SELECT 1 FROM academic_periods
        WHERE start_date <= p_date
          AND end_date   >= p_date
          AND status      = 'CLOSED'
    );
$$;

COMMENT ON FUNCTION fn_is_period_closed IS
    'TRUE if p_date falls inside an academic_periods row with status = CLOSED. '
    'Used by period-lock triggers on attendance/observations/teacher_journals.';

-- attendance has no date column of its own — session_date lives on
-- teaching_schedules, reached via schedule_id.
CREATE OR REPLACE FUNCTION fn_attendance_period_lock()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_session_date DATE;
BEGIN
    SELECT session_date INTO v_session_date
    FROM teaching_schedules
    WHERE schedule_id = NEW.schedule_id;

    IF fn_is_period_closed(v_session_date) THEN
        RAISE EXCEPTION
            'Periode sudah ditutup untuk tanggal %. Tidak dapat menambah/mengubah absensi.',
            v_session_date USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_attendance_period_lock
    BEFORE INSERT OR UPDATE ON attendance
    FOR EACH ROW
    EXECUTE FUNCTION fn_attendance_period_lock();

CREATE OR REPLACE FUNCTION fn_observation_period_lock()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF fn_is_period_closed(NEW.observed_at) THEN
        RAISE EXCEPTION
            'Periode sudah ditutup untuk tanggal %. Tidak dapat menambah/mengubah observasi.',
            NEW.observed_at USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_observation_period_lock
    BEFORE INSERT OR UPDATE ON observations
    FOR EACH ROW
    EXECUTE FUNCTION fn_observation_period_lock();

CREATE OR REPLACE FUNCTION fn_journal_period_lock()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF fn_is_period_closed(NEW.entry_date) THEN
        RAISE EXCEPTION
            'Periode sudah ditutup untuk tanggal %. Tidak dapat menambah/mengubah jurnal.',
            NEW.entry_date USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_journal_period_lock
    BEFORE INSERT OR UPDATE ON teacher_journals
    FOR EACH ROW
    EXECUTE FUNCTION fn_journal_period_lock();
