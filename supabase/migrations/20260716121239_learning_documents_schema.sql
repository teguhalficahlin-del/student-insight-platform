-- ================================================
-- ENUMS
-- ================================================
CREATE TYPE ld_document_type AS ENUM (
  'atp', 'modul_ajar', 'rpp_ringkas', 'lkpd',
  'soal', 'rubrik', 'observasi', 'remedial'
);

CREATE TYPE ld_node_type AS ENUM (
  'tp_item',
  'identitas', 'kompetensi_awal', 'profil_lulusan_dimensi',
  'mindful', 'meaningful', 'joyful',
  'asesmen_diagnostik', 'asesmen_formatif', 'asesmen_sumatif',
  'refleksi', 'lampiran',
  'petunjuk', 'aktivitas', 'pertanyaan',
  'soal_pg', 'soal_uraian', 'soal_hots',
  'kriteria_pengetahuan', 'kriteria_keterampilan', 'kriteria_sikap',
  'indikator_checklist',
  'aktivitas_remedial', 'aktivitas_pengayaan'
);

CREATE TYPE ld_document_status AS ENUM ('draft', 'published');

CREATE TYPE ld_generation_source AS ENUM ('AI', 'MANUAL', 'HYBRID');

-- ================================================
-- NATIONAL KNOWLEDGE
-- Read-only untuk semua tenant
-- Hanya superadmin SIP yang bisa write (via service role)
-- ================================================
CREATE TABLE ld_program_knowledge_national (
  knowledge_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_code varchar NOT NULL,
  program_name varchar NOT NULL,
  bidang_keahlian varchar,
  program_keahlian varchar,
  kompetensi_keahlian varchar,
  deskripsi text,
  kompetensi_inti jsonb DEFAULT '[]',
  capaian_lulusan text,
  istilah_teknis jsonb DEFAULT '[]',
  peralatan_umum jsonb DEFAULT '[]',
  software_umum jsonb DEFAULT '[]',
  standar_industri jsonb DEFAULT '[]',
  k3 jsonb DEFAULT '[]',
  contoh_proyek jsonb DEFAULT '[]',
  contoh_produk jsonb DEFAULT '[]',
  contoh_dudi jsonb DEFAULT '[]',
  sertifikasi jsonb DEFAULT '[]',
  tren_teknologi jsonb DEFAULT '[]',
  referensi_pembelajaran jsonb DEFAULT '[]',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (program_code)
);

ALTER TABLE ld_program_knowledge_national ENABLE ROW LEVEL SECURITY;
CREATE POLICY "national_knowledge_read_all" ON ld_program_knowledge_national
  FOR SELECT TO authenticated USING (true);

