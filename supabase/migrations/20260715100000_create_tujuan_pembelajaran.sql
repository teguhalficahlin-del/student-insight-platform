CREATE TABLE tujuan_pembelajaran (
  tp_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id     UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
  cp_id         UUID REFERENCES capaian_pembelajaran(cp_id) ON DELETE SET NULL,
  subject_id    UUID NOT NULL REFERENCES subjects(subject_id) ON DELETE RESTRICT,
  program_id    UUID REFERENCES programs(program_id) ON DELETE RESTRICT,
  fase          VARCHAR(1) NOT NULL CHECK (fase IN ('E','F')),
  semester      INTEGER NOT NULL CHECK (semester IN (1,2)),
  urutan        INTEGER NOT NULL,
  kode_tp       VARCHAR(30),
  deskripsi_tp  TEXT NOT NULL,
  materi_pokok  TEXT,
  alokasi_jp    INTEGER,
  indikator     TEXT[],
  generated_by  VARCHAR(10) NOT NULL DEFAULT 'MANUAL'
                CHECK (generated_by IN ('AI','MANUAL')),
  created_by    UUID REFERENCES users(user_id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_tp UNIQUE (school_id, subject_id, program_id, fase, semester, urutan)
);

CREATE INDEX idx_tp_school_subject ON tujuan_pembelajaran(school_id, subject_id);
CREATE INDEX idx_tp_cp ON tujuan_pembelajaran(cp_id);
CREATE INDEX idx_tp_fase_semester ON tujuan_pembelajaran(fase, semester);

-- RLS
ALTER TABLE tujuan_pembelajaran ENABLE ROW LEVEL SECURITY;

CREATE POLICY rls_tp_read ON tujuan_pembelajaran
  FOR SELECT USING (school_id = fn_current_school_id());

CREATE POLICY rls_tp_write ON tujuan_pembelajaran
  FOR ALL USING (
    school_id = fn_current_school_id()
    AND fn_current_user_role() IN ('ADMINISTRATIVE','GURU','WALI_KELAS',
        'BK','KAPRODI','WAKA_KURIKULUM','WAKA_KESISWAAN','WAKA_HUMAS','KEPSEK')
  );
