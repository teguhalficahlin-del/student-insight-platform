-- Sinkronisasi skema assessments ke pola MiClass
-- Alasan: JS penilaian.js clone MiClass butuh kolom MiClass,
--         ADR-008 menanam skema berbeda. Tabel kosong — aman di-ALTER.

-- ============================================================
-- FASE 1: DROP RLS policies yang referensi assessments.is_published
--         (termasuk cross-table via JOIN ke assessments — harus
--          sebelum DROP COLUMN)
-- ============================================================
-- Policies langsung pada tabel assessments
DROP POLICY IF EXISTS rls_assessments_select_siswa    ON assessments;
DROP POLICY IF EXISTS rls_assessments_select_ortu     ON assessments;
DROP POLICY IF EXISTS rls_assessments_select_wali     ON assessments;
DROP POLICY IF EXISTS rls_assessments_select_kaprodi  ON assessments;

-- Policies pada child tables yang JOIN ke assessments.is_published
DROP POLICY IF EXISTS rls_rubric_criteria_select_ortu ON assessment_rubric_criteria;
DROP POLICY IF EXISTS rls_rubric_criteria_select_wali ON assessment_rubric_criteria;
DROP POLICY IF EXISTS rls_rubric_results_select_ortu  ON assessment_rubric_results;
DROP POLICY IF EXISTS rls_rubric_results_select_wali  ON assessment_rubric_results;

-- ============================================================
-- FASE 2: DROP FK constraint tp_id
-- ============================================================
ALTER TABLE assessments
    DROP CONSTRAINT IF EXISTS fk_assessments_tp_id;

-- ============================================================
-- FASE 3: DROP kolom ADR-008 yang tidak ada di skema MiClass
-- ============================================================
ALTER TABLE assessments
    DROP COLUMN IF EXISTS judul,
    DROP COLUMN IF EXISTS format_penilaian,
    DROP COLUMN IF EXISTS tp_id,
    DROP COLUMN IF EXISTS tindak_lanjut,
    DROP COLUMN IF EXISTS catatan_tl,
    DROP COLUMN IF EXISTS is_published;

-- ============================================================
-- FASE 4: ADD kolom MiClass
-- ============================================================
ALTER TABLE assessments
    ADD COLUMN IF NOT EXISTS instrumen             TEXT,
    ADD COLUMN IF NOT EXISTS tujuan                TEXT,
    ADD COLUMN IF NOT EXISTS konten                JSONB,
    ADD COLUMN IF NOT EXISTS refleksi_guru         TEXT,
    ADD COLUMN IF NOT EXISTS is_visible_siswa      BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS is_visible_ortu       BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS learning_objective_id UUID
        REFERENCES learning_objectives(id) ON DELETE SET NULL;

-- ============================================================
-- FASE 5: RECREATE RLS policies dengan kolom baru
-- ============================================================

-- Siswa: lihat assessment yang visible_siswa, dari kelas yang terdaftar
CREATE POLICY rls_assessments_select_siswa ON assessments
    FOR SELECT USING (
        school_id            = fn_current_school_id()
        AND is_visible_siswa = TRUE
        AND fn_current_user_role() = 'SISWA'::role_type
        AND EXISTS (
            SELECT 1 FROM class_enrollments ce
            WHERE ce.class_id   = assessments.class_id
              AND ce.student_id = fn_current_student_id()
              AND ce.withdrawn_at IS NULL
        )
    );

-- Ortu: lihat assessment yang visible_ortu, dari kelas anaknya
CREATE POLICY rls_assessments_select_ortu ON assessments
    FOR SELECT USING (
        school_id           = fn_current_school_id()
        AND is_visible_ortu = TRUE
        AND fn_current_user_role() = 'ORTU'::role_type
        AND EXISTS (
            SELECT 1
            FROM student_parents sp
            JOIN class_enrollments ce ON ce.student_id = sp.student_id
            WHERE sp.parent_user_id = fn_current_user_id()
              AND sp.school_id      = fn_current_school_id()
              AND ce.class_id       = assessments.class_id
              AND ce.withdrawn_at  IS NULL
        )
    );

