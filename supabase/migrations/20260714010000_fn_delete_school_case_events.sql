-- ============================================================
-- fn_delete_school_case_events: hapus semua case_events sekolah
-- dengan menonaktifkan trigger immutable sementara.
-- Dipanggil oleh edge function delete-school via rpc().
-- trg_case_events_immutable memblokir DELETE langsung (append-only
-- by design), sehingga butuh SECURITY DEFINER agar DISABLE TRIGGER
-- berjalan sebagai postgres (pemilik tabel).
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_delete_school_case_events(p_school_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    ALTER TABLE case_events DISABLE TRIGGER trg_case_events_immutable;
    DELETE FROM case_events WHERE school_id = p_school_id;
    ALTER TABLE case_events ENABLE TRIGGER trg_case_events_immutable;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_delete_school_case_events(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_delete_school_case_events(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_delete_school_case_events(uuid) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_delete_school_case_events(uuid) TO service_role;
