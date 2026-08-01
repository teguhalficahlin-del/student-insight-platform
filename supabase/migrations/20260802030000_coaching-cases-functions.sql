-- ============================================================
-- Migration: 20260802030000_coaching-cases-functions.sql
-- Coaching Cases — semua trigger functions, triggers,
-- helper fn_can_see_coaching_case, dan RPC fn_admin_delete_coaching_case.
-- Prerequisite: 20260802020000 (4 tabel + enum coaching cases).
-- Migration berikutnya: 20260802040000 (RLS policies).
-- ============================================================
--
-- CATATAN ADAPTASI audit_log:
-- Dokumen rancangan menggunakan kolom actor_user_id, action, target_type,
-- target_id, meta — kolom-kolom tersebut TIDAK ADA di audit_log existing.
-- fn_coaching_case_audit_delete diadaptasi ke schema yang ada:
--   (school_id, table_name, row_id, row_snapshot, deleted_by)
-- deletion_reason disimpan di dalam row_snapshot via jsonb merge (||).
-- ============================================================


-- ============================================================
-- TRIGGER FUNCTIONS
-- ============================================================

-- ── 1. Guard: coaching_case_events append-only ───────────────────────────────
-- Blokir UPDATE dan DELETE langsung ke coaching_case_events.
-- Tidak butuh SECURITY DEFINER — hanya RAISE EXCEPTION, tidak akses tabel lain.
CREATE OR REPLACE FUNCTION fn_coaching_case_events_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'coaching_case_events is append-only. DELETE and UPDATE are not permitted.'
        USING ERRCODE = 'P0003';
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_coaching_case_events_immutable ON coaching_case_events;
CREATE TRIGGER trg_coaching_case_events_immutable
    BEFORE UPDATE OR DELETE ON coaching_case_events
    FOR EACH ROW EXECUTE FUNCTION fn_coaching_case_events_immutable();


-- ── 2. Guard: blokir INSERT ke kasus yang sudah CLOSED ──────────────────────
-- BEFORE INSERT → berjalan sebelum trg_coaching_case_sync_handler (AFTER INSERT).
-- SECURITY DEFINER karena membaca coaching_cases yang di-RLS protect.
CREATE OR REPLACE FUNCTION fn_coaching_case_events_no_closed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM coaching_cases
        WHERE case_id = NEW.case_id AND status = 'CLOSED'
    ) THEN
        RAISE EXCEPTION 'case_closed: tidak bisa menambah event ke kasus yang sudah ditutup. case_id=%', NEW.case_id
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION fn_coaching_case_events_no_closed() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_coaching_case_events_no_closed() FROM anon;

DROP TRIGGER IF EXISTS trg_coaching_case_events_no_closed ON coaching_case_events;
CREATE TRIGGER trg_coaching_case_events_no_closed
    BEFORE INSERT ON coaching_case_events
    FOR EACH ROW EXECUTE FUNCTION fn_coaching_case_events_no_closed();


-- ── 3. Guard: blokir UPDATE langsung ke field terproteksi di coaching_cases ──
-- Field yang hanya boleh berubah via INSERT ke coaching_case_events (sync trigger):
--   current_handler_user_id, status, is_shared_to_student, is_shared_to_parent,
--   closed_at, closed_by_user_id
-- Guard dikecualikan saat app.coaching_sync_active = 'true' (diset oleh sync triggers).
-- NULL IS DISTINCT FROM 'true' = TRUE → guard aktif saat setting belum di-set.
CREATE OR REPLACE FUNCTION fn_coaching_case_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    IF current_setting('app.coaching_sync_active', TRUE) IS DISTINCT FROM 'true' THEN
        IF NEW.current_handler_user_id IS DISTINCT FROM OLD.current_handler_user_id
        OR NEW.status                  IS DISTINCT FROM OLD.status
        OR NEW.is_shared_to_student    IS DISTINCT FROM OLD.is_shared_to_student
        OR NEW.is_shared_to_parent     IS DISTINCT FROM OLD.is_shared_to_parent
        OR NEW.closed_at               IS DISTINCT FROM OLD.closed_at
        OR NEW.closed_by_user_id       IS DISTINCT FROM OLD.closed_by_user_id
        THEN
            RAISE EXCEPTION
                'integrity_guard: gunakan INSERT ke coaching_case_events untuk mengubah state kasus. '
                'Direct UPDATE tidak diizinkan. case_id=%', OLD.case_id
                USING ERRCODE = 'P0003';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION fn_coaching_case_guard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_coaching_case_guard() FROM anon;

DROP TRIGGER IF EXISTS trg_coaching_case_guard ON coaching_cases;
CREATE TRIGGER trg_coaching_case_guard
    BEFORE UPDATE ON coaching_cases
    FOR EACH ROW EXECUTE FUNCTION fn_coaching_case_guard();