-- Wali kelas: lihat assessment visible_siswa dari kelas yang dia wali
CREATE POLICY rls_assessments_select_wali ON assessments
    FOR SELECT USING (
        school_id            = fn_current_school_id()
        AND is_visible_siswa = TRUE
        AND fn_current_user_role() = 'WALI_KELAS'::role_type
        AND fn_wali_kelas_class_id() IS NOT NULL
        AND class_id = fn_wali_kelas_class_id()
    );

-- Kaprodi: lihat assessment visible_siswa dari kelas program studinya
CREATE POLICY rls_assessments_select_kaprodi ON assessments
    FOR SELECT USING (
        school_id            = fn_current_school_id()
        AND is_visible_siswa = TRUE
        AND fn_current_user_role() = 'KAPRODI'::role_type
        AND fn_kaprodi_program_id() IS NOT NULL
        AND EXISTS (
            SELECT 1
            FROM students s
            JOIN class_enrollments ce ON ce.student_id = s.student_id
            WHERE ce.class_id      = assessments.class_id
              AND s.program_id     = fn_kaprodi_program_id()
              AND ce.withdrawn_at IS NULL
        )
    );

-- ============================================================
-- FASE 6: RECREATE policies child tables (rubric_criteria + rubric_results)
--         ganti a.is_published → a.is_visible_ortu / a.is_visible_siswa
-- ============================================================

-- assessment_rubric_criteria — ortu
CREATE POLICY rls_rubric_criteria_select_ortu ON assessment_rubric_criteria
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ORTU'::role_type
        AND EXISTS (
            SELECT 1
            FROM assessments a
            JOIN student_parents sp
              ON sp.parent_user_id = fn_current_user_id()
             AND sp.school_id      = fn_current_school_id()
            JOIN class_enrollments ce
              ON ce.student_id    = sp.student_id
             AND ce.class_id      = a.class_id
             AND ce.withdrawn_at IS NULL
            WHERE a.id               = assessment_rubric_criteria.assessment_id
              AND a.is_visible_ortu  = TRUE
        )
    );

-- assessment_rubric_criteria — wali kelas
CREATE POLICY rls_rubric_criteria_select_wali ON assessment_rubric_criteria
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'WALI_KELAS'::role_type
        AND fn_wali_kelas_class_id() IS NOT NULL
        AND EXISTS (
            SELECT 1
            FROM assessments a
            WHERE a.id               = assessment_rubric_criteria.assessment_id
              AND a.is_visible_siswa = TRUE
              AND a.class_id         = fn_wali_kelas_class_id()
        )
    );

-- assessment_rubric_results — ortu
CREATE POLICY rls_rubric_results_select_ortu ON assessment_rubric_results
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ORTU'::role_type
        AND EXISTS (
            SELECT 1
            FROM student_parents sp
            WHERE sp.parent_user_id = fn_current_user_id()
              AND sp.student_id     = assessment_rubric_results.student_id
              AND sp.school_id      = fn_current_school_id()
        )
        AND EXISTS (
            SELECT 1
            FROM assessments a
            WHERE a.id              = assessment_rubric_results.assessment_id
              AND a.is_visible_ortu = TRUE
        )
    );

-- assessment_rubric_results — wali kelas
CREATE POLICY rls_rubric_results_select_wali ON assessment_rubric_results
    FOR SELECT USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'WALI_KELAS'::role_type
        AND fn_wali_kelas_class_id() IS NOT NULL
        AND EXISTS (
            SELECT 1
            FROM assessments a
            WHERE a.id               = assessment_rubric_results.assessment_id
              AND a.is_visible_siswa = TRUE
              AND a.class_id         = fn_wali_kelas_class_id()
        )
    );
