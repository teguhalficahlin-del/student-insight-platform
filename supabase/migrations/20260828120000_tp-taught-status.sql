-- Migration: tp_taught_status + fn_toggle_tp_taught
-- Tracks which TPs (learning_objectives) a teacher has taught per class.
-- RLS: only the owning teacher can read/write their own rows.

BEGIN;

-- ── Tabel tp_taught_status ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tp_taught_status (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id uuid        NOT NULL REFERENCES users(user_id),
    class_id   uuid        NOT NULL REFERENCES classes(class_id),
    tp_id      text        NOT NULL,
    school_id  uuid        NOT NULL REFERENCES schools(school_id),
    is_taught  boolean     NOT NULL DEFAULT false,
    taught_at  timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (teacher_id, class_id, tp_id)
);

ALTER TABLE tp_taught_status ENABLE ROW LEVEL SECURITY;

-- SELECT: guru hanya bisa lihat status miliknya sendiri, di sekolah yang sama
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'tp_taught_status' AND policyname = 'tp_taught_status_select'
    ) THEN
        CREATE POLICY tp_taught_status_select ON tp_taught_status
            FOR SELECT TO authenticated
            USING (
                teacher_id = fn_current_user_id()
                AND school_id = fn_current_school_id()
            );
    END IF;
END $$;

-- INSERT: guru hanya bisa insert untuk dirinya sendiri
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'tp_taught_status' AND policyname = 'tp_taught_status_insert'
    ) THEN
        CREATE POLICY tp_taught_status_insert ON tp_taught_status
            FOR INSERT TO authenticated
            WITH CHECK (
                teacher_id = fn_current_user_id()
                AND school_id = fn_current_school_id()
            );
    END IF;
END $$;

-- UPDATE: guru hanya bisa update miliknya sendiri
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'tp_taught_status' AND policyname = 'tp_taught_status_update'
    ) THEN
        CREATE POLICY tp_taught_status_update ON tp_taught_status
            FOR UPDATE TO authenticated
            USING (
                teacher_id = fn_current_user_id()
                AND school_id = fn_current_school_id()
            )
            WITH CHECK (
                teacher_id = fn_current_user_id()
                AND school_id = fn_current_school_id()
            );
    END IF;
END $$;

-- ── RPC fn_toggle_tp_taught ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_toggle_tp_taught(
    p_class_id  uuid,
    p_tp_id     text,
    p_is_taught boolean
)
RETURNS TABLE (
    id         uuid,
    teacher_id uuid,
    class_id   uuid,
    tp_id      text,
    school_id  uuid,
    is_taught  boolean,
    taught_at  timestamptz,
    updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_teacher_id uuid := fn_current_user_id();
    v_school_id  uuid := fn_current_school_id();
BEGIN
    IF v_teacher_id IS NULL OR v_school_id IS NULL THEN
        RAISE EXCEPTION 'Sesi tidak ditemukan';
    END IF;

    RETURN QUERY
    INSERT INTO tp_taught_status (teacher_id, class_id, tp_id, school_id, is_taught, taught_at, updated_at)
    VALUES (
        v_teacher_id,
        p_class_id,
        p_tp_id,
        v_school_id,
        p_is_taught,
        CASE WHEN p_is_taught THEN now() ELSE NULL END,
        now()
    )
    ON CONFLICT (teacher_id, class_id, tp_id) DO UPDATE
        SET is_taught  = EXCLUDED.is_taught,
            taught_at  = CASE WHEN EXCLUDED.is_taught THEN now() ELSE NULL END,
            updated_at = now()
    RETURNING
        tp_taught_status.id,
        tp_taught_status.teacher_id,
        tp_taught_status.class_id,
        tp_taught_status.tp_id,
        tp_taught_status.school_id,
        tp_taught_status.is_taught,
        tp_taught_status.taught_at,
        tp_taught_status.updated_at;
END;
$$;

GRANT   EXECUTE ON FUNCTION fn_toggle_tp_taught(uuid, text, boolean) TO authenticated;
REVOKE  EXECUTE ON FUNCTION fn_toggle_tp_taught(uuid, text, boolean) FROM anon;
REVOKE  EXECUTE ON FUNCTION fn_toggle_tp_taught(uuid, text, boolean) FROM PUBLIC;

ROLLBACK;
