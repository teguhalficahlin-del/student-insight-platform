-- ============================================================
-- ITEM 8 / ABS-3 — Cabut hak hapus absensi dari TU (ADMINISTRATIVE)
-- ============================================================
-- Masalah (ABS-3): TU bisa menghapus baris absensi langsung lewat
-- RLS policy rls_attendance_delete_administrative — tanpa log, tanpa
-- persetujuan guru, tanpa audit trail.
--
-- Keputusan: cabut sepenuhnya. Absensi tidak boleh dihapus oleh siapa
-- pun (hanya void yang diizinkan via meeting_status = GURU_TIDAK_HADIR).
-- Policy ini awalnya dibuat agar cascade delete wizard bisa berjalan,
-- tapi cascade itu sekarang sudah dikelola di sisi backend.
-- ============================================================

DROP POLICY IF EXISTS rls_attendance_delete_administrative ON attendance;

-- Guard-rail: pastikan tidak ada policy DELETE lain untuk attendance
-- yang bocor ke authenticated/anon. Periksa dengan:
--   SELECT policyname, cmd, roles, qual FROM pg_policies
--   WHERE tablename = 'attendance' AND cmd = 'DELETE';
-- Hasilnya harus kosong.
