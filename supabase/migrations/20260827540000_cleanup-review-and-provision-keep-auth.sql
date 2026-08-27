-- Hard-delete exactly 12 explicitly approved orphan Auth accounts.
--
-- Safety:
--   * every target is selected by literal auth.users UUID only;
--   * deletion aborts if public.users references any target;
--   * deletion aborts if public.students reaches any target through its user_id FK;
--   * first execution requires all 12 auth.users rows;
--   * a rerun after successful cleanup sees zero rows and is a no-op.

CREATE TEMP TABLE cleanup_auth_targets (
    auth_user_id uuid PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO cleanup_auth_targets (auth_user_id)
VALUES
    ('99b8db06-0ec0-47e3-b6d3-0fff47699efd'::uuid),
    ('99e54305-845c-42b8-8ff3-d2aee12f14ef'::uuid),
    ('28dc8237-0bf4-476b-b7ca-5eb854f6584c'::uuid),
    ('77a783b2-84d1-4a86-a1fb-b28dca4b24c4'::uuid),
    ('5b179772-fb33-4190-a613-4e0a706b8ccc'::uuid),
    ('cfe1a6f1-36ac-446c-a83e-7e184f342155'::uuid),
    ('85addd98-9ef9-4740-8ac9-170e984ace27'::uuid),
    ('63cb5bfc-58fb-4143-994d-8d9db4afba8c'::uuid),
    ('da1d6f8c-6d9c-411f-87db-8c48fc7a6a3d'::uuid),
    ('b0cbc953-180d-4804-aebc-f3911d2b4b5e'::uuid),
    ('9476bff6-8eaa-49d3-b8f9-e77061645214'::uuid),
    ('5ce4bb18-30ee-4323-b5d3-5e166acb7601'::uuid);

DO $migration$
DECLARE
    v_target_count integer;
    v_identities_deleted integer;
    v_users_deleted integer;
BEGIN
    -- Lock every existing explicit target until the transaction finishes.
    PERFORM 1
    FROM auth.users au
    JOIN cleanup_auth_targets target
      ON target.auth_user_id = au.id
    FOR UPDATE OF au;

    SELECT COUNT(*)
    INTO v_target_count
    FROM auth.users au
    JOIN cleanup_auth_targets target
      ON target.auth_user_id = au.id;

    IF v_target_count = 0 THEN
        RAISE NOTICE
            'Cleanup already applied: auth.identities deleted=0, auth.users deleted=0';
        RETURN;
    END IF;

    IF v_target_count IS DISTINCT FROM 12 THEN
        RAISE EXCEPTION
            'Cleanup aborted: expected exactly 12 explicit auth.users, found %',
            v_target_count
            USING ERRCODE = 'P0001';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.users u
        JOIN cleanup_auth_targets target
          ON target.auth_user_id = u.auth_user_id
    ) THEN
        RAISE EXCEPTION
            'Cleanup aborted: at least one of the 12 explicit Auth UUIDs has a public.users row'
            USING ERRCODE = 'P0001';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.students s
        JOIN public.users u
          ON u.user_id = s.user_id
        JOIN cleanup_auth_targets target
          ON target.auth_user_id = u.auth_user_id
    ) THEN
        RAISE EXCEPTION
            'Cleanup aborted: at least one of the 12 explicit Auth UUIDs is linked from public.students via students.user_id'
            USING ERRCODE = 'P0001';
    END IF;

    DELETE FROM auth.identities ai
    USING cleanup_auth_targets target
    WHERE ai.user_id = target.auth_user_id;

    GET DIAGNOSTICS v_identities_deleted = ROW_COUNT;

    DELETE FROM auth.users au
    USING cleanup_auth_targets target
    WHERE au.id = target.auth_user_id
      AND NOT EXISTS (
          SELECT 1
          FROM public.users u
          WHERE u.auth_user_id = au.id
      );

    GET DIAGNOSTICS v_users_deleted = ROW_COUNT;

    IF v_users_deleted IS DISTINCT FROM 12 THEN
        RAISE EXCEPTION
            'Cleanup aborted: expected to delete exactly 12 auth.users, deleted %',
            v_users_deleted
            USING ERRCODE = 'P0001';
    END IF;

    RAISE NOTICE
        'Cleanup complete: auth.identities deleted=%, auth.users deleted=%',
        v_identities_deleted,
        v_users_deleted;
END;
$migration$;
