-- ============================================================
-- Migration 20260802070000: fn_sync_coaching_case
--
-- BUG PRODUKSI: tombol "Buat Kasus Baru" gagal total.
-- Root cause: mig 20260802060000_drop-old-cases.sql men-drop
-- fn_sync_case(text,uuid,uuid,uuid,text,text,text,text,text) tanpa
-- membuat penggantinya. Edge function sync-case masih memanggil RPC
-- itu → PostgREST error → internalError 500 untuk semua peran.
--
-- fn_sync_case lama TIDAK bisa di-restore apa adanya: body-nya
-- INSERT INTO cases, tabel yang ikut di-drop di migration yang sama.
-- Fungsi ini menulis ulang untuk schema coaching_cases (mig 20260802020000).
--
-- PEMETAAN SCHEMA LAMA → BARU
--   initiated_by_role    → dihapus (tidak ada kolomnya)
--   current_handler_role → current_handler_user_id UUID
--   audience             → is_shared_to_student + is_shared_to_parent
--
-- Parameter p_initiated_by_role dan p_audience TETAP DITERIMA supaya
-- edge function cukup berubah satu baris (nama RPC), tapi keduanya
-- DIABAIKAN di INSERT. Keduanya diberi DEFAULT dan diletakkan paling
-- akhir agar client yang tidak lagi mengirimnya tetap cocok dengan
-- signature. supabase-js rpc() memakai named parameter, jadi urutan
-- yang berbeda dari fungsi lama tidak berpengaruh ke pemanggil.
--
-- KOLOM NOT NULL YANG DIISI EKSPLISIT
--   current_handler_user_id = p_created_by_user_id (handler pertama = pembuat)
--   school_id               = school_id milik pembuat
-- Sisanya memakai default kolom: status 'OPEN', track 'SEKOLAH',
-- is_shared_to_student/parent FALSE, created_at/updated_at now().
--
-- CAST ENUM EKSPLISIT: p_track::case_track wajib. Pelajaran dari
-- mig 20260710010000 (SQLSTATE 42804) — PostgreSQL tidak punya
-- implicit assignment cast text→enum.
--
-- TRIGGER: trg_coaching_case_log_create (AFTER INSERT) otomatis mengisi
-- coaching_case_events (OPENED) dan coaching_case_handlers. TIDAK ada
-- INSERT manual ke kedua tabel itu dari sini — akan jadi duplikat.
-- trg_coaching_case_guard hanya BEFORE UPDATE, tidak mengganggu INSERT.
--
-- PRIVILEGE: service_role SAJA. Fungsi ini SECURITY DEFINER dan
-- p_created_by_user_id adalah parameter (bukan auth.uid()), sehingga
-- grant ke authenticated akan memungkinkan user login mana pun membuat
-- kasus atas nama orang lain, melewati ALLOWED_ROLES dan pemeriksaan
-- created_by_user_id di edge function. Satu-satunya pemanggil adalah
-- sync-case via getAdminClient() (service_role). Ini menegakkan kembali
-- niat yang dinyatakan mig 20260703270000.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_sync_coaching_case(
    p_idempotency_key    TEXT,
    p_case_id            UUID,
    p_student_id         UUID,
    p_created_by_user_id UUID,
    p_track              TEXT,
    p_title              TEXT,
    p_description        TEXT,
    p_initiated_by_role  TEXT DEFAULT NULL,      -- diterima, diabaikan (kolom dihapus)
    p_audience           TEXT DEFAULT 'PRIVATE'  -- diterima, diabaikan (kolom dihapus)
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

    INSERT INTO coaching_cases (
        case_id, school_id, student_id,
        created_by_user_id, current_handler_user_id,
        track, title, description
    ) VALUES (
        p_case_id, v_school_id, p_student_id,
        p_created_by_user_id, p_created_by_user_id,
        p_track::case_track, p_title, p_description
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

-- CLAUDE.md 6c: SECURITY DEFINER wajib GRANT ke role yang dituju +
-- REVOKE dua lapis. Di sini role yang dituju adalah service_role saja
-- (lihat catatan PRIVILEGE di header). REVOKE FROM PUBLIC tidak cukup —
-- Supabase memberi grant eksplisit ke anon yang tidak ikut tercabut.
GRANT  EXECUTE ON FUNCTION public.fn_sync_coaching_case(
    text, uuid, uuid, uuid, text, text, text, text, text
) TO service_role;

REVOKE EXECUTE ON FUNCTION public.fn_sync_coaching_case(
    text, uuid, uuid, uuid, text, text, text, text, text
) FROM anon;

REVOKE EXECUTE ON FUNCTION public.fn_sync_coaching_case(
    text, uuid, uuid, uuid, text, text, text, text, text
) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION public.fn_sync_coaching_case(
    text, uuid, uuid, uuid, text, text, text, text, text
) FROM authenticated;
