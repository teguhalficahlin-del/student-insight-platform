-- SIP Sprint 1 — 006: Public base tables (Teacher Workspace)
-- teacher_profiles, teaching_contexts, teacher_documents,
-- teacher_document_classes, teacher_document_approvals
-- Idempotent: CREATE TABLE IF NOT EXISTS

-- ------------------------------------------------
-- teacher_profiles
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.teacher_profiles (
  profile_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id               UUID NOT NULL REFERENCES public.schools(school_id),
  teacher_user_id         UUID NOT NULL REFERENCES auth.users(id),
  instructional_intent    VARCHAR(50),
  intent_detail           TEXT,
  assessment_philosophy   VARCHAR(50),
  teaching_style          VARCHAR(30),
  learning_model          VARCHAR(50),
  delivery_style          VARCHAR(50),
  schedule_pattern        VARCHAR(50),
  project_duration        VARCHAR(30),
  depth_level             VARCHAR(20),
  local_city              TEXT,
  local_industry          TEXT,
  local_dudi_partners     TEXT,
  local_products          TEXT,
  avoided_activities      TEXT[],
  avoided_detail          TEXT,
  integration_prefs       TEXT[],
  last_refreshed_at       TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, teacher_user_id)
);

-- ------------------------------------------------
-- teaching_contexts
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.teaching_contexts (
  context_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id               UUID NOT NULL REFERENCES public.schools(school_id),
  teacher_user_id         UUID NOT NULL REFERENCES auth.users(id),
  academic_year           VARCHAR(10) NOT NULL,
  subject_id              UUID REFERENCES public.subjects(subject_id),
  class_id                UUID REFERENCES public.classes(class_id),
  student_background      VARCHAR(50),
  tech_access             VARCHAR(50),
  daily_language          TEXT,
  class_characteristics   TEXT[],
  student_autonomy        VARCHAR(30),
  learning_constraints    TEXT[],
  constraints_detail      TEXT,
  resources_available     TEXT[],
  dudi_name               TEXT,
  narasumber_detail       TEXT,
  expected_output         VARCHAR(50),
  output_detail           TEXT,
  school_habits           TEXT[],
  habits_detail           TEXT,
  media_available         TEXT[],
  media_detail            TEXT,
  last_refreshed_at       TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, teacher_user_id, academic_year, subject_id, class_id)
);

-- ------------------------------------------------
-- teacher_documents
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.teacher_documents (
  doc_id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id                   UUID NOT NULL REFERENCES public.schools(school_id),
  teacher_user_id             UUID NOT NULL REFERENCES auth.users(id),
  academic_year               VARCHAR(10) NOT NULL,
  document_type               VARCHAR(30) NOT NULL CHECK (document_type IN (
                                'PROGRAM_TAHUNAN', 'PROGRAM_SEMESTER',
                                'ATP', 'PPM', 'LKPD', 'SOAL', 'RUBRIK'
                              )),
  core_subject_id             UUID NOT NULL REFERENCES core.subjects(subject_id),
  phase_id                    UUID NOT NULL REFERENCES core.phases(phase_id),
  program_id                  UUID REFERENCES core.vocational_programs(program_id),
  scope_type                  VARCHAR(20) NOT NULL CHECK (scope_type IN (
                                'SEMUA_KELAS', 'KELAS_TERTENTU'
                              )),
  parent_doc_id               UUID REFERENCES public.teacher_documents(doc_id),
  semester                    SMALLINT CHECK (semester IN (1, 2)),
  tp_urutan                   INT,
  status                      VARCHAR(30) NOT NULL DEFAULT 'AI_DRAFT'
                              CHECK (status IN (
                                'AI_DRAFT', 'DIREVIEW_GURU',
                                'MENUNGGU_KEPSEK', 'DISAHKAN_KEPSEK'
                              )),
  content_json                JSONB NOT NULL DEFAULT '{}',
  docx_url                    TEXT,
  pdf_url                     TEXT,
  curriculum_version          VARCHAR(20),
  knowledge_version           VARCHAR(20),
  generation_policy_version   VARCHAR(20),
  model_version               VARCHAR(50),
  generated_at                TIMESTAMPTZ,
  context_snapshot            JSONB,
  source_doc_id               UUID REFERENCES public.teacher_documents(doc_id),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------
-- teacher_document_classes
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.teacher_document_classes (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id    UUID NOT NULL REFERENCES public.teacher_documents(doc_id) ON DELETE CASCADE,
  class_id  UUID NOT NULL REFERENCES public.classes(class_id),
  school_id UUID NOT NULL REFERENCES public.schools(school_id),
  UNIQUE (doc_id, class_id)
);

-- ------------------------------------------------
-- teacher_document_approvals
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.teacher_document_approvals (
  approval_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id      UUID NOT NULL REFERENCES public.teacher_documents(doc_id),
  school_id   UUID NOT NULL REFERENCES public.schools(school_id),
  approved_by UUID NOT NULL REFERENCES auth.users(id),
  status      VARCHAR(20) NOT NULL CHECK (status IN ('APPROVED', 'REJECTED')),
  catatan     TEXT,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
