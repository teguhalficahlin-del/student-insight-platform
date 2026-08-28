-- ============================================================
-- Batch-aware student purge + durable Auth cleanup queue
-- ============================================================

CREATE TABLE IF NOT EXISTS public.pending_auth_deletions (
    queue_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id uuid NOT NULL REFERENCES public.schools(school_id) ON DELETE CASCADE,
    purge_student_id uuid NOT NULL,
    auth_user_id uuid NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz,
    last_error text
);

CREATE INDEX IF NOT EXISTS idx_pending_auth_deletions_purge
    ON public.pending_auth_deletions (school_id, purge_student_id, processed_at);

ALTER TABLE public.pending_auth_deletions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pending_auth_deletions FROM PUBLIC;
REVOKE ALL ON TABLE public.pending_auth_deletions FROM anon;
REVOKE ALL ON TABLE public.pending_auth_deletions FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pending_auth_deletions TO service_role;

DROP FUNCTION IF EXISTS public.fn_purge_expired_student(uuid, uuid);
DROP FUNCTION IF EXISTS public.fn_purge_expired_student(uuid, uuid, text, uuid, integer);

CREATE FUNCTION public.fn_purge_expired_student(
    p_student_id uuid,
    p_school_id uuid,
    p_last_table text DEFAULT NULL,
    p_last_id uuid DEFAULT NULL,
    p_batch_size integer DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_student record;
    v_cutoff timestamptz := now() - interval '6 months';
    v_tables constant text[] := ARRAY[
        'assessment_results', 'assessment_rubric_results',
        'forum_post_subjects',
        'grade_recap', 'student_grades', 'student_groups',
        'student_updates',
        'coaching_case_events', 'coaching_case_handlers', 'coaching_cases',
        'attendance', 'observations',
        'pkl_attendance', 'pkl_placements',
        'guru_wali_assignments', 'late_arrivals', 'student_exits',
        'class_enrollments',
        'forum_post_acknowledgements', 'forum_post_audience',
        'forum_post_comments', 'forum_posts',
        'notifications', 'login_devices',
        '__final'
    ];
    v_pk_columns constant text[] := ARRAY[
        'id', 'id', NULL,
        'id', 'id', 'id', 'update_id',
        'event_id', 'handler_id', 'case_id',
        'attendance_id', 'observation_id',
        'pkl_attendance_id', 'placement_id',
        'assignment_id', 'late_id', 'exit_id', 'enrollment_id',
        NULL, NULL, 'comment_id', 'post_id',
        'notification_id', 'device_id', NULL
    ];
    v_user_columns constant text[] := ARRAY[
        NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        NULL, NULL, 'author_user_id', 'author_user_id',
        'recipient_user_id', 'user_id', NULL
    ];
    v_stage integer;
    v_table text;
    v_pk text;
    v_user_column text;
    v_deleted integer := 0;
    v_last_id uuid;
    v_has_rows boolean := false;
    v_trigger_disabled boolean := false;
    v_purge_user_ids uuid[];
    v_student_user_id uuid;
    v_orphan_parent_ids uuid[];
BEGIN
    IF p_batch_size < 1 OR p_batch_size > 200 THEN
        RAISE EXCEPTION 'p_batch_size harus antara 1 dan 200';
    END IF;

    -- Edge function lama hanya mengirim dua argumen. Tolak aman agar deployment
    -- migration-before-edge tidak pernah dianggap sebagai purge yang selesai.
    IF p_last_table IS NULL THEN
        RAISE EXCEPTION 'p_last_table wajib untuk mode batch-aware';
    END IF;

    v_stage := array_position(v_tables, p_last_table);
    IF v_stage IS NULL THEN
        RAISE EXCEPTION 'p_last_table tidak valid: %', p_last_table;
    END IF;

    SELECT student_id, full_name, student_status, graduated_at, keluar_at, user_id
    INTO v_student
    FROM public.students
    WHERE student_id = p_student_id AND school_id = p_school_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'deleted', 0, 'has_more', false,
            'last_table', '__final', 'last_id', NULL
        );
    END IF;

    IF v_student.student_status NOT IN ('LULUS', 'KELUAR') THEN
        RAISE EXCEPTION 'Siswa "%" masih berstatus %. Hanya LULUS/KELUAR yang bisa dihapus.',
            v_student.full_name, v_student.student_status;
    END IF;
    IF v_student.student_status = 'LULUS'
       AND (v_student.graduated_at IS NULL OR v_student.graduated_at > v_cutoff) THEN
        RAISE EXCEPTION 'Siswa "%" belum melewati retensi 6 bulan.', v_student.full_name;
    END IF;
    IF v_student.student_status = 'KELUAR'
       AND (v_student.keluar_at IS NULL OR v_student.keluar_at > v_cutoff) THEN
        RAISE EXCEPTION 'Siswa "%" belum melewati retensi 6 bulan.', v_student.full_name;
    END IF;

    v_student_user_id := v_student.user_id;
    SELECT array_agg(DISTINCT candidate.user_id)
    INTO v_purge_user_ids
    FROM (
        SELECT v_student_user_id AS user_id
        WHERE v_student_user_id IS NOT NULL
        UNION ALL
        SELECT sp.parent_user_id
        FROM public.student_parents sp
        WHERE sp.student_id = p_student_id
          AND sp.school_id = p_school_id
          AND NOT EXISTS (
              SELECT 1 FROM public.student_parents other
              WHERE other.parent_user_id = sp.parent_user_id
                AND other.student_id <> p_student_id
          )
    ) candidate;

    v_table := v_tables[v_stage];
    v_pk := v_pk_columns[v_stage];
    v_user_column := v_user_columns[v_stage];

    IF v_table IN ('forum_post_subjects', 'forum_post_acknowledgements', 'forum_post_audience') THEN
        IF v_table = 'forum_post_subjects' THEN
            WITH picked AS (
                SELECT post_id, student_id
                FROM public.forum_post_subjects
                WHERE student_id = p_student_id AND school_id = p_school_id
                ORDER BY post_id, student_id LIMIT p_batch_size
            ), deleted_rows AS (
                DELETE FROM public.forum_post_subjects target USING picked p
                WHERE target.post_id = p.post_id AND target.student_id = p.student_id
                RETURNING 1
            ) SELECT count(*)::integer INTO v_deleted FROM deleted_rows;
            SELECT EXISTS (SELECT 1 FROM public.forum_post_subjects
                WHERE student_id = p_student_id AND school_id = p_school_id) INTO v_has_rows;
        ELSIF v_table = 'forum_post_acknowledgements' THEN
            WITH picked AS (
                SELECT post_id, user_id FROM public.forum_post_acknowledgements
                WHERE user_id = ANY(COALESCE(v_purge_user_ids, ARRAY[]::uuid[]))
                  AND school_id = p_school_id
                ORDER BY post_id, user_id LIMIT p_batch_size
            ), deleted_rows AS (
                DELETE FROM public.forum_post_acknowledgements target USING picked p
                WHERE target.post_id = p.post_id AND target.user_id = p.user_id
                RETURNING 1
            ) SELECT count(*)::integer INTO v_deleted FROM deleted_rows;
            SELECT EXISTS (SELECT 1 FROM public.forum_post_acknowledgements
                WHERE user_id = ANY(COALESCE(v_purge_user_ids, ARRAY[]::uuid[]))
                  AND school_id = p_school_id) INTO v_has_rows;
        ELSE
            WITH picked AS (
                SELECT post_id, user_id FROM public.forum_post_audience
                WHERE user_id = ANY(COALESCE(v_purge_user_ids, ARRAY[]::uuid[]))
                  AND school_id = p_school_id
                ORDER BY post_id, user_id LIMIT p_batch_size
            ), deleted_rows AS (
                DELETE FROM public.forum_post_audience target USING picked p
                WHERE target.post_id = p.post_id AND target.user_id = p.user_id
                RETURNING 1
            ) SELECT count(*)::integer INTO v_deleted FROM deleted_rows;
            SELECT EXISTS (SELECT 1 FROM public.forum_post_audience
                WHERE user_id = ANY(COALESCE(v_purge_user_ids, ARRAY[]::uuid[]))
                  AND school_id = p_school_id) INTO v_has_rows;
        END IF;

        IF v_has_rows THEN
            RETURN jsonb_build_object('deleted', v_deleted, 'has_more', true,
                'last_table', v_table, 'last_id', NULL);
        END IF;

    ELSIF v_table IN ('student_updates', 'coaching_case_events', 'coaching_case_handlers') THEN
        IF v_table = 'coaching_case_events' THEN
            ALTER TABLE public.coaching_case_events DISABLE TRIGGER trg_coaching_case_events_immutable;
            v_trigger_disabled := true;
        END IF;

        EXECUTE format(
            'WITH picked AS (
                SELECT target.%1$I FROM public.%2$I target
                WHERE target.school_id = $2
                  AND target.case_id IN (
                      SELECT case_id FROM public.coaching_cases
                      WHERE student_id = $1 AND school_id = $2
                  )
                  AND ($3 IS NULL OR target.%1$I > $3)
                ORDER BY target.%1$I LIMIT $4
             ), deleted_rows AS (
                DELETE FROM public.%2$I target USING picked p
                WHERE target.%1$I = p.%1$I RETURNING target.%1$I
             )
             SELECT count(*)::integer,
                    (SELECT %1$I FROM picked ORDER BY %1$I DESC LIMIT 1)
             FROM deleted_rows', v_pk, v_table
        ) INTO v_deleted, v_last_id
        USING p_student_id, p_school_id, p_last_id, p_batch_size;

        IF v_table = 'coaching_case_events' THEN
            ALTER TABLE public.coaching_case_events ENABLE TRIGGER trg_coaching_case_events_immutable;
            v_trigger_disabled := false;
        END IF;

        IF v_last_id IS NOT NULL THEN
            EXECUTE format(
                'SELECT EXISTS (
                    SELECT 1 FROM public.%1$I target
                    WHERE target.school_id = $2
                      AND target.case_id IN (
                          SELECT case_id FROM public.coaching_cases
                          WHERE student_id = $1 AND school_id = $2
                      ) AND target.%2$I > $3
                )', v_table, v_pk
            ) INTO v_has_rows USING p_student_id, p_school_id, v_last_id;
        END IF;

        IF v_has_rows THEN
            RETURN jsonb_build_object('deleted', v_deleted, 'has_more', true,
                'last_table', v_table, 'last_id', v_last_id);
        END IF;

    ELSIF v_table = '__final' THEN
        INSERT INTO public.pending_auth_deletions
            (school_id, purge_student_id, auth_user_id)
        SELECT p_school_id, p_student_id, u.auth_user_id
        FROM public.users u
        WHERE u.user_id = ANY(COALESCE(v_purge_user_ids, ARRAY[]::uuid[]))
          AND u.school_id = p_school_id
          AND u.auth_user_id IS NOT NULL
        ON CONFLICT (auth_user_id) DO UPDATE SET
            school_id = EXCLUDED.school_id,
            purge_student_id = EXCLUDED.purge_student_id,
            processed_at = NULL,
            last_error = NULL;

        SELECT array_agg(sp.parent_user_id)
        INTO v_orphan_parent_ids
        FROM public.student_parents sp
        WHERE sp.student_id = p_student_id
          AND sp.school_id = p_school_id
          AND sp.parent_user_id = ANY(COALESCE(v_purge_user_ids, ARRAY[]::uuid[]));

        DELETE FROM public.student_parents
        WHERE student_id = p_student_id AND school_id = p_school_id;
        GET DIAGNOSTICS v_deleted = ROW_COUNT;

        IF v_student_user_id IS NOT NULL THEN
            DELETE FROM public.users
            WHERE user_id = v_student_user_id AND school_id = p_school_id;
            v_deleted := v_deleted + CASE WHEN FOUND THEN 1 ELSE 0 END;
        END IF;

        DELETE FROM public.students
        WHERE student_id = p_student_id AND school_id = p_school_id;
        v_deleted := v_deleted + CASE WHEN FOUND THEN 1 ELSE 0 END;

        IF COALESCE(array_length(v_orphan_parent_ids, 1), 0) > 0 THEN
            WITH deleted_parents AS (
                DELETE FROM public.users
                WHERE user_id = ANY(v_orphan_parent_ids)
                  AND school_id = p_school_id
                RETURNING 1
            )
            SELECT v_deleted + count(*)::integer INTO v_deleted FROM deleted_parents;
        END IF;

        RETURN jsonb_build_object('deleted', v_deleted, 'has_more', false,
            'last_table', '__final', 'last_id', NULL);

    ELSE
        IF v_user_column IS NULL THEN
            EXECUTE format(
                'WITH picked AS (
                    SELECT %1$I FROM public.%2$I
                    WHERE student_id = $1 AND school_id = $2
                      AND ($3 IS NULL OR %1$I > $3)
                    ORDER BY %1$I LIMIT $4
                 ), deleted_rows AS (
                    DELETE FROM public.%2$I target USING picked p
                    WHERE target.%1$I = p.%1$I RETURNING target.%1$I
                 )
                 SELECT count(*)::integer,
                        (SELECT %1$I FROM picked ORDER BY %1$I DESC LIMIT 1)
                 FROM deleted_rows', v_pk, v_table
            ) INTO v_deleted, v_last_id
            USING p_student_id, p_school_id, p_last_id, p_batch_size;

            IF v_last_id IS NOT NULL THEN
                EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%1$I
                    WHERE student_id = $1 AND school_id = $2 AND %2$I > $3)', v_table, v_pk)
                INTO v_has_rows USING p_student_id, p_school_id, v_last_id;
            END IF;
        ELSE
            EXECUTE format(
                'WITH picked AS (
                    SELECT %1$I FROM public.%2$I
                    WHERE %3$I = ANY($1) AND school_id = $2
                      AND ($3 IS NULL OR %1$I > $3)
                    ORDER BY %1$I LIMIT $4
                 ), deleted_rows AS (
                    DELETE FROM public.%2$I target USING picked p
                    WHERE target.%1$I = p.%1$I RETURNING target.%1$I
                 )
                 SELECT count(*)::integer,
                        (SELECT %1$I FROM picked ORDER BY %1$I DESC LIMIT 1)
                 FROM deleted_rows', v_pk, v_table, v_user_column
            ) INTO v_deleted, v_last_id
            USING COALESCE(v_purge_user_ids, ARRAY[]::uuid[]), p_school_id, p_last_id, p_batch_size;

            IF v_last_id IS NOT NULL THEN
                EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%1$I
                    WHERE %2$I = ANY($1) AND school_id = $2 AND %3$I > $3)',
                    v_table, v_user_column, v_pk)
                INTO v_has_rows USING COALESCE(v_purge_user_ids, ARRAY[]::uuid[]), p_school_id, v_last_id;
            END IF;
        END IF;

        IF v_has_rows THEN
            RETURN jsonb_build_object('deleted', v_deleted, 'has_more', true,
                'last_table', v_table, 'last_id', v_last_id);
        END IF;
    END IF;

    RETURN jsonb_build_object('deleted', v_deleted, 'has_more', true,
        'last_table', v_tables[v_stage + 1], 'last_id', NULL);
EXCEPTION
    WHEN OTHERS THEN
        IF v_trigger_disabled THEN
            ALTER TABLE public.coaching_case_events ENABLE TRIGGER trg_coaching_case_events_immutable;
        END IF;
        RAISE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_purge_expired_student(uuid, uuid, text, uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_purge_expired_student(uuid, uuid, text, uuid, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_purge_expired_student(uuid, uuid, text, uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_purge_expired_student(uuid, uuid, text, uuid, integer) TO service_role;
