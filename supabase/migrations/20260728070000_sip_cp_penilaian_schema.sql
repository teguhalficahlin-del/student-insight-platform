-- Migration: 20260728070000_sip_cp_penilaian_schema.sql
-- Tujuan: Tambah FK element_id ke learning_objectives dan
--         buat tabel core.subject_name_mapping untuk mapping mapel lokal ke core

-- ============================================================
-- BAGIAN 1: ALTER TABLE learning_objectives
-- ============================================================

ALTER TABLE public.learning_objectives
  ADD COLUMN IF NOT EXISTS element_id UUID NULL
    REFERENCES core.cp_elements(element_id) ON DELETE SET NULL;

COMMENT ON COLUMN public.learning_objectives.element_id IS
  'Elemen CP yang dicakup oleh TP ini. Nullable — TP lama dan TP tanpa tag CP tetap valid.';

-- ============================================================
-- BAGIAN 2: CREATE TABLE core.subject_name_mapping
-- ============================================================

CREATE TABLE IF NOT EXISTS core.subject_name_mapping (
  mapping_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kode_pattern    VARCHAR(50)  NOT NULL,
  program_hint    VARCHAR(20)  NULL,
  grade_level     SMALLINT     NULL,
  core_subject_id UUID         NOT NULL REFERENCES core.subjects(subject_id),
  confidence      VARCHAR(10)  NOT NULL DEFAULT 'HIGH'
                  CHECK (confidence IN ('HIGH', 'MEDIUM', 'LOW')),
  notes           TEXT         NULL,
  is_active       BOOLEAN      NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT uq_subject_name_mapping
    UNIQUE NULLS NOT DISTINCT (kode_pattern, program_hint, grade_level)
);

COMMENT ON TABLE core.subject_name_mapping IS
  'Mapping dari kode mapel lokal (sekolah/kurikulum internal) ke core.subjects. '
  'Digunakan saat guru membuka Setup TP untuk mencocokkan mapel ke CP nasional.';

COMMENT ON COLUMN core.subject_name_mapping.kode_pattern IS
  'Kode mapel lokal exact-match, mis. ''DDPK X TJKT'', ''KIK'', ''IJN''.';
COMMENT ON COLUMN core.subject_name_mapping.program_hint IS
  'Kode program lokal untuk disambiguasi, mis. ''TJKT'', ''AKL''. NULL = lintas program.';
COMMENT ON COLUMN core.subject_name_mapping.grade_level IS
  '10 = Fase E, 11 = Fase F, NULL = semua grade.';
COMMENT ON COLUMN core.subject_name_mapping.confidence IS
  'HIGH = exact match SK BSKAP; MEDIUM = inferensi konteks; LOW = ambigu perlu konfirmasi admin.';

-- ============================================================
-- BAGIAN 3: Index
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_subject_name_mapping_kode
  ON core.subject_name_mapping (kode_pattern);

CREATE INDEX IF NOT EXISTS idx_subject_name_mapping_program_grade
  ON core.subject_name_mapping (program_hint, grade_level);

CREATE INDEX IF NOT EXISTS idx_subject_name_mapping_core_subject
  ON core.subject_name_mapping (core_subject_id);

-- ============================================================
-- BAGIAN 4: GRANT (mengikuti pola tabel core lain)
-- ============================================================

GRANT SELECT ON core.subject_name_mapping TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON core.subject_name_mapping TO service_role;

-- ============================================================
-- BAGIAN 5: RLS (wajib — semua tabel core punya rowsecurity=true)
-- ============================================================

ALTER TABLE core.subject_name_mapping ENABLE ROW LEVEL SECURITY;

-- authenticated boleh SELECT semua baris aktif
-- (data ini bersifat nasional/shared, tidak perlu filter per school_id)
CREATE POLICY "authenticated can select subject_name_mapping"
  ON core.subject_name_mapping
  FOR SELECT
  TO authenticated
  USING (is_active = true);
