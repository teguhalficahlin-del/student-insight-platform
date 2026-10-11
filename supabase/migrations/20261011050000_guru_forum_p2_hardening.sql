-- Harden Forum Guru recipient scoping and attachment lifecycle.

-- Keep SEMUA_GURU behavior unchanged. When the caller supplies a program,
-- GURU_MAPEL is used by the Kaprodi picker and must stay within that program.
DO $$
DECLARE
    v_definition text;
    v_marker text := 'ELSIF p_target_group = ''GURU_MAPEL'' THEN';
    v_marker_pos integer;
    v_role_pos integer;
    v_old_clause text := 'AND u.role_type = ''GURU'';';
    v_new_clause text := 'AND u.role_type = ''GURU''
        AND (p_program_id IS NULL OR u.program_id = p_program_id);';
BEGIN
    SELECT pg_get_functiondef(p.oid)
      INTO v_definition
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'fn_get_forum_recipient_candidates'
       AND pg_get_function_identity_arguments(p.oid) =
           'p_target_group text, p_program_id uuid, p_class_id uuid, p_day_of_week smallint, p_academic_year text';

    IF v_definition IS NULL THEN
        RAISE EXCEPTION 'fn_get_forum_recipient_candidates tidak ditemukan';
    END IF;

    v_marker_pos := position(v_marker in v_definition);
    v_role_pos := position(v_old_clause in substring(v_definition from v_marker_pos));
    IF v_marker_pos = 0 OR v_role_pos = 0 THEN
        RAISE EXCEPTION 'Cabang GURU_MAPEL tidak ditemukan pada fn_get_forum_recipient_candidates';
    END IF;

    v_role_pos := v_marker_pos + v_role_pos - 1;
    v_definition := overlay(
        v_definition placing v_new_clause
        from v_role_pos for length(v_old_clause)
    );
    EXECUTE v_definition;
END $$;

-- An orphaned object must not remain downloadable merely because its owner_id
-- still matches the former author. Active post readability remains authoritative.
DROP POLICY IF EXISTS forum_attachments_download ON storage.objects;
CREATE POLICY forum_attachments_download
    ON storage.objects FOR SELECT TO authenticated
    USING (
        bucket_id = 'forum-attachments'
        AND (storage.foldername(name))[1] = (fn_current_school_id())::text
        AND (
            fn_forum_attachment_moderator()
            OR fn_forum_attachment_readable(name)
        )
    );
