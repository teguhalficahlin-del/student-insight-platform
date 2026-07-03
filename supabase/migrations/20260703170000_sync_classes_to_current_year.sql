-- ============================================================
-- Migration 20260703170000: Sinkronkan classes.academic_year
--
-- Kondisi: Kelas X sudah academic_year='2027/2028' (dibuat wizard
-- setelah Tutup Tahun), tapi Kelas XI & XII masih '2026/2027'.
-- bulk-import-schedules mencari kelas by name+academic_year sesuai
-- school_config.current_academic_year ('2027/2028') → 600 baris gagal.
--
-- Langkah:
-- 1. Hapus baris classes yang academic_year='2026/2027' dan sudah
--    ada duplikat dengan academic_year='2027/2028' (kelas X lama).
-- 2. Update sisa '2026/2027' → '2027/2028' (kelas XI & XII).
-- ============================================================

-- Hanya update kelas yang BELUM punya duplikat di 2027/2028.
-- Kelas X yang sudah ada versi 2027/2028 dibiarkan (ada class_enrollments
-- yang referensikan kelas lama — data historis siswa).
UPDATE classes c_old
SET    academic_year = '2027/2028',
       updated_at    = NOW()
WHERE  c_old.academic_year = '2026/2027'
  AND  NOT EXISTS (
           SELECT 1 FROM classes c_new
           WHERE  c_new.school_id     = c_old.school_id
             AND  c_new.name          = c_old.name
             AND  c_new.academic_year = '2027/2028'
       );
