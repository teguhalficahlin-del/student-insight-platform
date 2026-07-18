-- SIP Sprint 1 — 004: Core curriculum tables
-- vocational_programs, concentrations, subjects, subject_phases,
-- capaian_pembelajaran, cp_elements
-- Idempotent: CREATE TABLE IF NOT EXISTS

-- ------------------------------------------------
-- vocational_programs
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS core.vocational_programs (
  program_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  field_id    UUID NOT NULL REFERENCES core.vocational_fields(field_id),
  code        VARCHAR(20) UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  name_short  VARCHAR(50),
  is_active   BOOLEAN NOT NULL DEFAULT true
);

-- ------------------------------------------------
-- vocational_concentrations
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS core.vocational_concentrations (
  concentration_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id       UUID NOT NULL REFERENCES core.vocational_programs(program_id),
  code             VARCHAR(20) UNIQUE NOT NULL,
  name             TEXT NOT NULL,
  is_active        BOOLEAN NOT NULL DEFAULT true
);

-- ------------------------------------------------
-- subjects
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS core.subjects (
  subject_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code             VARCHAR(30) UNIQUE NOT NULL,
  name             TEXT NOT NULL,
  subject_type     VARCHAR(30) NOT NULL CHECK (subject_type IN (
                     'UMUM',
                     'KEJURUAN_LINTAS_PRODI',
                     'KEJURUAN_DASAR',
                     'KEJURUAN_KONSENTRASI',
                     'KEJURUAN_PILIHAN',
                     'PKL',
                     'MUATAN_LOKAL'
                   )),
  program_id       UUID REFERENCES core.vocational_programs(program_id),
  concentration_id UUID REFERENCES core.vocational_concentrations(concentration_id),
  is_generatable   BOOLEAN NOT NULL DEFAULT true,
  is_active        BOOLEAN NOT NULL DEFAULT true
);

-- ------------------------------------------------
-- subject_phases
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS core.subject_phases (
  subject_phase_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id       UUID NOT NULL REFERENCES core.subjects(subject_id),
  phase_id         UUID NOT NULL REFERENCES core.phases(phase_id),
  version_id       UUID NOT NULL REFERENCES core.curriculum_versions(version_id),
  jp_per_week      INT,
  UNIQUE (subject_id, phase_id, version_id)
);

-- ------------------------------------------------
-- capaian_pembelajaran  (core; berbeda dari public.capaian_pembelajaran yang per-tenant)
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS core.capaian_pembelajaran (
  cp_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_phase_id UUID NOT NULL REFERENCES core.subject_phases(subject_phase_id),
  version_id       UUID NOT NULL REFERENCES core.curriculum_versions(version_id),
  cp_code          VARCHAR(50),
  rasional         TEXT,
  tujuan           TEXT,
  karakteristik    TEXT,
  cp_umum          TEXT NOT NULL,
  display_order    INT NOT NULL DEFAULT 1,
  bskap_ref        VARCHAR(100),
  effective_date   DATE,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (subject_phase_id, version_id)
);

-- ------------------------------------------------
-- cp_elements
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS core.cp_elements (
  element_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cp_id         UUID NOT NULL REFERENCES core.capaian_pembelajaran(cp_id) ON DELETE CASCADE,
  element_order INT NOT NULL,
  nama_elemen   VARCHAR(200) NOT NULL,
  deskripsi_cp  TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (cp_id, element_order)
);