-- ================================================
-- SCHOOL KNOWLEDGE
-- Per tenant, opsional
-- ================================================
CREATE TABLE ld_program_knowledge_school (
  knowledge_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(school_id),
  program_id uuid NOT NULL REFERENCES programs(program_id),
  software_sekolah jsonb DEFAULT '[]',
  peralatan_sekolah jsonb DEFAULT '[]',
  teaching_factory jsonb DEFAULT '[]',
  mitra_pkl jsonb DEFAULT '[]',
  produk_unggulan jsonb DEFAULT '[]',
  budaya_kerja jsonb DEFAULT '[]',
  proyek_sekolah jsonb DEFAULT '[]',
  catatan_tambahan text,
  created_by uuid REFERENCES users(user_id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (school_id, program_id)
);

ALTER TABLE ld_program_knowledge_school ENABLE ROW LEVEL SECURITY;
CREATE POLICY "school_knowledge_tenant" ON ld_program_knowledge_school
  FOR ALL USING (
    school_id = (SELECT school_id FROM users WHERE user_id = auth.uid())
  );

-- ================================================
-- TEACHER KNOWLEDGE
-- Per guru, opsional
-- ================================================
CREATE TABLE ld_teacher_knowledge (
  knowledge_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES users(user_id),
  program_id uuid REFERENCES programs(program_id),
  subject_id uuid REFERENCES subjects(subject_id),
  pendekatan_favorit jsonb DEFAULT '[]',
  software_diajarkan jsonb DEFAULT '[]',
  contoh_kasus jsonb DEFAULT '[]',
  urutan_materi_custom text,
  proyek_andalan jsonb DEFAULT '[]',
  catatan_gaya_mengajar text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (teacher_id, program_id, subject_id)
);

ALTER TABLE ld_teacher_knowledge ENABLE ROW LEVEL SECURITY;
CREATE POLICY "teacher_knowledge_owner" ON ld_teacher_knowledge
  FOR ALL USING (teacher_id = auth.uid());

-- ================================================
-- CLASS CONTEXT SNAPSHOTS
-- ================================================
CREATE TABLE ld_context_snapshots (
  snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(school_id),
  class_id uuid NOT NULL REFERENCES classes(class_id),
  teaching_assignment_id uuid REFERENCES teaching_assignments(assignment_id),
  semester varchar NOT NULL,
  academic_year varchar NOT NULL,
  student_count integer,
  attendance_rate numeric(5,2),
  avg_assessment_score numeric(5,2),
  dominant_strengths jsonb DEFAULT '[]',
  dominant_challenges jsonb DEFAULT '[]',
  preferred_learning_modes jsonb DEFAULT '[]',
  industry_readiness_notes text,
  generated_at timestamptz DEFAULT now(),
  created_by uuid NOT NULL REFERENCES users(user_id),
  UNIQUE (school_id, class_id, teaching_assignment_id, semester, academic_year)
);

ALTER TABLE ld_context_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "snapshot_school_read" ON ld_context_snapshots
  FOR SELECT USING (
    school_id = (SELECT school_id FROM users WHERE user_id = auth.uid())
  );
CREATE POLICY "snapshot_owner_write" ON ld_context_snapshots
  FOR ALL USING (created_by = auth.uid());

-- ================================================
-- PROMPT TEMPLATES
-- ================================================
CREATE TABLE ld_prompt_templates (
  template_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_type ld_node_type NOT NULL,
  version integer NOT NULL DEFAULT 1,
  label varchar,
  system_prompt text NOT NULL,
  user_prompt_template text NOT NULL,
  context_layers jsonb DEFAULT '["national","school","teacher","class"]',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE (node_type, version)
);

-- ================================================
-- LEARNING DOCUMENTS
-- ================================================
CREATE TABLE ld_documents (
  document_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(school_id),
  created_by uuid NOT NULL REFERENCES users(user_id),
  teaching_assignment_id uuid REFERENCES teaching_assignments(assignment_id),
  subject_id uuid REFERENCES subjects(subject_id),
  program_id uuid REFERENCES programs(program_id),
  class_id uuid REFERENCES classes(class_id),
  fase varchar,
  semester varchar,
  academic_year varchar,
  document_type ld_document_type NOT NULL,
  title varchar NOT NULL,
  status ld_document_status NOT NULL DEFAULT 'draft',
  latest_published_version integer,
  context_snapshot_id uuid REFERENCES ld_context_snapshots(snapshot_id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE ld_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "document_owner" ON ld_documents
  FOR ALL USING (created_by = auth.uid());
CREATE POLICY "document_school_read" ON ld_documents
  FOR SELECT USING (
    school_id = (SELECT school_id FROM users WHERE user_id = auth.uid())
  );

-- ================================================
-- DOCUMENT NODES
-- ================================================
CREATE TABLE ld_document_nodes (
  node_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES ld_documents(document_id)
    ON DELETE CASCADE,
  parent_node_id uuid REFERENCES ld_document_nodes(node_id),
  node_type ld_node_type NOT NULL,
  title varchar,
  content_json jsonb NOT NULL DEFAULT '{}',
  content_text text,
  sort_order integer NOT NULL DEFAULT 0,
  generation_source ld_generation_source NOT NULL DEFAULT 'AI',
  prompt_template_id uuid REFERENCES ld_prompt_templates(template_id),
  prompt_version integer,
  last_edited_by uuid REFERENCES users(user_id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE ld_document_nodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "node_via_document" ON ld_document_nodes
  FOR ALL USING (
    document_id IN (
      SELECT document_id FROM ld_documents
      WHERE created_by = auth.uid()
    )
  );

CREATE INDEX idx_ld_nodes_content_fts
  ON ld_document_nodes
  USING GIN (to_tsvector('indonesian', coalesce(content_text, '')));

-- ================================================
-- DOCUMENT VERSIONS (immutable)
-- ================================================
CREATE TABLE ld_document_versions (
  version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES ld_documents(document_id)
    ON DELETE CASCADE,
  version_number integer NOT NULL,
  snapshot_json jsonb NOT NULL,
  published_by uuid NOT NULL REFERENCES users(user_id),
  published_at timestamptz DEFAULT now(),
  UNIQUE (document_id, version_number)
);

ALTER TABLE ld_document_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "version_owner" ON ld_document_versions
  FOR ALL USING (published_by = auth.uid());

-- ================================================
-- DOCUMENT TP LINKS
-- ================================================
CREATE TABLE ld_document_tp_links (
  link_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES ld_documents(document_id)
    ON DELETE CASCADE,
  node_id uuid REFERENCES ld_document_nodes(node_id)
    ON DELETE CASCADE,
  tp_id uuid NOT NULL REFERENCES tujuan_pembelajaran(tp_id)
    ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE (document_id, node_id, tp_id)
);

ALTER TABLE ld_document_tp_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tp_link_via_document" ON ld_document_tp_links
  FOR ALL USING (
    document_id IN (
      SELECT document_id FROM ld_documents
      WHERE created_by = auth.uid()
    )
  );

-- ================================================
-- INDEXES
-- ================================================
CREATE INDEX idx_ld_docs_school ON ld_documents(school_id);
CREATE INDEX idx_ld_docs_created_by ON ld_documents(created_by);
CREATE INDEX idx_ld_docs_assignment ON ld_documents(teaching_assignment_id);
CREATE INDEX idx_ld_docs_type ON ld_documents(document_type);
CREATE INDEX idx_ld_nodes_document ON ld_document_nodes(document_id);
CREATE INDEX idx_ld_nodes_parent ON ld_document_nodes(parent_node_id);
CREATE INDEX idx_ld_nodes_type ON ld_document_nodes(node_type);
CREATE INDEX idx_ld_tp_links_tp ON ld_document_tp_links(tp_id);
CREATE INDEX idx_ld_snapshots_class ON ld_context_snapshots(class_id);
CREATE INDEX idx_ld_snapshots_assignment
  ON ld_context_snapshots(teaching_assignment_id);
CREATE INDEX idx_national_knowledge_code
  ON ld_program_knowledge_national(program_code);

-- ================================================
-- AUTO-UPDATE TRIGGERS
-- ================================================
CREATE OR REPLACE FUNCTION update_ld_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE EXECUTE ON FUNCTION update_ld_updated_at() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION update_ld_updated_at() FROM anon;

CREATE TRIGGER trg_ld_documents_updated_at
  BEFORE UPDATE ON ld_documents
  FOR EACH ROW EXECUTE FUNCTION update_ld_updated_at();

CREATE TRIGGER trg_ld_nodes_updated_at
  BEFORE UPDATE ON ld_document_nodes
  FOR EACH ROW EXECUTE FUNCTION update_ld_updated_at();

CREATE TRIGGER trg_school_knowledge_updated_at
  BEFORE UPDATE ON ld_program_knowledge_school
  FOR EACH ROW EXECUTE FUNCTION update_ld_updated_at();

CREATE TRIGGER trg_teacher_knowledge_updated_at
  BEFORE UPDATE ON ld_teacher_knowledge
  FOR EACH ROW EXECUTE FUNCTION update_ld_updated_at();
