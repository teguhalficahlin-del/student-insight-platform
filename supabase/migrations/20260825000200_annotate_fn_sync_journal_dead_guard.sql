CREATE OR REPLACE FUNCTION public.fn_sync_journal(
    p_idempotency_key text,
    p_journal_id uuid,
    p_owner_user_id uuid,
    p_entry_date date,
    p_content text,
    p_schedule_id uuid DEFAULT NULL::uuid,
    p_class_id uuid DEFAULT NULL::uuid
) RETURNS jsonb
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'public'
AS $function$
DECLARE
    v_school_id UUID;
BEGIN
    -- DEAD GUARD: auth.uid() selalu NULL saat dipanggil via service_role
    -- dari edge function sync-journal. Blok ini tidak pernah dieksekusi.
    -- Proteksi owner dilakukan di edge function (pre-check owner_user_id)
    -- dan di RLS policy rls_journals_owner (FOR ALL, USING + WITH CHECK).
    -- Jangan hapus blok ini — biarkan sebagai dokumentasi intent.
    IF auth.uid() IS NOT NULL
       AND fn_current_user_id() IS DISTINCT FROM p_owner_user_id THEN
        RAISE EXCEPTION 'akses ditolak: pemilik jurnal harus akun yang sedang login'
            USING ERRCODE = '42501';
    END IF;
    SELECT school_id INTO v_school_id
    FROM users
    WHERE user_id = p_owner_user_id;
    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'owner_not_found: user_id = %', p_owner_user_id
            USING ERRCODE = 'P0004';
    END IF;
    INSERT INTO teacher_journals (
        journal_id, owner_user_id, entry_date, content,
        schedule_id, class_id, school_id
    ) VALUES (
        p_journal_id, p_owner_user_id, p_entry_date, p_content,
        p_schedule_id, p_class_id, v_school_id
    )
    ON CONFLICT (journal_id) DO UPDATE SET
        entry_date = EXCLUDED.entry_date,
        content    = EXCLUDED.content,
        updated_at = NOW();
    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO sync_idempotency (
            idempotency_key, function_name, result_json, school_id
        ) VALUES (
            p_idempotency_key, 'sync-journal',
            jsonb_build_object('journal_id', p_journal_id),
            v_school_id
        )
        ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;
    RETURN jsonb_build_object('journal_id', p_journal_id);
END;
$function$;
