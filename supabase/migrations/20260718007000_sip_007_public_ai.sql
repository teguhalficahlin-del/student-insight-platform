-- SIP Sprint 1 — 007: Public AI operational tables
-- prompt_templates, generation_jobs, evaluation_logs
-- Idempotent: CREATE TABLE IF NOT EXISTS

-- ------------------------------------------------
-- prompt_templates
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.prompt_templates (
  template_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type           VARCHAR(30) NOT NULL,
  provider                VARCHAR(20) NOT NULL,
  template_version        VARCHAR(20) NOT NULL,
  formatter_version       VARCHAR(20) NOT NULL,
  system_instruction_v    VARCHAR(20) NOT NULL,
  system_instruction      TEXT NOT NULL,
  core_prompt             TEXT NOT NULL,
  formatter_config        JSONB NOT NULL DEFAULT '{}',
  is_active               BOOLEAN NOT NULL DEFAULT true,
  deprecated_at           TIMESTAMPTZ,
  notes                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_type, provider, template_version)
);

-- ------------------------------------------------
-- generation_jobs
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.generation_jobs (
  job_id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id                UUID NOT NULL REFERENCES public.schools(school_id),
  teacher_user_id          UUID NOT NULL REFERENCES auth.users(id),
  doc_id                   UUID REFERENCES public.teacher_documents(doc_id),
  idempotency_key          VARCHAR(100) UNIQUE NOT NULL,
  generation_params_hash   VARCHAR(64),
  status                   VARCHAR(20) NOT NULL DEFAULT 'QUEUED'
                           CHECK (status IN (
                             'QUEUED', 'GENERATING', 'VALIDATING',
                             'RETRYING', 'FAILED', 'COMPLETED'
                           )),
  retry_count              INT NOT NULL DEFAULT 0,
  max_retry                INT NOT NULL DEFAULT 2,
  last_error               TEXT,
  context_snapshot         JSONB,
  prompt_template_id       UUID REFERENCES public.prompt_templates(template_id),
  provider                 VARCHAR(20),
  model                    VARCHAR(50),
  queued_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at               TIMESTAMPTZ,
  completed_at             TIMESTAMPTZ,
  failed_at                TIMESTAMPTZ,
  input_tokens             INT,
  output_tokens            INT,
  cost_idr                 NUMERIC(10,2)
);

-- ------------------------------------------------
-- evaluation_logs
-- ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.evaluation_logs (
  log_id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                UUID NOT NULL REFERENCES public.generation_jobs(job_id),
  school_id             UUID NOT NULL REFERENCES public.schools(school_id),
  teacher_user_id       UUID NOT NULL REFERENCES auth.users(id),
  doc_id                UUID REFERENCES public.teacher_documents(doc_id),
  document_type         VARCHAR(30),
  core_subject_id       UUID,
  phase_id              UUID,
  program_id            UUID,
  curriculum_version    VARCHAR(20),
  knowledge_version     VARCHAR(20),
  template_version      VARCHAR(20),
  formatter_version     VARCHAR(20),
  system_instruction_v  VARCHAR(20),
  model_version         VARCHAR(50),
  provider              VARCHAR(20),
  input_tokens          INT,
  output_tokens         INT,
  latency_ms            INT,
  cost_idr              NUMERIC(10,2),
  validator_passed      BOOLEAN,
  validator_flags       TEXT[],
  self_review_score     NUMERIC(4,2),
  retry_count           INT,
  finish_reason         VARCHAR(20),
  teacher_satisfaction  SMALLINT CHECK (teacher_satisfaction BETWEEN 1 AND 5),
  teacher_feedback      TEXT,
  generated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
