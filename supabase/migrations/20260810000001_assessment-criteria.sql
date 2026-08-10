-- Migration: tabel assessment_criteria (KKTP)
-- Setiap KKTP terhubung ke learning_objectives (TP).

BEGIN;

-- ── Tabel ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.assessment_criteria (
    id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    learning_objective_id UUID         NOT NULL REFERENCES public.learning_objectives(id) ON DELETE CASCADE,
    school_id             UUID         NOT NULL REFERENCES public.schools(school_id)      ON DELETE CASCADE,
    predikat              TEXT         NOT NULL,
    batas_bawah           NUMERIC(5,2) NOT NULL CHECK (batas_bawah >= 0),
    batas_atas            NUMERIC(5,2) NOT NULL CHECK (batas_atas  <= 100),
    keterangan            TEXT,
    urutan                INTEGER      NOT NULL DEFAULT 0,
    created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_ac_range CHECK (batas_bawah < batas_atas)
);

CREATE INDEX IF NOT EXISTS idx_ac_lo_id    ON public.assessment_criteria(learning_objective_id);
CREATE INDEX IF NOT EXISTS idx_ac_school_id ON public.assessment_criteria(school_id);

-- ── Trigger no-overlap ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fn_check_kktp_no_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.assessment_criteria
        WHERE learning_objective_id = NEW.learning_objective_id
          AND id <> COALESCE(NEW.id, gen_random_uuid())
          AND NOT (batas_atas <= NEW.batas_bawah OR batas_bawah >= NEW.batas_atas)
    ) THEN
        RAISE EXCEPTION 'Range nilai tumpang tindih dengan KKTP lain';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_check_kktp_no_overlap() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_check_kktp_no_overlap() FROM anon;

CREATE OR REPLACE TRIGGER trg_kktp_no_overlap
    BEFORE INSERT OR UPDATE ON public.assessment_criteria
    FOR EACH ROW EXECUTE FUNCTION public.fn_check_kktp_no_overlap();

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.assessment_criteria ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.assessment_criteria FROM PUBLIC;
REVOKE ALL ON TABLE public.assessment_criteria FROM anon;
REVOKE ALL ON TABLE public.assessment_criteria FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.assessment_criteria TO authenticated;

-- SELECT: semua yang bisa lihat sekolahnya
CREATE POLICY rls_ac_select ON public.assessment_criteria
    FOR SELECT
    USING (school_id = fn_current_school_id());

-- INSERT: guru yang memiliki TP tersebut
CREATE POLICY rls_ac_insert ON public.assessment_criteria
    FOR INSERT
    WITH CHECK (
        school_id = fn_current_school_id()
        AND learning_objective_id IN (
            SELECT id FROM public.learning_objectives
            WHERE teacher_id = auth.uid()
        )
    );

-- UPDATE: guru yang memiliki TP tersebut
CREATE POLICY rls_ac_update ON public.assessment_criteria
    FOR UPDATE
    USING (
        school_id = fn_current_school_id()
        AND learning_objective_id IN (
            SELECT id FROM public.learning_objectives
            WHERE teacher_id = auth.uid()
        )
    )
    WITH CHECK (
        school_id = fn_current_school_id()
        AND learning_objective_id IN (
            SELECT id FROM public.learning_objectives
            WHERE teacher_id = auth.uid()
        )
    );

-- DELETE: guru yang memiliki TP tersebut
CREATE POLICY rls_ac_delete ON public.assessment_criteria
    FOR DELETE
    USING (
        school_id = fn_current_school_id()
        AND learning_objective_id IN (
            SELECT id FROM public.learning_objectives
            WHERE teacher_id = auth.uid()
        )
    );

COMMIT;
