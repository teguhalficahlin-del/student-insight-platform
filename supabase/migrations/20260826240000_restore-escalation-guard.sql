BEGIN;

-- ── Pulihkan kunci eskalasi coaching_case_events ─────────────
-- trg_case_validate_escalate hilang saat migrasi ke coaching_cases.
-- Guard baru bekerja pada payload aktual: {new_handler_user_id, note}.
-- Peran target di-resolve dari UUID, bukan dibaca dari string payload.
--
-- Aturan:
-- 1. new_handler_user_id wajib ada, valid UUID, dan user-nya di sekolah yang sama
-- 2. Peran target ∈ 8 peran internal yang sah
-- 3. Aktor DUDI hanya boleh eskalasi ke KAPRODI

-- Drop jika ada sisa dari sesi investigasi sebelumnya
DROP TRIGGER IF EXISTS trg_validate_escalation ON public.coaching_case_events;
DROP FUNCTION IF EXISTS public.fn_validate_escalation();

CREATE OR REPLACE FUNCTION public.fn_validate_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_new_handler_user_id uuid;
    v_target_role         role_type;
    v_actor_role          role_type;
    v_valid_targets CONSTANT role_type[] := ARRAY[
        'GURU'::role_type,
        'BK'::role_type,
        'WALI_KELAS'::role_type,
        'WAKA_KESISWAAN'::role_type,
        'WAKA_KURIKULUM'::role_type,
        'WAKA_HUMAS'::role_type,
        'KEPSEK'::role_type,
        'KAPRODI'::role_type
    ];
BEGIN
    -- Hanya aktif untuk event ESCALATED
    IF NEW.event_type <> 'ESCALATED' THEN
        RETURN NEW;
    END IF;

    -- Ambil dan validasi new_handler_user_id dari payload
    BEGIN
        v_new_handler_user_id := (NEW.payload->>'new_handler_user_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION
            'escalation_guard: payload.new_handler_user_id bukan UUID valid. case_id=%', NEW.case_id
            USING ERRCODE = 'P0001';
    END;

    IF v_new_handler_user_id IS NULL THEN
        RAISE EXCEPTION
            'escalation_guard: payload ESCALATED wajib menyertakan new_handler_user_id. case_id=%', NEW.case_id
            USING ERRCODE = 'P0001';
    END IF;

    -- Resolve peran target dari UUID + validasi di sekolah yang sama
    SELECT u.role_type INTO v_target_role
    FROM users u
    WHERE u.user_id   = v_new_handler_user_id
      AND u.school_id = NEW.school_id
      AND u.is_active = true
      AND u.deleted_at IS NULL;

    IF v_target_role IS NULL THEN
        RAISE EXCEPTION
            'escalation_guard: new_handler_user_id "%" tidak ditemukan sebagai user aktif di sekolah yang sama. case_id=%',
            v_new_handler_user_id, NEW.case_id
            USING ERRCODE = 'P0001';
    END IF;

    -- Validasi peran target ∈ 8 peran internal yang sah
    IF NOT (v_target_role = ANY(v_valid_targets)) THEN
        RAISE EXCEPTION
            'escalation_guard: peran target "%" bukan peran internal yang valid untuk eskalasi. '
            'Peran yang diizinkan: GURU, BK, WALI_KELAS, WAKA_KESISWAAN, WAKA_KURIKULUM, WAKA_HUMAS, KEPSEK, KAPRODI. case_id=%',
            v_target_role, NEW.case_id
            USING ERRCODE = 'P0001';
    END IF;

    -- Resolve peran aktor dari author_user_id
    SELECT u.role_type INTO v_actor_role
    FROM users u
    WHERE u.user_id = NEW.author_user_id;

    -- DUDI hanya boleh eskalasi ke KAPRODI
    IF v_actor_role = 'DUDI'::role_type
       AND v_target_role <> 'KAPRODI'::role_type THEN
        RAISE EXCEPTION
            'escalation_guard: DUDI hanya boleh eskalasi ke KAPRODI, bukan "%". case_id=%',
            v_target_role, NEW.case_id
            USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_validate_escalation() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_validate_escalation() FROM anon;
-- Trigger function tidak perlu GRANT EXECUTE ke authenticated/service_role
-- karena dipanggil oleh trigger infrastructure (superuser), bukan langsung oleh user

CREATE TRIGGER trg_validate_escalation
    BEFORE INSERT ON public.coaching_case_events
    FOR EACH ROW EXECUTE FUNCTION public.fn_validate_escalation();

COMMIT;
