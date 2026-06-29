-- ============================================================
-- Fix H4: tighten rls_cases_update_sync + add column-level
-- immutability guard for the cases table.
--
-- Problem: rls_cases_update_sync was USING (TRUE) — any
-- authenticated role could UPDATE any column on any case row.
-- Only current_handler_role/is_locked were protected by
-- trg_case_guard_denormalized; status, title, description,
-- track, student_id, created_by_user_id, closed_at,
-- closed_by_user_id, locked_by_user_id, locked_at had no
-- DB-level protection at all.
-- ============================================================


-- ============================================================
-- KOMPONEN 1 — Perketat RLS UPDATE policy
-- ============================================================

DROP POLICY IF EXISTS rls_cases_update_sync ON cases;

CREATE POLICY rls_cases_update_sync ON cases
    FOR UPDATE
    USING (
        -- Hanya pemegang current_handler aktif yang boleh trigger UPDATE
        -- (update itu sendiri dilakukan via fn_case_sync_handler,
        --  dipicu oleh INSERT ke case_events — bukan UPDATE langsung)
        fn_current_user_role() = current_handler_role
        OR
        -- KEPSEK boleh trigger FINAL_DECISION kapan saja (selama tidak CLOSED)
        -- fn_case_sync_handler yang akan validasi event type-nya
        (fn_current_user_role() = 'KEPSEK' AND status != 'CLOSED')
        OR
        -- Service-role path untuk fn_case_sync_handler trigger
        -- (trigger berjalan sebagai owner function, bukan sebagai user —
        --  ini sudah bypass RLS secara default untuk trigger SECURITY DEFINER)
        current_setting('app.case_sync_active', TRUE) = 'true'
    );


-- ============================================================
-- KOMPONEN 2 — Trigger baru: fn_case_immutable_fields
--
-- KATEGORI A — Immutable total setelah INSERT (tidak boleh
-- berubah dalam kondisi apapun, termasuk via fn_case_sync_handler):
--   title, description, track, student_id, created_by_user_id
--   (initiated_by_role sudah dijaga oleh trg_case_initiated_by_immutable)
--
-- KATEGORI B — Hanya boleh berubah via fn_case_sync_handler
-- (dicek via app.case_sync_active flag):
--   status, closed_at, closed_by_user_id,
--   locked_by_user_id, locked_at
--   (current_handler_role/is_locked sudah dijaga oleh
--    trg_case_guard_denormalized — tidak diulang di sini)
-- ============================================================

CREATE OR REPLACE FUNCTION fn_case_immutable_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- KATEGORI A: immutable total
    IF NEW.title              IS DISTINCT FROM OLD.title
    OR NEW.description        IS DISTINCT FROM OLD.description
    OR NEW.track              IS DISTINCT FROM OLD.track
    OR NEW.student_id         IS DISTINCT FROM OLD.student_id
    OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
    THEN
        RAISE EXCEPTION
            'domain_invariant_violation: fields (title, description, track, '
            'student_id, created_by_user_id) are immutable after case creation. '
            'case_id=%', OLD.case_id
            USING ERRCODE = 'P0001';
    END IF;

    -- KATEGORI B: hanya boleh berubah via fn_case_sync_handler
    IF (
        NEW.status               IS DISTINCT FROM OLD.status
        OR NEW.closed_at         IS DISTINCT FROM OLD.closed_at
        OR NEW.closed_by_user_id IS DISTINCT FROM OLD.closed_by_user_id
        OR NEW.locked_by_user_id IS DISTINCT FROM OLD.locked_by_user_id
        OR NEW.locked_at         IS DISTINCT FROM OLD.locked_at
    )
    AND current_setting('app.case_sync_active', TRUE) IS DISTINCT FROM 'true'
    THEN
        RAISE EXCEPTION
            'integrity_guard: fields (status, closed_at, closed_by_user_id, '
            'locked_by_user_id, locked_at) must only be modified via '
            'case_events INSERT (trigger trg_case_sync_handler). '
            'Direct UPDATE is not permitted. case_id=%', OLD.case_id
            USING ERRCODE = 'P0003';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_case_immutable_fields
    BEFORE UPDATE ON cases
    FOR EACH ROW
    EXECUTE FUNCTION fn_case_immutable_fields();