-- ── 4. Guard: immutable fields — created_by_user_id, student_id, created_at, school_id ─
-- Tidak butuh SECURITY DEFINER — hanya membandingkan OLD vs NEW, tidak akses tabel lain.
CREATE OR REPLACE FUNCTION fn_coaching_case_immutable_creator()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
    OR NEW.student_id         IS DISTINCT FROM OLD.student_id
    OR NEW.created_at         IS DISTINCT FROM OLD.created_at
    OR NEW.school_id          IS DISTINCT FROM OLD.school_id
    THEN
        RAISE EXCEPTION
            'immutable_field: created_by_user_id, student_id, created_at, school_id '
            'tidak bisa diubah setelah kasus dibuat. case_id=%', OLD.case_id
            USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_coaching_case_immutable_creator ON coaching_cases;
CREATE TRIGGER trg_coaching_case_immutable_creator
    BEFORE UPDATE ON coaching_cases
    FOR EACH ROW EXECUTE FUNCTION fn_coaching_case_immutable_creator();


-- ── 5. Sync: auto-log OPENED + buat handler record pertama saat kasus dibuat ─
-- AFTER INSERT pada coaching_cases.
-- Menyalakan app.coaching_sync_active agar trg_coaching_case_guard tidak blokir
-- UPDATE yang akan dilakukan oleh trg_coaching_case_sync_handler.
-- trg_coaching_case_sync_handler mengabaikan event type OPENED → tidak infinite loop.
CREATE OR REPLACE FUNCTION fn_coaching_case_log_create()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    PERFORM set_config('app.coaching_sync_active', 'true', true);

    INSERT INTO coaching_case_events (
        case_id, school_id, event_type, author_user_id,
        is_visible_to_student, payload
    ) VALUES (
        NEW.case_id, NEW.school_id, 'OPENED', NEW.created_by_user_id,
        FALSE,
        jsonb_build_object('text', NEW.description)
    );

    INSERT INTO coaching_case_handlers (
        case_id, school_id, handler_user_id, assigned_by_user_id
    ) VALUES (
        NEW.case_id, NEW.school_id, NEW.created_by_user_id, NEW.created_by_user_id
    );

    PERFORM set_config('app.coaching_sync_active', 'false', true);
    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION fn_coaching_case_log_create() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_coaching_case_log_create() FROM anon;

DROP TRIGGER IF EXISTS trg_coaching_case_log_create ON coaching_cases;
CREATE TRIGGER trg_coaching_case_log_create
    AFTER INSERT ON coaching_cases
    FOR EACH ROW EXECUTE FUNCTION fn_coaching_case_log_create();


-- ── 6. Sync: sinkronkan state kasus setelah event baru ───────────────────────
-- AFTER INSERT pada coaching_case_events.
-- OPENED dan NOTE_ADDED diabaikan — tidak ada perubahan state yang perlu di-sync.
-- Set app.coaching_sync_active = 'true' agar trg_coaching_case_guard membiarkan
-- UPDATE state fields yang dilakukan fungsi ini.
CREATE OR REPLACE FUNCTION fn_coaching_case_sync_handler()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
        WHERE case_id = NEW.case_id
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
        WHERE case_id = NEW.case_id;

    ELSIF NEW.event_type = 'STATUS_CHANGED' THEN
        v_new_status := (NEW.payload->>'new_status')::case_status;
        UPDATE coaching_cases
        SET status     = v_new_status,
            updated_at = NOW()
        WHERE case_id = NEW.case_id;

    ELSIF NEW.event_type = 'CASE_EDITED' THEN
        UPDATE coaching_cases
        SET title       = COALESCE(NULLIF(NEW.payload->>'new_title', ''),       title),
            description = COALESCE(NULLIF(NEW.payload->>'new_description', ''), description),
            updated_at  = NOW()
        WHERE case_id = NEW.case_id;

    ELSIF NEW.event_type = 'SHARED_TO_STUDENT' THEN
        UPDATE coaching_cases SET is_shared_to_student = TRUE,  updated_at = NOW()
        WHERE case_id = NEW.case_id;

    ELSIF NEW.event_type = 'UNSHARED_FROM_STUDENT' THEN
        UPDATE coaching_cases SET is_shared_to_student = FALSE, updated_at = NOW()
        WHERE case_id = NEW.case_id;

    ELSIF NEW.event_type = 'SHARED_TO_PARENT' THEN
        UPDATE coaching_cases SET is_shared_to_parent = TRUE,  updated_at = NOW()
        WHERE case_id = NEW.case_id;

    ELSIF NEW.event_type = 'UNSHARED_FROM_PARENT' THEN
        UPDATE coaching_cases SET is_shared_to_parent = FALSE, updated_at = NOW()
        WHERE case_id = NEW.case_id;

    ELSIF NEW.event_type = 'CLOSED' THEN
        UPDATE coaching_cases
        SET status            = 'CLOSED',
            closed_at         = NOW(),
            closed_by_user_id = NEW.author_user_id,
            updated_at        = NOW()
        WHERE case_id = NEW.case_id;

    END IF;

    PERFORM set_config('app.coaching_sync_active', 'false', true);
    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION fn_coaching_case_sync_handler() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_coaching_case_sync_handler() FROM anon;

