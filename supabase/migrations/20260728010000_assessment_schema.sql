-- Fitur penilaian formatif dan sumatif Kurikulum Merdeka
-- 6 tabel: learning_objectives, learning_objective_classes,
--          assessment_criteria, grading_settings,
--          tp_assessments, grade_summaries
-- RLS dan RPC dibuat di migration terpisah.

CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- 1. Tujuan Pembelajaran per guru per mapel per semester
CREATE TABLE learning_objectives (
    learning_objective_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id             UUID NOT NULL REFERENCES schools(school_id),
    teacher_user_id       UUID NOT NULL REFERENCES users(user_id),
    subject_id            UUID NOT NULL REFERENCES public.subjects(subject_id),
    academic_year         VARCHAR(9)  NOT NULL,
    semester              INTEGER     NOT NULL CHECK (semester IN (1,2)),
    kode_tp               VARCHAR(30) NOT NULL,
    deskripsi_tp          TEXT        NOT NULL,
    urutan                INTEGER     NOT NULL DEFAULT 1,
    berlaku_untuk         VARCHAR(20) NOT NULL
                          CHECK (berlaku_untuk IN ('SEMUA_KELAS','KELAS_TERTENTU')),
    is_active             BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (school_id, teacher_user_id, subject_id,
            academic_year, semester, kode_tp)
);

CREATE INDEX idx_lo_teacher_year_sem
    ON learning_objectives(school_id, teacher_user_id, academic_year, semester);

-- 2. Mapping TP ke kelas tertentu (diisi hanya jika berlaku_untuk = 'KELAS_TERTENTU')
CREATE TABLE learning_objective_classes (
    learning_objective_id UUID NOT NULL
        REFERENCES learning_objectives(learning_objective_id) ON DELETE CASCADE,
    class_id              UUID NOT NULL REFERENCES classes(class_id),
    school_id             UUID NOT NULL REFERENCES schools(school_id),
    PRIMARY KEY (learning_objective_id, class_id)
);

-- 3. KKTP (Kriteria Ketercapaian Tujuan Pembelajaran) per TP
CREATE TABLE assessment_criteria (
    criterion_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    learning_objective_id UUID NOT NULL
        REFERENCES learning_objectives(learning_objective_id) ON DELETE CASCADE,
    school_id             UUID NOT NULL REFERENCES schools(school_id),
    batas_bawah           NUMERIC(5,2) NOT NULL,
    batas_atas            NUMERIC(5,2) NOT NULL,
    predikat              TEXT         NOT NULL,
    keterangan            TEXT,
    CHECK (batas_bawah >= 0 AND batas_atas <= 100 AND batas_bawah < batas_atas)
);

-- Trigger: tolak range yang tumpang tindih untuk TP yang sama
CREATE OR REPLACE FUNCTION fn_check_assessment_criteria_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_conflict_predikat TEXT;
BEGIN
    SELECT predikat INTO v_conflict_predikat
    FROM assessment_criteria
    WHERE learning_objective_id = NEW.learning_objective_id
      AND (TG_OP = 'INSERT' OR criterion_id <> NEW.criterion_id)
      AND batas_bawah < NEW.batas_atas
      AND batas_atas  > NEW.batas_bawah
    LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION
            'Range %.2f–%.2f tumpang tindih dengan predikat "%"',
            NEW.batas_bawah, NEW.batas_atas, v_conflict_predikat;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_assessment_criteria_no_overlap
    BEFORE INSERT OR UPDATE ON assessment_criteria
    FOR EACH ROW
    EXECUTE FUNCTION fn_check_assessment_criteria_overlap();

