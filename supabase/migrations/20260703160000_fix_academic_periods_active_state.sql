-- ============================================================
-- Migration 20260703120000: Perbaiki status academic_periods
--
-- Kondisi: tidak ada period berstatus ACTIVE (0 aktif).
-- Seharusnya: period yang cocok dengan school_config
-- (current_academic_year + current_semester) harus ACTIVE,
-- semua yang lain CLOSED.
--
-- Langkah:
-- 1. Tutup semua period yang tidak cocok dengan config.
-- 2. UPSERT period yang cocok → pastikan status = ACTIVE.
-- ============================================================

-- Langkah 1: tutup semua period yang tidak sesuai config
UPDATE academic_periods ap
SET    status     = 'CLOSED',
       updated_at = NOW()
FROM   school_config sc
WHERE  ap.school_id    = sc.school_id
  AND  NOT (
           ap.academic_year = sc.current_academic_year
       AND ap.semester::text = sc.current_semester::text
       );

-- Langkah 2: pastikan period sesuai config berstatus ACTIVE
-- Jika sudah ada (cuma CLOSED) → update ACTIVE.
-- Jika belum ada sama sekali → insert dengan tanggal default Ganjil/Genap
-- (admin bisa koreksi tanggal lewat wizard nantinya).
INSERT INTO academic_periods (
    school_id, academic_year, semester, status,
    start_date, end_date,
    created_at, updated_at
)
SELECT
    sc.school_id,
    sc.current_academic_year,
    sc.current_semester::text::semester,
    'ACTIVE',
    -- Tanggal default: Sem 1 (Ganjil) = Juli-Des, Sem 2 (Genap) = Jan-Jun
    CASE WHEN sc.current_semester::text = '1'
         THEN (split_part(sc.current_academic_year, '/', 1)::int || '-07-14')::date
         ELSE (split_part(sc.current_academic_year, '/', 2)::int || '-01-06')::date
    END,
    CASE WHEN sc.current_semester::text = '1'
         THEN (split_part(sc.current_academic_year, '/', 1)::int || '-12-31')::date
         ELSE (split_part(sc.current_academic_year, '/', 2)::int || '-06-30')::date
    END,
    NOW(),
    NOW()
FROM school_config sc
ON CONFLICT (school_id, academic_year, semester)
DO UPDATE SET
    status     = 'ACTIVE',
    updated_at = NOW();
