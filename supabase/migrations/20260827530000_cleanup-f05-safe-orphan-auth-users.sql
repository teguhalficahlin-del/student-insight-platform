-- F-05: hard-delete only the 2,031 approved orphan Auth accounts.
--
-- Approved SAFE TO DELETE criteria (all must remain true at execution time):
--   * no public.users row references auth.users.id
--   * auth.users.last_sign_in_at IS NULL
--   * email is not in the active 244e389c.siswa.internal domain
--   * email is not in the smk.sch.id review domain
--   * created before 2026-07-16 00:00:00+00
--
-- Idempotency:
--   * first execution requires exactly 2,031 targets and 2,031 identities;
--   * a rerun after successful cleanup sees zero targets and is a no-op;
--   * any other target count aborts the transaction.

CREATE TEMP TABLE f05_safe_orphan_auth_targets
ON COMMIT DROP
AS
SELECT au.id
FROM auth.users au
WHERE NOT EXISTS (
        SELECT 1
        FROM public.users u
        WHERE u.auth_user_id = au.id
      )
  AND au.last_sign_in_at IS NULL
  AND au.email NOT LIKE '%@244e389c.siswa.internal'
  AND au.email NOT LIKE '%@smk.sch.id'
  AND au.created_at < '2026-07-16 00:00:00+00'::timestamptz;

DO $migration$
DECLARE
    v_target_count integer;
    v_identity_target_count integer;
    v_identities_deleted integer;
    v_users_deleted integer;
BEGIN
    SELECT COUNT(*)
    INTO v_target_count
    FROM f05_safe_orphan_auth_targets;

    IF v_target_count = 0 THEN
        RAISE NOTICE
            'F-05 cleanup already applied: auth.identities deleted=0, auth.users deleted=0';
        RETURN;
    END IF;

    IF v_target_count IS DISTINCT FROM 2031 THEN
        RAISE EXCEPTION
            'F-05 cleanup aborted: expected exactly 2031 SAFE TO DELETE auth.users, found %',
            v_target_count
            USING ERRCODE = 'P0001';
    END IF;

    -- Lock the selected Auth rows until this transaction finishes.
    PERFORM 1
    FROM auth.users au
    JOIN f05_safe_orphan_auth_targets target ON target.id = au.id
    FOR UPDATE OF au;

    -- Defense-in-depth: none of the protected groups may enter the target set.
    IF EXISTS (
        SELECT 1
        FROM auth.users au
        JOIN f05_safe_orphan_auth_targets target ON target.id = au.id
        WHERE au.last_sign_in_at IS NOT NULL
           OR au.email LIKE '%@244e389c.siswa.internal'
           OR au.email LIKE '%@smk.sch.id'
           OR au.created_at >= '2026-07-16 00:00:00+00'::timestamptz
           OR EXISTS (
                SELECT 1
                FROM public.users u
                WHERE u.auth_user_id = au.id
           )
    ) THEN
        RAISE EXCEPTION
            'F-05 cleanup aborted: target set contains a KEEP/NEEDS REVIEW/non-orphan account'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT COUNT(*)
    INTO v_identity_target_count
    FROM auth.identities ai
    JOIN f05_safe_orphan_auth_targets target ON target.id = ai.user_id;

    IF v_identity_target_count IS DISTINCT FROM 2031 THEN
        RAISE EXCEPTION
            'F-05 cleanup aborted: expected exactly 2031 target auth.identities, found %',
            v_identity_target_count
            USING ERRCODE = 'P0001';
    END IF;

    DELETE FROM auth.identities ai
    USING f05_safe_orphan_auth_targets target
    WHERE ai.user_id = target.id;

    GET DIAGNOSTICS v_identities_deleted = ROW_COUNT;

    IF v_identities_deleted IS DISTINCT FROM 2031 THEN
        RAISE EXCEPTION
            'F-05 cleanup aborted: expected to delete 2031 auth.identities, deleted %',
            v_identities_deleted
            USING ERRCODE = 'P0001';
    END IF;

    DELETE FROM auth.users au
    USING f05_safe_orphan_auth_targets target
    WHERE au.id = target.id
      AND NOT EXISTS (
            SELECT 1
            FROM public.users u
            WHERE u.auth_user_id = au.id
          )
      AND au.last_sign_in_at IS NULL
      AND au.email NOT LIKE '%@244e389c.siswa.internal'
      AND au.email NOT LIKE '%@smk.sch.id'
      AND au.created_at < '2026-07-16 00:00:00+00'::timestamptz;

    GET DIAGNOSTICS v_users_deleted = ROW_COUNT;

    IF v_users_deleted IS DISTINCT FROM 2031 THEN
        RAISE EXCEPTION
            'F-05 cleanup aborted: expected to delete 2031 auth.users, deleted %',
            v_users_deleted
            USING ERRCODE = 'P0001';
    END IF;

    RAISE NOTICE
        'F-05 cleanup complete: auth.identities deleted=%, auth.users deleted=%',
        v_identities_deleted,
        v_users_deleted;
END;
$migration$;
