-- ============================================================
-- Migration 20260703100000 (diperbaiki)
--
-- Koreksi: sekolah sudah menjalankan Tutup Tahun (2026/2027 →
-- 2027/2028). Migration 20260703090000 salah mengembalikan
-- school_config ke 2026/2027.
--
-- classes dengan academic_year = '2027/2028' sudah ada
-- (dibuat saat wizard Kelas & Rombel berjalan setelah Tutup
-- Tahun). Tidak perlu update classes — cukup fix school_config.
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
