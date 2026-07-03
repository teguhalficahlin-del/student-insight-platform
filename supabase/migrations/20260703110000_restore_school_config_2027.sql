-- ============================================================
-- Migration 20260703110000
--
-- Hanya perbaiki school_config ke 2027/2028.
-- classes.academic_year = '2027/2028' sudah ada (dibuat saat
-- wizard dijalankan setelah Tutup Tahun) — tidak perlu diupdate.
-- ============================================================

UPDATE school_config
SET    current_academic_year = '2027/2028',
       current_semester      = '1',
       updated_at            = NOW()
WHERE  current_academic_year = '2026/2027'
  AND  EXISTS (
           SELECT 1 FROM students s
           WHERE  s.graduated_academic_year = '2026/2027'
             AND  s.student_status = 'LULUS'
       );
