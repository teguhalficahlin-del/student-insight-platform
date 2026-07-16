CREATE TABLE capaian_pembelajaran (
  cp_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
  subject_id    UUID NOT NULL REFERENCES subjects(subject_id) ON DELETE RESTRICT,
  program_id    UUID REFERENCES programs(program_id) ON DELETE RESTRICT,
  fase          VARCHAR(1) NOT NULL CHECK (fase IN ('E','F')),
  elemen        VARCHAR(100) NOT NULL,
  deskripsi_cp  TEXT NOT NULL,
  generated_by  VARCHAR(10) NOT NULL DEFAULT 'MANUAL'
                CHECK (generated_by IN ('AI','MANUAL')),
  created_by    UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_cp UNIQUE (school_id, subject_id, program_id, fase, elemen)
);

CREATE INDEX idx_cp_school_subject ON capaian_pembelajaran(school_id, subject_id);
CREATE INDEX idx_cp_fase ON capaian_pembelajaran(fase);

-- RLS
ALTER TABLE capaian_pembelajaran ENABLE ROW LEVEL SECURITY;

CREATE POLICY rls_cp_read ON capaian_pembelajaran
  FOR SELECT USING (school_id = fn_current_school_id());

CREATE POLICY rls_cp_write ON capaian_pembelajaran
  FOR ALL USING (
    school_id = fn_current_school_id()
    AND fn_current_user_role() IN ('ADMINISTRATIVE','GURU','WALI_KELAS',
        'BK','KAPRODI','WAKA_KURIKULUM','WAKA_KESISWAAN','WAKA_HUMAS','KEPSEK')
  );
