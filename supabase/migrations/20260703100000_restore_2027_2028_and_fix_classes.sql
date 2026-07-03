-- ============================================================
-- Migration 20260703100000
--
-- Koreksi: sekolah sudah menjalankan Tutup Tahun dengan benar
-- (2026/2027 → 2027/2028). Migration 20260703090000 salah
-- mengembalikan school_config ke 2026/2027.
--
-- Fix:
--   1. Kembalikan school_config ke 2027/2028 Semester 1
--   2. Update classes.academic_year ke 2027/2028
--      (fn_buka_tahun_ajaran lama tidak melakukan ini — sudah
--       diperbaiki di migration 20260703080000 untuk tutup tahun
--       berikutnya, tapi data saat ini perlu dikoreksi manual)
-- ============================================================

-- 1. Kembalikan school_config ke 2027/2028
UPDATE school_config
SET    current_academic_year = '2027/2028',
       current_semester      = '1',
       updated_at            = NOW()
WHERE  current_academic_year = '2026/2027'
  AND  EXISTS (
           -- Pastikan sekolah ini memang sudah punya alumni 2026/2027
           -- (bukti Tutup Tahun sudah dijalankan)
           SELECT 1 FROM students s
           WHERE  s.graduated_academic_year = '2026/2027'
             AND  s.student_status          = 'LULUS'
       );

-- 2. Update classes.academic_year ke 2027/2028
-- Hanya untuk sekolah yang school_config-nya baru saja diupdate
UPDATE classes c
SET    academic_year = '2027/2028',
       updated_at    = NOW()
FROM   school_config sc
WHERE  c.school_id    = sc.school_id
  AND  c.academic_year = '2026/2027'
  AND  sc.current_academic_year = '2027/2028';
