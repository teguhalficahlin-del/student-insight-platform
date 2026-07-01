-- ============================================================
-- FIX C1 — Jalur tulis sisi-server gagal NOT NULL school_id
-- ============================================================
-- Akar masalah: fn_auto_set_school_id hanya mengisi school_id dari
-- fn_current_school_id() (berbasis auth.uid()). Untuk penulisan
-- service-role (RPC SECURITY DEFINER & edge function) auth.uid()=NULL
-- → school_id NULL → pelanggaran NOT NULL.
--
-- Perbaikan: bila jalur JWT tak menghasilkan school_id (service-role),
-- WARISKAN school_id dari baris INDUK via FK (model tenant hirarkis).
-- Jalur portal (JWT) tidak berubah sama sekali: fn_current_school_id()
-- non-null → dipakai langsung, derivasi dilewati.
--
-- Tabel "tanpa induk" (programs, subjects, academic_periods, users,
-- schedule_time_slots, sync_idempotency) tetap harus menyetel school_id
-- eksplisit di pembuatnya (ditangani terpisah pada fungsi masing-masing).
-- ============================================================

CREATE OR REPLACE FUNCTION fn_auto_set_school_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sid uuid;
BEGIN
    -- Sudah diisi eksplisit (mis. oleh RPC yang sadar-tenant) → hormati.
    IF NEW.school_id IS NOT NULL THEN
        RETURN NEW;
    END IF;

    -- 1) Jalur JWT user (portal) — perilaku lama, tak berubah.
    v_sid := fn_current_school_id();

    -- 2) Jalur service-role (auth.uid()=NULL) — warisi dari induk via FK.
    IF v_sid IS NULL THEN
        CASE TG_TABLE_NAME
            WHEN 'students' THEN
                SELECT school_id INTO v_sid FROM programs WHERE program_id = NEW.program_id;
            WHEN 'classes' THEN
                SELECT school_id INTO v_sid FROM programs WHERE program_id = NEW.program_id;
            WHEN 'class_enrollments' THEN
                SELECT school_id INTO v_sid FROM classes WHERE class_id = NEW.class_id;
            WHEN 'teaching_assignments' THEN
                SELECT school_id INTO v_sid FROM classes WHERE class_id = NEW.class_id;
            WHEN 'teaching_schedules' THEN
                SELECT school_id INTO v_sid FROM classes WHERE class_id = NEW.class_id;
            WHEN 'schedule_templates' THEN
                SELECT school_id INTO v_sid FROM classes WHERE class_id = NEW.class_id;
            WHEN 'attendance' THEN
                SELECT school_id INTO v_sid FROM teaching_schedules WHERE schedule_id = NEW.schedule_id;
            WHEN 'teacher_attendance_log' THEN
                SELECT school_id INTO v_sid FROM teaching_schedules WHERE schedule_id = NEW.schedule_id;
            WHEN 'substitute_schedules' THEN
                SELECT school_id INTO v_sid FROM teaching_schedules WHERE schedule_id = NEW.schedule_id;
            WHEN 'observations' THEN
                SELECT school_id INTO v_sid FROM students WHERE student_id = NEW.student_id;
            WHEN 'achievements' THEN
                SELECT school_id INTO v_sid FROM students WHERE student_id = NEW.student_id;
            WHEN 'cases' THEN
                SELECT school_id INTO v_sid FROM students WHERE student_id = NEW.student_id;
            WHEN 'parent_messages' THEN
                SELECT school_id INTO v_sid FROM students WHERE student_id = NEW.student_id;
            WHEN 'student_parents' THEN
                SELECT school_id INTO v_sid FROM students WHERE student_id = NEW.student_id;
            WHEN 'pkl_placements' THEN
                SELECT school_id INTO v_sid FROM students WHERE student_id = NEW.student_id;
            WHEN 'case_events' THEN
                SELECT school_id INTO v_sid FROM cases WHERE case_id = NEW.case_id;
            WHEN 'student_updates' THEN
                SELECT school_id INTO v_sid FROM cases WHERE case_id = NEW.case_id;
            WHEN 'pkl_attendance' THEN
                SELECT school_id INTO v_sid FROM pkl_placements WHERE placement_id = NEW.placement_id;
            WHEN 'teacher_journals' THEN
                SELECT school_id INTO v_sid FROM users WHERE user_id = NEW.owner_user_id;
            ELSE
                v_sid := NULL;
        END CASE;
    END IF;

    NEW.school_id := v_sid;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION fn_auto_set_school_id() IS
    'Isi school_id otomatis: jalur JWT via fn_current_school_id(); '
    'jalur service-role warisi dari baris induk via FK. FIX C1.';
