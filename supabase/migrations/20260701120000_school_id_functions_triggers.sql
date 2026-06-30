-- ============================================================
-- FASE 1 Multi-tenant — Langkah 3: Fungsi & trigger auto school_id
-- ============================================================

-- ── Fungsi: ambil school_id user yang sedang login ────────────
CREATE OR REPLACE FUNCTION fn_current_school_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT school_id FROM users WHERE auth_user_id = auth.uid() LIMIT 1
$$;

-- ── Trigger function: auto-set school_id saat INSERT ──────────
CREATE OR REPLACE FUNCTION fn_auto_set_school_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.school_id IS NULL THEN
        NEW.school_id := fn_current_school_id();
    END IF;
    RETURN NEW;
END;
$$;

-- ── Pasang trigger ke semua tabel ─────────────────────────────
DO $$ DECLARE tbl TEXT;
BEGIN
FOR tbl IN SELECT unnest(ARRAY[
    'students','classes','programs','subjects','academic_periods',
    'schedule_time_slots','schedule_templates','school_config',
    'class_enrollments','teaching_assignments','teaching_schedules',
    'attendance','pkl_placements','pkl_attendance','observations',
    'cases','case_events','achievements','parent_messages',
    'student_parents','substitute_schedules','teacher_journals',
    'teacher_attendance_log','student_updates','sync_idempotency'
]) LOOP
    EXECUTE format(
        'DROP TRIGGER IF EXISTS trg_auto_school_id ON %I;
         CREATE TRIGGER trg_auto_school_id
         BEFORE INSERT ON %I
         FOR EACH ROW EXECUTE FUNCTION fn_auto_set_school_id();',
        tbl, tbl
    );
END LOOP;
END $$;