DROP TRIGGER IF EXISTS trg_coaching_case_sync_handler ON coaching_case_events;
CREATE TRIGGER trg_coaching_case_sync_handler
    AFTER INSERT ON coaching_case_events
    FOR EACH ROW EXECUTE FUNCTION fn_coaching_case_sync_handler();


-- ── 7. Audit: catat ke audit_log sebelum admin DELETE kasus ─────────────────
-- BEFORE DELETE pada coaching_cases.
-- ADAPTASI dari rancangan: audit_log schema existing tidak punya kolom
-- actor_user_id/action/target_type/target_id/meta. Menggunakan kolom yang ada:
--   school_id, table_name, row_id, row_snapshot, deleted_by
-- deletion_reason dan metadata lain di-merge ke dalam row_snapshot via JSONB ||.
CREATE OR REPLACE FUNCTION fn_coaching_case_audit_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    INSERT INTO audit_log (school_id, table_name, row_id, row_snapshot, deleted_by)
    VALUES (
        OLD.school_id,
        'coaching_cases',
        OLD.case_id::text,
        -- Seluruh baris lama + deletion_reason dari session setting
        to_jsonb(OLD) || jsonb_build_object(
            'deletion_reason', current_setting('app.coaching_delete_reason', TRUE)
        ),
        auth.uid()
    );
    RETURN OLD;
END;
$$;

REVOKE EXECUTE ON FUNCTION fn_coaching_case_audit_delete() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_coaching_case_audit_delete() FROM anon;

DROP TRIGGER IF EXISTS trg_coaching_case_audit_delete ON coaching_cases;
CREATE TRIGGER trg_coaching_case_audit_delete
    BEFORE DELETE ON coaching_cases
    FOR EACH ROW EXECUTE FUNCTION fn_coaching_case_audit_delete();


-- ============================================================
-- HELPER FUNCTION: fn_can_see_coaching_case
-- Predikat visibilitas untuk staf — dipakai di RLS coaching_cases.
-- Staf bisa lihat kasus jika:
--   (a) mereka pembuat kasus, ATAU
--   (b) mereka pernah/sedang menjadi handler, ATAU
--   (c) mereka ADMINISTRATIVE, ATAU
--   (d) mereka KEPSEK
-- ============================================================
CREATE OR REPLACE FUNCTION fn_can_see_coaching_case(p_case_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT EXISTS (
        SELECT 1 FROM coaching_cases c
        WHERE c.case_id   = p_case_id
          AND c.school_id = fn_current_school_id()
          AND (
              c.created_by_user_id = fn_current_user_id()
              OR EXISTS (
                  SELECT 1 FROM coaching_case_handlers h
                  WHERE h.case_id         = p_case_id
                    AND h.handler_user_id = fn_current_user_id()
              )
              OR fn_current_user_role() = 'ADMINISTRATIVE'::role_type
              OR fn_is_kepsek()
          )
    );
$$;

REVOKE EXECUTE ON FUNCTION fn_can_see_coaching_case(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_can_see_coaching_case(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION fn_can_see_coaching_case(uuid) TO authenticated;


-- ============================================================
-- RPC: fn_admin_delete_coaching_case
-- Satu-satunya jalur DELETE resmi untuk coaching_cases.
-- Menyimpan alasan sebelum DELETE mengaktifkan audit trigger.
-- Hanya ADMINISTRATIVE yang boleh memanggil ini.
-- ============================================================
CREATE OR REPLACE FUNCTION fn_admin_delete_coaching_case(
    p_case_id UUID,
    p_reason  TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    -- Validasi: hanya ADMINISTRATIVE
    IF fn_current_user_role() != 'ADMINISTRATIVE'::role_type THEN
        RAISE EXCEPTION 'permission_denied: hanya ADMINISTRATIVE yang dapat menghapus kasus'
            USING ERRCODE = 'P0001';
    END IF;

    -- Validasi: kasus ada di sekolah user
    IF NOT EXISTS (
        SELECT 1 FROM coaching_cases
        WHERE case_id = p_case_id AND school_id = fn_current_school_id()
    ) THEN
        RAISE EXCEPTION 'not_found: kasus tidak ditemukan di sekolah ini'
            USING ERRCODE = 'P0004';
    END IF;

    -- Validasi: alasan wajib diisi
    IF p_reason IS NULL OR trim(p_reason) = '' THEN
        RAISE EXCEPTION 'validation_error: alasan penghapusan wajib diisi'
            USING ERRCODE = 'P0001';
    END IF;

    -- Simpan alasan agar bisa diambil oleh fn_coaching_case_audit_delete trigger
    PERFORM set_config('app.coaching_delete_reason', p_reason, true);

    DELETE FROM coaching_cases WHERE case_id = p_case_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION fn_admin_delete_coaching_case(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_admin_delete_coaching_case(uuid, text) FROM anon;
GRANT  EXECUTE ON FUNCTION fn_admin_delete_coaching_case(uuid, text) TO authenticated;
GRANT  EXECUTE ON FUNCTION fn_admin_delete_coaching_case(uuid, text) TO service_role;
