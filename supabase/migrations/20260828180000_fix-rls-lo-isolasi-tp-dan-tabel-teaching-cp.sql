-- Migration: fix RLS rls_lo_select_guru + buat tabel teaching_cp & teaching_cp_elements
-- Catatan: fn_current_role() tidak ada di DB; dipakai fn_current_user_role() sesuai konvensi project.
-- Kolom semester di learning_objectives bertipe integer; teaching_cp konsisten memakai integer.

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────────
-- PEKERJAAN 1: Fix RLS SELECT learning_objectives — tambah filter teacher_id
-- ──────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS rls_lo_select_guru ON learning_objectives;

CREATE POLICY rls_lo_select_guru ON learning_objectives
    FOR SELECT TO authenticated
    USING (
        school_id  = fn_current_school_id()
        AND fn_current_user_role() = 'GURU'::role_type
        AND teacher_id = fn_current_user_id()
    );

-- ──────────────────────────────────────────────────────────────────────────────
-- PEKERJAAN 2: Tabel teaching_cp
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS teaching_cp (
    cp_id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id    uuid        NOT NULL,
    teacher_id   uuid        NOT NULL,
    class_id     uuid        NOT NULL,
    subject_id   uuid        NOT NULL,
    academic_year varchar    NOT NULL,
    semester     integer     NOT NULL,
    cp_umum      text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (school_id, teacher_id, class_id, subject_id, academic_year, semester)
);

ALTER TABLE teaching_cp ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_tcp_select ON teaching_cp;
CREATE POLICY rls_tcp_select ON teaching_cp
    FOR SELECT TO authenticated
    USING (
        school_id  = fn_current_school_id()
        AND teacher_id = fn_current_user_id()
        AND fn_current_user_role() = 'GURU'::role_type
    );

DROP POLICY IF EXISTS rls_tcp_insert ON teaching_cp;
CREATE POLICY rls_tcp_insert ON teaching_cp
    FOR INSERT TO authenticated
    WITH CHECK (
        school_id  = fn_current_school_id()
        AND teacher_id = fn_current_user_id()
        AND fn_current_user_role() = 'GURU'::role_type
    );

DROP POLICY IF EXISTS rls_tcp_update ON teaching_cp;
CREATE POLICY rls_tcp_update ON teaching_cp
    FOR UPDATE TO authenticated
    USING (
        school_id  = fn_current_school_id()
        AND teacher_id = fn_current_user_id()
        AND fn_current_user_role() = 'GURU'::role_type
    )
    WITH CHECK (
        school_id  = fn_current_school_id()
        AND teacher_id = fn_current_user_id()
        AND fn_current_user_role() = 'GURU'::role_type
    );

DROP POLICY IF EXISTS rls_tcp_delete ON teaching_cp;
CREATE POLICY rls_tcp_delete ON teaching_cp
    FOR DELETE TO authenticated
    USING (
        school_id  = fn_current_school_id()
        AND teacher_id = fn_current_user_id()
        AND fn_current_user_role() = 'GURU'::role_type
    );

CREATE OR REPLACE TRIGGER trg_teaching_cp_updated_at
    BEFORE UPDATE ON teaching_cp
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- ──────────────────────────────────────────────────────────────────────────────
-- PEKERJAAN 2: Tabel teaching_cp_elements
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS teaching_cp_elements (
    element_id   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    cp_id        uuid        NOT NULL REFERENCES teaching_cp(cp_id) ON DELETE CASCADE,
    school_id    uuid        NOT NULL,
    teacher_id   uuid        NOT NULL,
    nama_elemen  text        NOT NULL,
    deskripsi_cp text        NOT NULL,
    urutan       smallint    NOT NULL DEFAULT 0,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE teaching_cp_elements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_tce_select ON teaching_cp_elements;
CREATE POLICY rls_tce_select ON teaching_cp_elements
    FOR SELECT TO authenticated
    USING (
        school_id  = fn_current_school_id()
        AND teacher_id = fn_current_user_id()
        AND fn_current_user_role() = 'GURU'::role_type
    );

DROP POLICY IF EXISTS rls_tce_insert ON teaching_cp_elements;
CREATE POLICY rls_tce_insert ON teaching_cp_elements
    FOR INSERT TO authenticated
    WITH CHECK (
        school_id  = fn_current_school_id()
        AND teacher_id = fn_current_user_id()
        AND fn_current_user_role() = 'GURU'::role_type
    );

DROP POLICY IF EXISTS rls_tce_update ON teaching_cp_elements;
CREATE POLICY rls_tce_update ON teaching_cp_elements
    FOR UPDATE TO authenticated
    USING (
        school_id  = fn_current_school_id()
        AND teacher_id = fn_current_user_id()
        AND fn_current_user_role() = 'GURU'::role_type
    )
    WITH CHECK (
        school_id  = fn_current_school_id()
        AND teacher_id = fn_current_user_id()
        AND fn_current_user_role() = 'GURU'::role_type
    );

DROP POLICY IF EXISTS rls_tce_delete ON teaching_cp_elements;
CREATE POLICY rls_tce_delete ON teaching_cp_elements
    FOR DELETE TO authenticated
    USING (
        school_id  = fn_current_school_id()
        AND teacher_id = fn_current_user_id()
        AND fn_current_user_role() = 'GURU'::role_type
    );

CREATE OR REPLACE TRIGGER trg_teaching_cp_elements_updated_at
    BEFORE UPDATE ON teaching_cp_elements
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

COMMIT;