-- 4. Keputusan guru per mapel per kelas per semester (bobot, metode, publikasi)
CREATE TABLE grading_settings (
    grading_setting_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id             UUID        NOT NULL REFERENCES schools(school_id),
    teacher_user_id       UUID        NOT NULL REFERENCES users(user_id),
    subject_id            UUID        NOT NULL REFERENCES public.subjects(subject_id),
    class_id              UUID        NOT NULL REFERENCES classes(class_id),
    academic_year         VARCHAR(9)  NOT NULL,
    semester              INTEGER     NOT NULL CHECK (semester IN (1,2)),
    is_formatif_included  BOOLEAN     NOT NULL DEFAULT FALSE,
    metode_formatif       VARCHAR(20)
                          CHECK (metode_formatif IN ('BOBOT','KONTEKS_SAJA')),
    bobot_formatif        INTEGER CHECK (bobot_formatif BETWEEN 0 AND 100),
    bobot_sumatif         INTEGER CHECK (bobot_sumatif BETWEEN 0 AND 100),
    is_auto_calculate     BOOLEAN     NOT NULL DEFAULT TRUE,
    is_published          BOOLEAN     NOT NULL DEFAULT FALSE,
    published_at          TIMESTAMPTZ,
    locked_at             TIMESTAMPTZ,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (school_id, teacher_user_id, subject_id,
            class_id, academic_year, semester),
    CHECK (metode_formatif <> 'BOBOT'
           OR (bobot_formatif + bobot_sumatif = 100)),
    CHECK (is_formatif_included = TRUE
           OR (bobot_formatif IS NULL AND bobot_sumatif IS NULL))
);

CREATE INDEX idx_grading_settings_lookup
    ON grading_settings(school_id, teacher_user_id,
                        class_id, academic_year, semester);

-- 5. Nilai per siswa per TP (formatif maupun sumatif, termasuk remedial)
CREATE TABLE tp_assessments (
    assessment_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id             UUID        NOT NULL REFERENCES schools(school_id),
    learning_objective_id UUID        NOT NULL
        REFERENCES learning_objectives(learning_objective_id),
    student_id            UUID        NOT NULL REFERENCES students(student_id),
    teacher_user_id       UUID        NOT NULL REFERENCES users(user_id),
    class_id              UUID        NOT NULL REFERENCES classes(class_id),
    tipe                  VARCHAR(20) NOT NULL
                          CHECK (tipe IN ('FORMATIF','SUMATIF')),
    judul                 TEXT,
    nilai_angka           NUMERIC(5,2)
                          CHECK (nilai_angka IS NULL
                                 OR (nilai_angka >= 0 AND nilai_angka <= 100)),
    nilai_kualitatif      TEXT,
    is_void               BOOLEAN     NOT NULL DEFAULT FALSE,
    void_reason           TEXT,
    tanggal               DATE        NOT NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (nilai_angka IS NOT NULL OR nilai_kualitatif IS NOT NULL)
);

CREATE INDEX idx_tp_assessments_student_lo
    ON tp_assessments(school_id, student_id, learning_objective_id);

CREATE INDEX idx_tp_assessments_class_lo
    ON tp_assessments(school_id, class_id, learning_objective_id, tipe);

-- 6. Nilai akhir per siswa per mapel per semester (hasil kalkulasi atau override guru)
CREATE TABLE grade_summaries (
    grade_summary_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id             UUID        NOT NULL REFERENCES schools(school_id),
    student_id            UUID        NOT NULL REFERENCES students(student_id),
    teacher_user_id       UUID        NOT NULL REFERENCES users(user_id),
    subject_id            UUID        NOT NULL REFERENCES public.subjects(subject_id),
    class_id              UUID        NOT NULL REFERENCES classes(class_id),
    academic_year         VARCHAR(9)  NOT NULL,
    semester              INTEGER     NOT NULL CHECK (semester IN (1,2)),
    nilai_akhir           NUMERIC(5,2),
    predikat              TEXT,
    deskripsi_naratif     TEXT,
    is_auto_calculate     BOOLEAN     NOT NULL DEFAULT TRUE,
    last_calculated_at    TIMESTAMPTZ,
    published_at          TIMESTAMPTZ,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (school_id, student_id, subject_id,
            class_id, academic_year, semester)
);

CREATE INDEX idx_grade_summaries_student
    ON grade_summaries(school_id, student_id, academic_year, semester);

CREATE INDEX idx_grade_summaries_teacher
    ON grade_summaries(school_id, teacher_user_id,
                       class_id, academic_year, semester);
