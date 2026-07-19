-- SIP Sprint 1 — 014: Set cp_umum NULL untuk mapel tanpa paragraf umum di BSKAP 046
-- Mapel-mapel ini memiliki CP per elemen (setiap elemen punya kalimat
-- "Pada akhir Fase E/F, peserta didik..." sendiri).
-- Tidak ada paragraf cp_umum tersendiri di SK BSKAP No. 046/H/KR/2025.
-- NULL = data memang tidak ada, bukan data belum diisi.
-- Idempotent: hanya mengupdate baris yang masih PENDING.

-- Drop NOT NULL constraint agar kolom bisa menyimpan NULL secara sah
ALTER TABLE core.capaian_pembelajaran
  ALTER COLUMN cp_umum DROP NOT NULL;

UPDATE core.capaian_pembelajaran
SET
  cp_umum    = NULL,
  updated_at = now()
WHERE subject_phase_id IN (
  SELECT sp.subject_phase_id
  FROM core.subject_phases sp
  JOIN core.subjects s ON sp.subject_id = s.subject_id
  WHERE s.code IN (
    'MAT', 'PPKn', 'PJOK', 'INF',
    'PAI', 'PAK', 'PAKat', 'PABud', 'PAHin', 'PAKon',
    'SB_MUS', 'SB_RUP', 'SB_TEA', 'SB_TAR'
  )
)
AND (cp_umum = '[PENDING]' OR cp_umum LIKE '%PENDING%');
