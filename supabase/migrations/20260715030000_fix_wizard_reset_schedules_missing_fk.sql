-- Fix fn_wizard_reset_schedules: tambah DELETE untuk teacher_attendance_log
-- dan teacher_journals yang menyebabkan FK RESTRICT 409 saat reset jadwal wizard.
--
-- Root cause: dua tabel punya schedule_id REFERENCES teaching_schedules ON DELETE RESTRICT
-- tapi tidak di-handle sebelum DELETE teaching_schedules:
--   - teacher_attendance_log: schedule_id NOT NULL (ditulis otomatis tiap aktivitas guru)
--   - teacher_journals:       schedule_id nullable (ditulis guru saat buat jurnal per sesi)
--
-- Urutan FK yang benar (diperbarui):
--   teacher_attendance_log (schedule_id NOT NULL RESTRICT)  ← baru
--   teacher_journals       (schedule_id nullable RESTRICT)  ← baru
--   attendance             (schedule_id NOT NULL RESTRICT)
--   substitute_schedules   (schedule_id NOT NULL RESTRICT)
--   observations           (schedule_id nullable RESTRICT)
--   teaching_schedules     (assignment_id RESTRICT ke teaching_assignments)
--   schedule_templates     (independen)
--   teaching_assignments   (independen setelah teaching_schedules gone)

CREATE OR REPLACE FUNCTION fn_wizard_reset_schedules(
    p_school_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_schedule_ids  uuid[];
    v_deleted_sched int;
    v_deleted_tpl   int;
    v_deleted_asgn  int;
BEGIN
    -- Verifikasi pemanggil adalah ADMINISTRATIVE sekolah ini
    IF fn_current_school_id() <> p_school_id THEN
        RAISE EXCEPTION 'Akses ditolak: bukan sekolah Anda.';
    END IF;
    IF fn_current_user_role() <> 'ADMINISTRATIVE' THEN
        RAISE EXCEPTION 'Akses ditolak: hanya ADMINISTRATIVE yang dapat mereset jadwal.';
    END IF;

    -- Kumpulkan schedule_ids untuk hapus data yang RESTRICT ke teaching_schedules
    SELECT ARRAY_AGG(schedule_id) INTO v_schedule_ids
    FROM teaching_schedules WHERE school_id = p_school_id;

    IF v_schedule_ids IS NOT NULL AND array_length(v_schedule_ids, 1) > 0 THEN
        -- Log aktivitas guru per sesi (NOT NULL FK — penyebab utama 409)
        DELETE FROM teacher_attendance_log
        WHERE schedule_id = ANY(v_schedule_ids);

        -- Jurnal guru yang terkait sesi jadwal (nullable FK)
        DELETE FROM teacher_journals
        WHERE schedule_id = ANY(v_schedule_ids);

        -- Absensi yang terkait sesi jadwal
        DELETE FROM attendance
        WHERE schedule_id = ANY(v_schedule_ids);

        -- Jadwal guru pengganti
        DELETE FROM substitute_schedules
        WHERE schedule_id = ANY(v_schedule_ids);

        -- Observasi yang terkait sesi jadwal
        DELETE FROM observations
        WHERE schedule_id = ANY(v_schedule_ids) AND school_id = p_school_id;
    END IF;

    -- Sesi jadwal konkret
    DELETE FROM teaching_schedules WHERE school_id = p_school_id;
    GET DIAGNOSTICS v_deleted_sched = ROW_COUNT;

    -- Template jadwal mingguan
    DELETE FROM schedule_templates WHERE school_id = p_school_id;
    GET DIAGNOSTICS v_deleted_tpl = ROW_COUNT;

    -- Penugasan mengajar
    DELETE FROM teaching_assignments WHERE school_id = p_school_id;
    GET DIAGNOSTICS v_deleted_asgn = ROW_COUNT;

    RETURN jsonb_build_object(
        'deleted_schedules',         v_deleted_sched,
        'deleted_templates',         v_deleted_tpl,
        'deleted_assignments',       v_deleted_asgn
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION fn_wizard_reset_schedules(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_wizard_reset_schedules(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION fn_wizard_reset_schedules(uuid) TO authenticated;

COMMENT ON FUNCTION fn_wizard_reset_schedules IS
    'Reset semua data jadwal dari wizard onboarding. Menghapus teacher_attendance_log/'
    'teacher_journals/attendance/substitute_schedules/observations terkait sesi jadwal '
    'sebelum menghapus teaching_schedules, lalu schedule_templates dan teaching_assignments. '
    'Hanya bisa dipanggil oleh ADMINISTRATIVE sekolah tersebut.';
