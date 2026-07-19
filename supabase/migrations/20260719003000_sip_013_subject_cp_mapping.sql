-- Migration: subject_cp_mapping
-- Tabel mapping antara public.subjects (per sekolah) dan core.subjects (nasional)
-- Digunakan untuk menentukan CP mana yang relevan untuk setiap mapel sekolah

CREATE TABLE public.subject_cp_mapping (
  mapping_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       UUID NOT NULL REFERENCES public.schools(school_id),
  subject_id      UUID NOT NULL REFERENCES public.subjects(subject_id),
  program_id      UUID REFERENCES core.vocational_programs(program_id),
  -- NULL = berlaku lintas program (mapel umum)
  -- diisi = spesifik per program (DDPK produktif)

  core_subject_id UUID NOT NULL REFERENCES core.subjects(subject_id),
  -- mapel di core yang relevan

  mapping_type    VARCHAR(10) NOT NULL DEFAULT 'MANUAL'
                  CHECK (mapping_type IN ('AUTO', 'MANUAL')),

  is_active       BOOLEAN DEFAULT true,
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT now(),

  UNIQUE NULLS NOT DISTINCT (school_id, subject_id, program_id, core_subject_id)
);

-- RLS
ALTER TABLE public.subject_cp_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY scm_select ON public.subject_cp_mapping
  FOR SELECT TO authenticated
  USING (school_id = public.fn_current_school_id());

CREATE POLICY scm_insert ON public.subject_cp_mapping
  FOR INSERT TO authenticated
  WITH CHECK (school_id = public.fn_current_school_id());

CREATE POLICY scm_update ON public.subject_cp_mapping
  FOR UPDATE TO authenticated
  USING (school_id = public.fn_current_school_id());
