-- ============================================================
-- Migration 20260710010000: fix cast enum di fn_sync_case (9-param)
--
-- BUG-1 (docs/audit-handoff.md §15): createCase gagal HTTP 500 dari edge
-- function sync-case. Root cause direproduksi live (SQLSTATE 42804):
-- versi 9-param fn_sync_case (mig 20260703260000) menyisipkan
-- p_initiated_by_role (text) ke kolom initiated_by_role &
-- current_handler_role (enum role_type) dan p_track (text) ke kolom
-- track (enum case_track) TANPA cast eksplisit. PostgreSQL tidak punya
-- implicit assignment cast text->enum, sehingga INSERT ditolak, RPC
-- raise, dan edge mengembalikan 500. Hanya p_audience yang sudah dicast
-- (::case_audience) dengan benar.
--
-- FIX: tambahkan cast eksplisit — ::role_type (2 tempat) dan
-- ::case_track. Tidak ada perubahan logika lain apapun.
--
-- Signature 9-param dipertahankan PERSIS SAMA seperti live (nama,
-- urutan, tipe tiap parameter identik). Overload 8-param yang lama
-- sudah di-drop di mig 20260705070000 dan TIDAK disentuh di sini.
--
-- CATATAN PRIVILEGE: CREATE OR REPLACE tidak mereset GRANT/REVOKE yang
-- sudah ada (grant EXECUTE ke authenticated & service_role tetap; anon
-- & PUBLIC tetap ter-revoke). Blok REVOKE/GRANT idempoten di bawah
-- menegaskan invariant Rule 2 (SECURITY DEFINER wajib REVOKE dua lapis)
-- — mempertahankan state yang sudah benar, bukan mengubahnya.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_sync_case(
    p_idempotency_key    TEXT,
    p_case_id            UUID,
    p_student_id         UUID,
    p_created_by_user_id UUID,
    p_initiated_by_role  TEXT,
    p_track              TEXT,
    p_title              TEXT,
    p_description        TEXT,
    p_audience           TEXT DEFAULT 'PRIVATE'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_school_id UUID;
BEGIN
    SELECT school_id INTO v_school_id
    FROM users
    WHERE user_id = p_created_by_user_id;

    IF v_school_id IS NULL THEN
        RAISE EXCEPTION 'author_not_found: user_id = %', p_created_by_user_id
            USING ERRCODE = 'P0004';
    END IF;

    INSERT INTO cases (
        case_id, student_id, created_by_user_id,
        initiated_by_role, current_handler_role,
        track, title, description, school_id, audience
    ) VALUES (
        p_case_id, p_student_id, p_created_by_user_id,
        p_initiated_by_role::role_type, p_initiated_by_role::role_type,
        p_track::case_track, p_title, p_description, v_school_id,
        p_audience::case_audience
    )
    ON CONFLICT (case_id) DO NOTHING;

    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO sync_idempotency (
            idempotency_key, function_name, result_json, school_id
        ) VALUES (
            p_idempotency_key, 'sync-case',
            jsonb_build_object('case_id', p_case_id),
            v_school_id
        )
        ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;

    RETURN jsonb_build_object('case_id', p_case_id);
END;
$$;

-- Rule 2 (SECURITY DEFINER): tegaskan anon & PUBLIC tidak boleh EXECUTE.
-- Idempoten — hanya mempertahankan invariant, tidak mengubah state yang
-- sudah benar. Signature 9-param dieja lengkap agar tidak menyentuh
-- overload lain.
REVOKE EXECUTE ON FUNCTION public.fn_sync_case(
    text, uuid, uuid, uuid, text, text, text, text, text
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_sync_case(
    text, uuid, uuid, uuid, text, text, text, text, text
) FROM anon;
GRANT EXECUTE ON FUNCTION public.fn_sync_case(
    text, uuid, uuid, uuid, text, text, text, text, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sync_case(
    text, uuid, uuid, uuid, text, text, text, text, text
) TO service_role;
