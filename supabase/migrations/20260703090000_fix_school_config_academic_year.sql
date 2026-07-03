-- ============================================================
-- Migration 20260703090000: Fix school_config.current_academic_year
--
-- Kondisi bug: school_config.current_academic_year = '2027/2028'
-- tapi classes.academic_year = '2026/2027' untuk sekolah yang sama.
-- Terjadi karena admin mengubah tahun ajaran lewat wizard Step 2
-- (bukan lewat alur Tutup Semester → Tutup Tahun yang benar).
--
-- Fix: kembalikan current_academic_year ke '2026/2027' untuk setiap
-- sekolah yang mengalami ketidakcocokan ini.
-- ============================================================

UPDATE school_config sc
SET    current_academic_year = '2026/2027',
       current_semester      = '1',
       updated_at            = NOW()
WHERE  sc.current_academic_year = '2027/2028'
  AND  EXISTS (
           SELECT 1 FROM classes c
           WHERE  c.school_id    = sc.school_id
             AND  c.academic_year = '2026/2027'
       )
  AND  NOT EXISTS (
           SELECT 1 FROM classes c
           WHERE  c.school_id    = sc.school_id
             AND  c.academic_year = '2027/2028'
       );
