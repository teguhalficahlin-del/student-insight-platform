-- ============================================================
-- Migration 380000: Auto-log COMMENT_ADDED event saat kasus baru dibuat
--
-- Saat guru meng-INSERT ke `cases`, timeline masih kosong karena
-- tidak ada trigger yang log event pembuka. Migrasi ini menambahkan
-- trigger AFTER INSERT ON cases yang langsung menulis satu event
-- COMMENT_ADDED berisi deskripsi kasus sebagai catatan pembuka,
-- sehingga timeline tidak pernah kosong.
--
-- Menggunakan COMMENT_ADDED (bukan event type baru) agar:
-- 1. Kompatibel dengan trg_case_events_no_closed (CLOSED check tidak relevan saat kasus baru)
-- 2. fn_case_sync_handler tidak melakukan apa-apa untuk COMMENT_ADDED
-- 3. Tidak perlu enum value baru
-- ============================================================

CREATE OR REPLACE FUNCTION fn_case_log_create_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Tulis catatan pembuka sebagai COMMENT_ADDED atas nama pembuat kasus
    INSERT INTO case_events (
        case_id,
        event_type,
        author_user_id,
        author_role_at_time,
        privacy_level,
        payload
    ) VALUES (
        NEW.case_id,
        'COMMENT_ADDED',
        NEW.created_by_user_id,
        NEW.initiated_by_role,
        'INTERNAL_SCHOOL',
        jsonb_build_object('text', NEW.description, '_auto', true)
    );
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_case_log_create_event
    AFTER INSERT ON cases
    FOR EACH ROW
    EXECUTE FUNCTION fn_case_log_create_event();
