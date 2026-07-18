-- SIP Sprint 1 — 005: Core knowledge national
-- Idempotent: CREATE TABLE IF NOT EXISTS

CREATE TABLE IF NOT EXISTS core.knowledge_national (
  kn_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID REFERENCES core.vocational_programs(program_id),
  category   VARCHAR(50) NOT NULL CHECK (category IN (
               'SOFTWARE_TOOLS',
               'SERTIFIKASI',
               'ISTILAH_TEKNIS',
               'CONTOH_PROYEK',
               'DUDI_UMUM',
               'STANDAR_KOMPETENSI',
               'BUDAYA_KERJA'
             )),
  label      VARCHAR(200) NOT NULL,
  deskripsi  TEXT NOT NULL,
  tags       TEXT[],
  version_id UUID NOT NULL REFERENCES core.curriculum_versions(version_id),
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
