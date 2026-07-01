-- ============================================================
-- FIX (temuan saat verifikasi M2) — attendance.recorded_by_user_id
-- ============================================================
-- recorded_by_user_id NOT NULL tanpa default, dan portal guru
-- (guru/js/api.js upsertAttendance) TIDAK menyetelnya, serta tak ada
-- trigger pengisi. Live attendance=0 baris → belum pernah kena, tapi
-- guru pertama yang menyimpan absensi akan gagal NOT NULL (bikin
-- "guru tak bisa absen" kambuh diam-diam).
--
-- Perbaikan: trigger BEFORE INSERT mengisi recorded_by_user_id dari
-- fn_current_user_id() (JWT user) bila NULL. Jalur service-role
-- (sync-attendance-batch) tetap harus menyetel eksplisit.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_auto_set_recorded_by()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.recorded_by_user_id IS NULL THEN
        NEW.recorded_by_user_id := fn_current_user_id();
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_recorded_by ON attendance;
CREATE TRIGGER trg_auto_recorded_by
    BEFORE INSERT ON attendance
    FOR EACH ROW EXECUTE FUNCTION fn_auto_set_recorded_by();
