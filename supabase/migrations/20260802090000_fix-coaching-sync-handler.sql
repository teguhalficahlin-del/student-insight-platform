-- Migration: 20260802090000_fix-coaching-sync-handler.sql
-- Tujuan: Tambah AND school_id = NEW.school_id ke semua WHERE clause
--         di fn_coaching_case_sync_handler (defense-in-depth tenant isolation).
--         Fungsi sudah menangani SHARED/UNSHARED events — ini hanya memperkuat WHERE.

CREATE OR REPLACE FUNCTION public.fn_coaching_case_sync_handler()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_new_handler_user_id UUID;
    v_new_status          case_status;
BEGIN
    -- OPENED dan NOTE_ADDED tidak mengubah state coaching_cases
    IF NEW.event_type IN ('NOTE_ADDED', 'OPENED') THEN
        RETURN NEW;
    END IF;

    PERFORM set_config('app.coaching_sync_active', 'true', true);

    IF NEW.event_type = 'ESCALATED' THEN
        v_new_handler_user_id := (NEW.payload->>'new_handler_user_id')::uuid;

        -- Tutup handler aktif sekarang
        UPDATE coaching_case_handlers
        SET handover_at = NOW()
        WHERE case_id   = NEW.case_id
          AND handover_at IS NULL;

        -- Buka handler baru
        INSERT INTO coaching_case_handlers (
            case_id, school_id, handler_user_id, assigned_by_user_id
        ) VALUES (
            NEW.case_id, NEW.school_id, v_new_handler_user_id, NEW.author_user_id
        );

        -- Update denormalized field di coaching_cases
        UPDATE coaching_cases
        SET current_handler_user_id = v_new_handler_user_id,
            updated_at              = NOW()
        WHERE case_id   = NEW.case_id
          AND school_id = NEW.school_id;

    ELSIF NEW.event_type = 'STATUS_CHANGED' THEN
        v_new_status := (NEW.payload->>'new_status')::case_status;
        UPDATE coaching_cases
        SET status     = v_new_status,
            updated_at = NOW()
        WHERE case_id   = NEW.case_id
          AND school_id = NEW.school_id;

    ELSIF NEW.event_type = 'CASE_EDITED' THEN
        UPDATE coaching_cases
        SET title       = COALESCE(NULLIF(NEW.payload->>'new_title', ''),       title),
            description = COALESCE(NULLIF(NEW.payload->>'new_description', ''), description),
            updated_at  = NOW()
        WHERE case_id   = NEW.case_id
          AND school_id = NEW.school_id;

    ELSIF NEW.event_type = 'SHARED_TO_STUDENT' THEN
        UPDATE coaching_cases
        SET is_shared_to_student = TRUE,
            updated_at           = NOW()
        WHERE case_id   = NEW.case_id
          AND school_id = NEW.school_id;

    ELSIF NEW.event_type = 'UNSHARED_FROM_STUDENT' THEN
        UPDATE coaching_cases
        SET is_shared_to_student = FALSE,
            updated_at           = NOW()
        WHERE case_id   = NEW.case_id
          AND school_id = NEW.school_id;

    ELSIF NEW.event_type = 'SHARED_TO_PARENT' THEN
        UPDATE coaching_cases
        SET is_shared_to_parent = TRUE,
            updated_at          = NOW()
        WHERE case_id   = NEW.case_id
          AND school_id = NEW.school_id;

    ELSIF NEW.event_type = 'UNSHARED_FROM_PARENT' THEN
        UPDATE coaching_cases
        SET is_shared_to_parent = FALSE,
            updated_at          = NOW()
        WHERE case_id   = NEW.case_id
          AND school_id = NEW.school_id;

    ELSIF NEW.event_type = 'CLOSED' THEN
        UPDATE coaching_cases
        SET status            = 'CLOSED',
            closed_at         = NOW(),
            closed_by_user_id = NEW.author_user_id,
            updated_at        = NOW()
        WHERE case_id   = NEW.case_id
          AND school_id = NEW.school_id;

    END IF;

    PERFORM set_config('app.coaching_sync_active', 'false', true);
    RETURN NEW;
END;
$function$;

-- GRANT/REVOKE: fungsi RETURNS trigger dipanggil oleh DB engine, bukan klien langsung.
-- Trigger function tidak memerlukan GRANT EXECUTE ke role — sudah implisit via trigger.
-- Tidak ada perubahan grant dari versi sebelumnya.
