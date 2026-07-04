-- ============================================================
-- ITEM 3 — fn_reapply_schedule_templates
-- ============================================================
-- Masalah: fn_apply_schedule_templates pakai ON CONFLICT DO NOTHING.
-- Jika template berubah (guru A → guru B), sesi masa depan guru A
-- tidak dihapus — dua guru bisa punya sesi di slot kelas yang sama.
--
-- Solusi: fn_reapply_schedule_templates
--   1. Hapus sesi masa depan (> CURRENT_DATE) tanpa absensi
--   2. Null-kan schedule_id di observations + teacher_journals
--      (data tetap ada, hanya putus link ke sesi lama)
--   3. Hapus substitute_schedules + teacher_attendance_log
--   4. Panggil fn_apply_schedule_templates → generate ulang dari template terkini
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_reapply_schedule_templates(
    p_academic_year text,
    p_semester      semester,
    p_school_id     uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_deleted_sess  integer := 0;
    v_deleted_sub   integer := 0;
    v_result        jsonb;
BEGIN
    -- Sesi target: masa depan, milik sekolah ini, belum ada absensi
    CREATE TEMP TABLE _reapply_target ON COMMIT DROP AS
    SELECT ts.schedule_id
    FROM   teaching_schedules ts
    WHERE  ts.school_id     = p_school_id
      AND  ts.academic_year = p_academic_year
      AND  ts.semester      = p_semester
      AND  ts.session_date  > CURRENT_DATE
      AND  NOT EXISTS (
               SELECT 1 FROM attendance a
               WHERE  a.schedule_id = ts.schedule_id
           );

    -- Putus referensi nullable (jangan hapus data observasi/jurnal guru)
    UPDATE observations
    SET    schedule_id = NULL
    WHERE  schedule_id IN (SELECT schedule_id FROM _reapply_target);

    UPDATE teacher_journals
    SET    schedule_id = NULL
    WHERE  schedule_id IN (SELECT schedule_id FROM _reapply_target);

    -- Hapus child records NOT NULL sebelum hapus sesi
    DELETE FROM teacher_attendance_log
    WHERE  schedule_id IN (SELECT schedule_id FROM _reapply_target);

    DELETE FROM substitute_schedules
    WHERE  schedule_id IN (SELECT schedule_id FROM _reapply_target);
    GET DIAGNOSTICS v_deleted_sub = ROW_COUNT;

    -- Hapus sesi target
    DELETE FROM teaching_schedules
    WHERE  schedule_id IN (SELECT schedule_id FROM _reapply_target);
    GET DIAGNOSTICS v_deleted_sess = ROW_COUNT;

    DROP TABLE _reapply_target;

    -- Generate ulang dari template terkini (hanya mengisi yang kosong ke depan)
    SELECT fn_apply_schedule_templates(p_academic_year, p_semester, p_school_id)
    INTO   v_result;

    RETURN jsonb_build_object(
        'sessions_deleted',     v_deleted_sess,
        'substitutes_deleted',  v_deleted_sub,
        'templates_found',      (v_result->>'templates_found')::int,
        'assignments_upserted', (v_result->>'assignments_upserted')::int,
        'schedules_generated',  (v_result->>'schedules_generated')::int
    );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_reapply_schedule_templates(text, semester, uuid)
    TO authenticated;

COMMENT ON FUNCTION fn_reapply_schedule_templates IS
    'Hapus sesi masa depan tanpa absensi lalu generate ulang dari template terkini. '
    'Dipanggil edge function apply-schedule-templates?mode=reapply.';
