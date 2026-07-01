-- ============================================================
-- FIX M2 — Sinkronkan "siapa lihat jadwal" dengan "siapa boleh absen"
-- ============================================================
-- Portal guru menampilkan sesi via teaching_schedules.scheduled_teacher_id,
-- tetapi RLS tulis absensi (rls_attendance_rw_guru) hanya mengizinkan
-- pemilik teaching_assignment AKTIF untuk sesi itu. Bila keduanya tak
-- sinkron (guru pengganti, edit manual, assignment dinonaktifkan), guru
-- MELIHAT sesi tapi simpan absensi DITOLAK diam-diam.
--
-- Perbaikan: izinkan menulis absensi bila user adalah GURU TERJADWAL
-- sesi itu (scheduled_teacher_id) ATAU pemilik assignment aktif.
-- Data live saat ini 100% konsisten (0 akan ditolak) → ini preventif.
-- Jalur guru pengganti (rls_attendance_rw_substitute) tak diubah.
-- ============================================================

DROP POLICY IF EXISTS rls_attendance_rw_guru ON attendance;

CREATE POLICY rls_attendance_rw_guru ON attendance FOR ALL
USING (
    school_id = fn_current_school_id()
    AND EXISTS (
        SELECT 1 FROM teaching_schedules ts
        WHERE ts.schedule_id = attendance.schedule_id
          AND ( ts.scheduled_teacher_id = fn_current_user_id()
                OR EXISTS (
                    SELECT 1 FROM teaching_assignments ta
                    WHERE ta.assignment_id = ts.assignment_id
                      AND ta.user_id = fn_current_user_id()
                      AND ta.is_active = true
                ) )
    )
)
WITH CHECK (
    school_id = fn_current_school_id()
    AND EXISTS (
        SELECT 1 FROM teaching_schedules ts
        WHERE ts.schedule_id = attendance.schedule_id
          AND ( ts.scheduled_teacher_id = fn_current_user_id()
                OR EXISTS (
                    SELECT 1 FROM teaching_assignments ta
                    WHERE ta.assignment_id = ts.assignment_id
                      AND ta.user_id = fn_current_user_id()
                      AND ta.is_active = true
                ) )
    )
);
