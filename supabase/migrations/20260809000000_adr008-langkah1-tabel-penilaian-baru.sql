-- ADR-008 Langkah 1 — Tabel penilaian baru (additive, tidak menyentuh tabel lama)
-- Buat 4 tabel: assessments, student_grades, assessment_rubric_criteria, assessment_rubric_results
-- Tabel lama (tp_assessments, grade_summaries, dll) tetap hidup sampai Langkah 4.

-- ============================================================
-- 1. assessments
-- ============================================================
CREATE TABLE IF NOT EXISTS assessments (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id        UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
    teacher_id       UUID NOT NULL REFERENCES users(user_id)     ON DELETE CASCADE,
    class_id         UUID NOT NULL REFERENCES classes(class_id)  ON DELETE CASCADE,
    subject_id       UUID NOT NULL REFERENCES public.subjects(subject_id) ON DELETE CASCADE,
    academic_year    VARCHAR(9)   NOT NULL,
    semester         INTEGER      NOT NULL CHECK (semester IN (1, 2)),
    judul            TEXT         NOT NULL,
    jenis            TEXT         NOT NULL
                     CHECK (jenis IN ('DIAGNOSTIK_NK','DIAGNOSTIK_K','FORMATIF','SUMATIF')),
    teknik           TEXT,
    tanggal          DATE,
    format_penilaian TEXT
                     CHECK (format_penilaian IN ('SKOR','RUBRIK')),
    tp_id            UUID,       -- referensi ke learning_objectives, FK sengaja tidak dibuat (akan di-drop Langkah 4)
    tindak_lanjut    TEXT,
    catatan_tl       TEXT,
    is_published     BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assessments_school_teacher
    ON assessments(school_id, teacher_id);

CREATE INDEX IF NOT EXISTS idx_assessments_class_subject_year
    ON assessments(class_id, subject_id, academic_year, semester);

-- ============================================================
-- 2. student_grades
-- ============================================================
CREATE TABLE IF NOT EXISTS student_grades (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id    UUID NOT NULL REFERENCES assessments(id)    ON DELETE CASCADE,
    student_id       UUID NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    school_id        UUID NOT NULL REFERENCES schools(school_id)   ON DELETE CASCADE,
    teacher_id       UUID NOT NULL REFERENCES users(user_id)       ON DELETE CASCADE,
    judul            TEXT,
    nilai_angka      NUMERIC(5,2),
    deskripsi        TEXT,
    tindak_lanjut    TEXT
                     CHECK (tindak_lanjut IN ('PENGAYAAN','PENGUATAN','PENDAMPINGAN')),
    is_published     BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (assessment_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_student_grades_school_student
    ON student_grades(school_id, student_id);

CREATE INDEX IF NOT EXISTS idx_student_grades_assessment
    ON student_grades(assessment_id);

-- ============================================================
-- 3. assessment_rubric_criteria
-- ============================================================
CREATE TABLE IF NOT EXISTS assessment_rubric_criteria (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id UUID NOT NULL REFERENCES assessments(id)    ON DELETE CASCADE,
    school_id     UUID NOT NULL REFERENCES schools(school_id) ON DELETE CASCADE,
    teacher_id    UUID NOT NULL REFERENCES users(user_id)     ON DELETE CASCADE,
    nama          TEXT         NOT NULL,
    bobot         NUMERIC(5,2) NOT NULL CHECK (bobot > 0 AND bobot <= 100),
    deskripsi_level JSONB,
    urutan        INTEGER      NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rubric_criteria_assessment
    ON assessment_rubric_criteria(assessment_id);

-- ============================================================
-- 4. assessment_rubric_results
-- ============================================================
CREATE TABLE IF NOT EXISTS assessment_rubric_results (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    criteria_id   UUID NOT NULL REFERENCES assessment_rubric_criteria(id) ON DELETE CASCADE,
    assessment_id UUID NOT NULL REFERENCES assessments(id)                ON DELETE CASCADE,
    student_id    UUID NOT NULL REFERENCES students(student_id)            ON DELETE CASCADE,
    school_id     UUID NOT NULL REFERENCES schools(school_id)             ON DELETE CASCADE,
    teacher_id    UUID NOT NULL REFERENCES users(user_id)                 ON DELETE CASCADE,
    level_dipilih INTEGER,
    skor_hasil    NUMERIC(5,2),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (criteria_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_rubric_results_assessment_student
    ON assessment_rubric_results(assessment_id, student_id);

-- ============================================================
-- RLS — assessments
-- ============================================================
ALTER TABLE assessments ENABLE ROW LEVEL SECURITY;

-- Guru: full CRUD milik sekolah sendiri
CREATE POLICY rls_assessments_select_guru ON assessments
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'GURU'::role_type
    );

CREATE POLICY rls_assessments_insert_guru ON assessments
    FOR INSERT WITH CHECK (
        school_id  = fn_current_school_id()
        AND teacher_id = fn_current_user_id()
        AND fn_current_user_role() = 'GURU'::role_type
    );

CREATE POLICY rls_assessments_update_guru ON assessments
    FOR UPDATE USING (
        school_id  = fn_current_school_id()
        AND teacher_id = fn_current_user_id()
        AND fn_current_user_role() = 'GURU'::role_type
    ) WITH CHECK (
        school_id  = fn_current_school_id()
        AND teacher_id = fn_current_user_id()
    );

CREATE POLICY rls_assessments_delete_guru ON assessments
    FOR DELETE USING (
        school_id  = fn_current_school_id()
        AND teacher_id = fn_current_user_id()
        AND fn_current_user_role() = 'GURU'::role_type
    );

-- Siswa: hanya baca assessment yang sudah published, dari kelas yang terdaftar
CREATE POLICY rls_assessments_select_siswa ON assessments
    FOR SELECT USING (
        school_id    = fn_current_school_id()
        AND is_published = TRUE
        AND fn_current_user_role() = 'SISWA'::role_type
        AND EXISTS (
            SELECT 1 FROM class_enrollments ce
            WHERE ce.class_id      = assessments.class_id
              AND ce.student_id    = fn_current_student_id()
              AND ce.withdrawn_at IS NULL
        )
    );

-- ============================================================
-- RLS — student_grades
-- ============================================================
ALTER TABLE student_grades ENABLE ROW LEVEL SECURITY;

CREATE POLICY rls_student_grades_select_guru ON student_grades
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'GURU'::role_type
    );

CREATE POLICY rls_student_grades_insert_guru ON student_grades
    FOR INSERT WITH CHECK (
        school_id  = fn_current_school_id()
        AND teacher_id = fn_current_user_id()
        AND fn_current_user_role() = 'GURU'::role_type
    );

CREATE POLICY rls_student_grades_update_guru ON student_grades
    FOR UPDATE USING (
        school_id  = fn_current_school_id()
        AND teacher_id = fn_current_user_id()
        AND fn_current_user_role() = 'GURU'::role_type
    ) WITH CHECK (
        school_id  = fn_current_school_id()
        AND teacher_id = fn_current_user_id()
    );

CREATE POLICY rls_student_grades_delete_guru ON student_grades
    FOR DELETE USING (
        school_id  = fn_current_school_id()
        AND teacher_id = fn_current_user_id()
        AND fn_current_user_role() = 'GURU'::role_type
    );

-- Siswa: hanya baca nilai milik sendiri yang sudah published
CREATE POLICY rls_student_grades_select_siswa ON student_grades
    FOR SELECT USING (
        school_id    = fn_current_school_id()
        AND is_published = TRUE
        AND student_id   = fn_current_student_id()
        AND fn_current_user_role() = 'SISWA'::role_type
    );

-- ============================================================
-- RLS — assessment_rubric_criteria
-- ============================================================
ALTER TABLE assessment_rubric_criteria ENABLE ROW LEVEL SECURITY;

CREATE POLICY rls_rubric_criteria_select_guru ON assessment_rubric_criteria
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'GURU'::role_type
    );

CREATE POLICY rls_rubric_criteria_insert_guru ON assessment_rubric_criteria
    FOR INSERT WITH CHECK (
        school_id  = fn_current_school_id()
        AND teacher_id = fn_current_user_id()
        AND fn_current_user_role() = 'GURU'::role_type
    );

CREATE POLICY rls_rubric_criteria_update_guru ON assessment_rubric_criteria
    FOR UPDATE USING (
        school_id  = fn_current_school_id()
        AND teacher_id = fn_current_user_id()
        AND fn_current_user_role() = 'GURU'::role_type
    ) WITH CHECK (
        school_id  = fn_current_school_id()
        AND teacher_id = fn_current_user_id()
    );

CREATE POLICY rls_rubric_criteria_delete_guru ON assessment_rubric_criteria
    FOR DELETE USING (
        school_id  = fn_current_school_id()
        AND teacher_id = fn_current_user_id()
        AND fn_current_user_role() = 'GURU'::role_type
    );

-- ============================================================
-- RLS — assessment_rubric_results
-- ============================================================
ALTER TABLE assessment_rubric_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY rls_rubric_results_select_guru ON assessment_rubric_results
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'GURU'::role_type
    );

CREATE POLICY rls_rubric_results_insert_guru ON assessment_rubric_results
    FOR INSERT WITH CHECK (
        school_id  = fn_current_school_id()
        AND teacher_id = fn_current_user_id()
        AND fn_current_user_role() = 'GURU'::role_type
    );

CREATE POLICY rls_rubric_results_update_guru ON assessment_rubric_results
    FOR UPDATE USING (
        school_id  = fn_current_school_id()
        AND teacher_id = fn_current_user_id()
        AND fn_current_user_role() = 'GURU'::role_type
    ) WITH CHECK (
        school_id  = fn_current_school_id()
        AND teacher_id = fn_current_user_id()
    );

CREATE POLICY rls_rubric_results_delete_guru ON assessment_rubric_results
    FOR DELETE USING (
        school_id  = fn_current_school_id()
        AND teacher_id = fn_current_user_id()
        AND fn_current_user_role() = 'GURU'::role_type
    );
