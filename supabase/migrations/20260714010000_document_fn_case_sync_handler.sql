-- ============================================================
-- Migration 20260714010000: document fn_case_sync_handler +
--   fn_case_guard_denormalized
--
-- LATAR BELAKANG
-- Kedua fungsi + trigger ini sudah ada di live DB sejak sebelum
-- sejarah migration repo dimulai. Keduanya dirujuk oleh:
--   - 20250624000003_fix_cases_rls_and_guard.sql (fn_case_sync_handler,
--     trg_case_guard_denormalized)
--   - 20260701380000_trg_case_create_event.sql ("fn_case_sync_handler
--     tidak melakukan apa-apa untuk COMMENT_ADDED")
-- ...tapi tidak pernah di-CREATE di satu pun file migration.
--
-- RISIKO YANG DIPERBAIKI
-- Jika database di-reset atau di-clone murni dari migration files,
-- kedua trigger ini hilang. Akibatnya:
--   - INSERT ke case_events (eskalasi/ubah status/tutup) berhasil,
--     tapi cases.current_handler_role / cases.status TIDAK berubah.
--   - Seluruh state machine kasus beku secara senyap.
--
-- PENDEKATAN
-- Guard IF NOT EXISTS → NO-OP total di live DB yang sudah benar.
-- Hanya aktif saat fresh DB (trigger hilang). Rekonstruksi konservatif:
-- event types yang tidak dikenal → no-op (RETURN NEW), tidak merusak.
--
-- LOGIKA REKONSTRUKSI
-- Disimpulkan dari kode, migration lain, dan komentar:
--   COMMENT_ADDED          → no-op (dikonfirmasi mig 380000)
--   DECISION_ESCALATE      → update current_handler_role
--   STATUS_CHANGED         → update status
--   DECISION_CLOSE         → update status=CLOSED, closed_at, closed_by_user_id
--   FINAL_DECISION_MADE    → update status (seperti STATUS_CHANGED)
--   CASE_LOCKED            → update is_locked=true, locked_by_user_id, locked_at
--   CASE_UNLOCKED          → update is_locked=false, clear lock fields
--   Lainnya                → no-op
-- ============================================================

DO $outer$
BEGIN

-- ── 1. fn_case_guard_denormalized ─────────────────────────────
-- Mencegah UPDATE langsung pada current_handler_role dan is_locked
-- di luar jalur fn_case_sync_handler (cek via app.case_sync_active).
IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'fn_case_guard_denormalized'
) THEN
    EXECUTE $func$
        CREATE OR REPLACE FUNCTION public.fn_case_guard_denormalized()
        RETURNS TRIGGER
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path TO 'public'
        AS $body$
        BEGIN
            IF (
                NEW.current_handler_role IS DISTINCT FROM OLD.current_handler_role
                OR NEW.is_locked IS DISTINCT FROM OLD.is_locked
            )
            AND current_setting('app.case_sync_active', TRUE) IS DISTINCT FROM 'true'
            THEN
                RAISE EXCEPTION
                    'integrity_guard: current_handler_role and is_locked must only '
                    'be modified via case_events INSERT (trigger trg_case_sync_handler). '
                    'Direct UPDATE is not permitted. case_id=%', OLD.case_id
                    USING ERRCODE = 'P0003';
            END IF;
            RETURN NEW;
        END;
        $body$;
    $func$;

    RAISE NOTICE 'Created fn_case_guard_denormalized (was missing from migrations)';
END IF;

-- trigger untuk fn_case_guard_denormalized
IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'cases'
      AND t.tgname = 'trg_case_guard_denormalized'
) THEN
    EXECUTE $trig$
        CREATE TRIGGER trg_case_guard_denormalized
            BEFORE UPDATE ON cases
            FOR EACH ROW
            EXECUTE FUNCTION fn_case_guard_denormalized();
    $trig$;

    RAISE NOTICE 'Created trigger trg_case_guard_denormalized (was missing from migrations)';
END IF;


-- ── 2. fn_case_sync_handler ───────────────────────────────────
-- Trigger AFTER INSERT ON case_events: menyinkronkan state denormalisasi
-- di tabel cases (current_handler_role, status, closed_at, is_locked, dst)
-- setiap kali event baru diinsert.
IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'fn_case_sync_handler'
) THEN
    EXECUTE $func$
        CREATE OR REPLACE FUNCTION public.fn_case_sync_handler()
        RETURNS TRIGGER
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path TO 'public'
        AS $body$
        BEGIN
            -- COMMENT_ADDED, STUDENT_UPDATE_ADDED, PARENT_* → no state change
            IF NEW.event_type IN (
                'COMMENT_ADDED',
                'STUDENT_UPDATE_ADDED',
                'PARENT_MESSAGE_RECEIVED',
                'PARENT_MESSAGE_LINKED',
                'PARENT_REPLY_SENT'
            ) THEN
                RETURN NEW;
            END IF;

            -- Izinkan UPDATE melewati guard trigger (transaction-scoped)
            PERFORM set_config('app.case_sync_active', 'true', true);

            IF NEW.event_type = 'DECISION_ESCALATE' THEN
                UPDATE cases
                SET current_handler_role = NEW.new_handler_role
                WHERE case_id = NEW.case_id;

            ELSIF NEW.event_type IN ('STATUS_CHANGED', 'FINAL_DECISION_MADE') THEN
                UPDATE cases
                SET status = NEW.new_status
                WHERE case_id = NEW.case_id;

            ELSIF NEW.event_type = 'DECISION_CLOSE' THEN
                UPDATE cases
                SET status             = 'CLOSED',
                    closed_at          = NOW(),
                    closed_by_user_id  = NEW.author_user_id
                WHERE case_id = NEW.case_id;

            ELSIF NEW.event_type = 'CASE_LOCKED' THEN
                UPDATE cases
                SET is_locked          = true,
                    locked_by_user_id  = NEW.author_user_id,
                    locked_at          = NOW()
                WHERE case_id = NEW.case_id;

            ELSIF NEW.event_type = 'CASE_UNLOCKED' THEN
                UPDATE cases
                SET is_locked          = false,
                    locked_by_user_id  = NULL,
                    locked_at          = NULL
                WHERE case_id = NEW.case_id;

            -- Event type tidak dikenal → no-op (aman, tidak merusak state)
            END IF;

            PERFORM set_config('app.case_sync_active', 'false', true);

            RETURN NEW;
        END;
        $body$;
    $func$;

    RAISE NOTICE 'Created fn_case_sync_handler (was missing from migrations)';
END IF;

-- trigger untuk fn_case_sync_handler
IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'case_events'
      AND t.tgname = 'trg_case_sync_handler'
) THEN
    EXECUTE $trig$
        CREATE TRIGGER trg_case_sync_handler
            AFTER INSERT ON case_events
            FOR EACH ROW
            EXECUTE FUNCTION fn_case_sync_handler();
    $trig$;

    RAISE NOTICE 'Created trigger trg_case_sync_handler (was missing from migrations)';
END IF;

END $outer$;
