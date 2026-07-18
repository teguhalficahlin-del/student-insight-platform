-- SIP Sprint 1 — 003: Core lookup tables
-- curriculum_versions, education_levels, phases, vocational_fields
-- Idempotent: CREATE TABLE IF NOT EXISTS

-- ------------------------------------------------
-- curriculum_versions
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS core.curriculum_versions (
  version_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_code    VARCHAR(20) UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  regulation_ref  TEXT NOT NULL,
  effective_from  DATE NOT NULL,
  effective_until DATE,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------
-- education_levels
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS core.education_levels (
  level_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code      VARCHAR(10) UNIQUE NOT NULL,
  name      TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- ------------------------------------------------
-- phases
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS core.phases (
  phase_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level_id    UUID NOT NULL REFERENCES core.education_levels(level_id),
  code        VARCHAR(5) NOT NULL,
  name        TEXT NOT NULL,
  grade_range VARCHAR(20),
  UNIQUE (level_id, code)
);

-- ------------------------------------------------
-- vocational_fields
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS core.vocational_fields (
  field_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code      VARCHAR(10) UNIQUE NOT NULL,
  name      TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true
);
