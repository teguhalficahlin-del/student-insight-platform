-- Migration: 20260728110000_cleanup_subject_assignments_lama.sql
-- Tujuan: Nonaktifkan teaching_assignments untuk kode mapel lama
--   di SMKN 1 Ujungbatu (244e389c-de7d-4d70-ac95-346d33a5d02c)
--
-- Kode lama → Canonical pengganti:
--   B.IND, B.INDO   → BINDO
--   B.ING, B.INGG   → BING
--   PKK              → KIK
--   PKN              → PPKN
--   AGAMA            → PAI + PAK
--
-- Dry-run COUNT sebelum eksekusi (2026-07-29):
--   AGAMA  = 44, B.IND = 2, B.INDO = 22, B.ING = 2,
--   B.INGG = 21, PKK   = 1, PKN    = 10  → total 102 rows

UPDATE public.teaching_assignments ta
SET    is_active = false
FROM   public.subjects ps
WHERE  ta.subject_id  = ps.subject_id
  AND  ps.school_id   = '244e389c-de7d-4d70-ac95-346d33a5d02c'
  AND  ta.is_active   = true
  AND  UPPER(ps.code) IN (
         'B.IND', 'B.INDO', 'B.ING', 'B.INGG',
         'PKK', 'PKN', 'AGAMA'
       );
