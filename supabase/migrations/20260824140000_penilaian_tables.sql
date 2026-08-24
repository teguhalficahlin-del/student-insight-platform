-- ============================================================
-- Penilaian: assessments, assessment_results, student_groups,
--            grade_recap + rentang column on assessment_criteria
-- ============================================================
-- Dry-run test: run BEGIN … ROLLBACK first, then apply.
-- BEGIN;

-- 1. Add rentang JSONB to assessment_criteria (replaces predikat/batas model)
ALTER TABLE assessment_criteria
  ADD COLUMN IF NOT EXISTS rentang JSONB;

-- 2. assessments
CREATE TABLE IF NOT EXISTS assessments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id             UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
  class_id              UUID NOT NULL REFERENCES classes(class_id) ON DELETE CASCADE,
  subject_id            UUID NOT NULL,
  academic_year         TEXT NOT NULL,
  semester              INTEGER NOT NULL CHECK (semester IN (1,2)),
  teacher_id            UUID NOT NULL REFERENCES auth.users(id),
  learning_objective_id UUID REFERENCES learning_objectives(id) ON DELETE SET NULL,
  jenis                 TEXT NOT NULL CHECK (jenis IN ('DIAGNOSTIK','FORMATIF','SUMATIF')),
  teknik                TEXT NOT NULL,
  instrumen             TEXT NOT NULL,
  tujuan                TEXT,
  konten                JSONB,
  refleksi_guru         TEXT,
  is_visible_siswa      BOOLEAN NOT NULL DEFAULT FALSE,
  is_visible_ortu       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assessments_school_class
  ON assessments (school_id, class_id, subject_id, academic_year, semester);

-- 3. assessment_results
CREATE TABLE IF NOT EXISTS assessment_results (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id         UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
  class_id          UUID NOT NULL REFERENCES classes(class_id) ON DELETE CASCADE,
  assessment_id     UUID NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  student_id        UUID NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  nilai             NUMERIC(5,2),
  status            TEXT,
  tindak_lanjut     TEXT,
  umpan_balik       TEXT,
  catatan           TEXT,
  grup_diferensiasi TEXT,
  kktp_tercapai     BOOLEAN,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (assessment_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_assessment_results_assessment
  ON assessment_results (assessment_id);

-- 4. student_groups  (grup diferensiasi per kelas)
CREATE TABLE IF NOT EXISTS student_groups (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
  class_id   UUID NOT NULL REFERENCES classes(class_id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  grup       TEXT NOT NULL CHECK (grup IN ('A','B','C')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (class_id, student_id)
);

-- 5. grade_recap
CREATE TABLE IF NOT EXISTS grade_recap (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id             UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
  class_id              UUID NOT NULL REFERENCES classes(class_id) ON DELETE CASCADE,
  student_id            UUID NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
  learning_objective_id UUID NOT NULL REFERENCES learning_objectives(id) ON DELETE CASCADE,
  semester              INTEGER NOT NULL CHECK (semester IN (1,2)),
  academic_year         TEXT NOT NULL,
  nilai_akhir           NUMERIC(5,2),
  kktp_tercapai         BOOLEAN,
  deskripsi_capaian     TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, class_id, student_id, learning_objective_id, semester, academic_year)
);

-- ── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE assessments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_groups   ENABLE ROW LEVEL SECURITY;
ALTER TABLE grade_recap      ENABLE ROW LEVEL SECURITY;

-- assessments: guru sekolah bisa baca/tulis milik sekolah sendiri
CREATE POLICY "assessments_school_read" ON assessments
  FOR SELECT USING (school_id = fn_current_school_id());

CREATE POLICY "assessments_school_write" ON assessments
  FOR ALL USING (school_id = fn_current_school_id())
  WITH CHECK (school_id = fn_current_school_id());

-- assessment_results
CREATE POLICY "assessment_results_school_read" ON assessment_results
  FOR SELECT USING (school_id = fn_current_school_id());

CREATE POLICY "assessment_results_school_write" ON assessment_results
  FOR ALL USING (school_id = fn_current_school_id())
  WITH CHECK (school_id = fn_current_school_id());

-- student_groups
CREATE POLICY "student_groups_school_read" ON student_groups
  FOR SELECT USING (school_id = fn_current_school_id());

CREATE POLICY "student_groups_school_write" ON student_groups
  FOR ALL USING (school_id = fn_current_school_id())
  WITH CHECK (school_id = fn_current_school_id());

-- grade_recap
CREATE POLICY "grade_recap_school_read" ON grade_recap
  FOR SELECT USING (school_id = fn_current_school_id());

CREATE POLICY "grade_recap_school_write" ON grade_recap
  FOR ALL USING (school_id = fn_current_school_id())
  WITH CHECK (school_id = fn_current_school_id());

-- ROLLBACK;
