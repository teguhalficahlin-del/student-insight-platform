BEGIN;

-- ============================================================
-- ADR-008 Langkah 6b — tabel learning_objectives baru (schema flat)
-- + FK assessments.tp_id → learning_objectives(id)
-- + RLS guru CRUD + RLS siswa SELECT
-- ============================================================

-- 1. Tabel learning_objectives baru
CREATE TABLE IF NOT EXISTS learning_objectives (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id     UUID NOT NULL REFERENCES schools(school_id)          ON DELETE CASCADE,
    teacher_id    UUID NOT NULL REFERENCES users(user_id)              ON DELETE CASCADE,
    class_id      UUID NOT NULL REFERENCES classes(class_id)           ON DELETE CASCADE,
    subject_id    UUID NOT NULL REFERENCES public.subjects(subject_id) ON DELETE CASCADE,
    academic_year VARCHAR(9)   NOT NULL,
    semester      INTEGER      NOT NULL CHECK (semester IN (1, 2)),
    kode_tp       TEXT         NOT NULL,
    deskripsi_tp  TEXT         NOT NULL,
    urutan        INTEGER      NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (school_id, class_id, subject_id, academic_year, semester, kode_tp)
);

CREATE INDEX IF NOT EXISTS idx_lo_school_class_subject_year
    ON learning_objectives(school_id, class_id, subject_id, academic_year, semester);

-- 2. FK assessments.tp_id → learning_objectives(id)
-- nullable + SET NULL ON DELETE: hapus TP tidak hapus assessment
ALTER TABLE assessments
    ADD CONSTRAINT fk_assessments_tp_id
    FOREIGN KEY (tp_id) REFERENCES learning_objectives(id)
    ON DELETE SET NULL;

-- 3. RLS
ALTER TABLE learning_objectives ENABLE ROW LEVEL SECURITY;

-- Guru: full CRUD di sekolah sendiri
CREATE POLICY rls_lo_select_guru ON learning_objectives FOR SELECT USING (
    school_id = fn_current_school_id()
    AND fn_current_user_role() = 'GURU'::role_type
);
CREATE POLICY rls_lo_insert_guru ON learning_objectives FOR INSERT WITH CHECK (
    school_id  = fn_current_school_id()
    AND teacher_id = fn_current_user_id()
    AND fn_current_user_role() = 'GURU'::role_type
);
CREATE POLICY rls_lo_update_guru ON learning_objectives FOR UPDATE
    USING (
        school_id  = fn_current_school_id()
        AND teacher_id = fn_current_user_id()
        AND fn_current_user_role() = 'GURU'::role_type
    )
    WITH CHECK (
        school_id  = fn_current_school_id()
        AND teacher_id = fn_current_user_id()
    );
CREATE POLICY rls_lo_delete_guru ON learning_objectives FOR DELETE USING (
    school_id  = fn_current_school_id()
    AND teacher_id = fn_current_user_id()
    AND fn_current_user_role() = 'GURU'::role_type
);

-- Siswa: SELECT only, dari kelas sendiri
CREATE POLICY rls_lo_select_siswa ON learning_objectives FOR SELECT USING (
    school_id = fn_current_school_id()
    AND fn_current_user_role() = 'SISWA'::role_type
    AND EXISTS (
        SELECT 1 FROM class_enrollments ce
        WHERE ce.class_id      = learning_objectives.class_id
          AND ce.student_id    = fn_current_student_id()
          AND ce.withdrawn_at IS NULL
    )
);

COMMIT;
