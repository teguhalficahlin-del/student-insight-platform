-- Tarik/pulihkan posting forum secara terotorisasi dan tenant-safe.
CREATE OR REPLACE FUNCTION public.fn_toggle_forum_post_withdrawn(
    p_post_id uuid,
    p_withdrawn boolean
)
RETURNS TABLE(post_id uuid, is_withdrawn boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_caller_id  uuid := public.fn_current_user_id();
    v_author_id  uuid;
    v_moderator  boolean := false;
BEGIN
    IF p_post_id IS NULL OR p_withdrawn IS NULL THEN
        RAISE EXCEPTION 'post_id dan status withdrawn wajib diisi.'
            USING ERRCODE = '22004';
    END IF;

    SELECT fp.author_user_id
    INTO v_author_id
    FROM public.forum_posts fp
    WHERE fp.post_id = p_post_id
      AND fp.school_id = public.fn_current_school_id()
      AND fp.deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Posting tidak ditemukan.'
            USING ERRCODE = 'P0002';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.users u
        WHERE u.user_id = v_caller_id
          AND u.school_id = public.fn_current_school_id()
          AND u.is_active = true
          AND u.deleted_at IS NULL
          AND (
              u.role_type IN ('KEPSEK', 'WAKA_KESISWAAN', 'ADMINISTRATIVE')
              OR u.is_kepsek = true
              OR u.is_waka_kesiswaan = true
          )
    ) INTO v_moderator;

    IF p_withdrawn THEN
        IF v_caller_id IS DISTINCT FROM v_author_id AND NOT v_moderator THEN
            RAISE EXCEPTION 'Akses ditolak: hanya penulis atau moderator yang dapat menarik posting.'
                USING ERRCODE = '42501';
        END IF;
    ELSIF NOT v_moderator THEN
        RAISE EXCEPTION 'Akses ditolak: hanya moderator yang dapat memulihkan posting.'
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    UPDATE public.forum_posts fp
    SET is_withdrawn = p_withdrawn,
        updated_at = now()
    WHERE fp.post_id = p_post_id
      AND fp.school_id = public.fn_current_school_id()
      AND fp.deleted_at IS NULL
    RETURNING fp.post_id, fp.is_withdrawn;
END;
$function$;

GRANT  EXECUTE ON FUNCTION public.fn_toggle_forum_post_withdrawn(uuid, boolean) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_toggle_forum_post_withdrawn(uuid, boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_toggle_forum_post_withdrawn(uuid, boolean) FROM PUBLIC;
