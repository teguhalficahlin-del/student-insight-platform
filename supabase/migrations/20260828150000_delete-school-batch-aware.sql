-- ============================================================
-- delete-school batch-aware helpers
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_delete_school_case_events(uuid);
DROP FUNCTION IF EXISTS public.fn_delete_school_coaching_case_events(uuid);
DROP FUNCTION IF EXISTS public.fn_delete_school_coaching_case_events(uuid, uuid, integer);

CREATE FUNCTION public.fn_delete_school_coaching_case_events(
    p_school_id uuid,
    p_after_event_id uuid DEFAULT NULL,
    p_limit integer DEFAULT 200
)
RETURNS TABLE(deleted integer, last_id uuid, has_more boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_event_ids uuid[];
    v_trigger_disabled boolean := false;
BEGIN
    IF p_limit < 1 OR p_limit > 200 THEN
        RAISE EXCEPTION 'p_limit must be between 1 and 200';
    END IF;

    SELECT array_agg(event_id ORDER BY event_id)
    INTO v_event_ids
    FROM (
        SELECT event_id
        FROM public.coaching_case_events
        WHERE school_id = p_school_id
          AND (p_after_event_id IS NULL OR event_id > p_after_event_id)
        ORDER BY event_id
        LIMIT p_limit
    ) AS picked;

    IF COALESCE(array_length(v_event_ids, 1), 0) = 0 THEN
        RETURN QUERY SELECT 0, p_after_event_id, false;
        RETURN;
    END IF;

    ALTER TABLE public.coaching_case_events
        DISABLE TRIGGER trg_coaching_case_events_immutable;
    v_trigger_disabled := true;

    DELETE FROM public.coaching_case_events
    WHERE event_id = ANY(v_event_ids);

    ALTER TABLE public.coaching_case_events
        ENABLE TRIGGER trg_coaching_case_events_immutable;
    v_trigger_disabled := false;

    RETURN QUERY
    SELECT
        array_length(v_event_ids, 1),
        v_event_ids[array_length(v_event_ids, 1)],
        EXISTS (
            SELECT 1
            FROM public.coaching_case_events
            WHERE school_id = p_school_id
              AND event_id > v_event_ids[array_length(v_event_ids, 1)]
        );
EXCEPTION
    WHEN OTHERS THEN
        IF v_trigger_disabled THEN
            ALTER TABLE public.coaching_case_events
                ENABLE TRIGGER trg_coaching_case_events_immutable;
        END IF;
        RAISE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_delete_school_coaching_case_events(uuid, uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_delete_school_coaching_case_events(uuid, uuid, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_delete_school_coaching_case_events(uuid, uuid, integer) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_delete_school_coaching_case_events(uuid, uuid, integer) TO service_role;
