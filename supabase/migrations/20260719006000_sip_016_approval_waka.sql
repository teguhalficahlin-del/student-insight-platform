-- SIP Sprint 2 — 016: Pindah approval Perangkat Ajar ke Waka Kurikulum
-- Ganti MENUNGGU_KEPSEK/DISAHKAN_KEPSEK → MENUNGGU_WAKA/DISAHKAN_WAKA
-- Fix race condition dengan unique constraint per (doc_id, status)

-- ─── 1. DROP constraint lama dulu ───────────────────────────
-- (harus DROP sebelum UPDATE agar nilai baru tidak ditolak constraint lama)
ALTER TABLE public.teacher_documents
  DROP CONSTRAINT IF EXISTS teacher_documents_status_check;

-- ─── 2. Migrate data existing ────────────────────────────────
UPDATE public.teacher_documents
  SET status = 'MENUNGGU_WAKA'
  WHERE status = 'MENUNGGU_KEPSEK';

UPDATE public.teacher_documents
  SET status = 'DISAHKAN_WAKA'
  WHERE status = 'DISAHKAN_KEPSEK';

-- ─── 3. ADD constraint baru ──────────────────────────────────
ALTER TABLE public.teacher_documents
  ADD CONSTRAINT teacher_documents_status_check
  CHECK (status IN (
    'AI_DRAFT',
    'DIREVIEW_GURU',
    'MENUNGGU_WAKA',
    'DISAHKAN_WAKA'
  ));

-- ─── 3. Fix race condition: unique per (doc_id, status) ──────
-- Hapus duplikat dulu (akibat double-click sebelum constraint ada)
-- Simpan 1 baris per (doc_id, status) berdasarkan approved_at terlama
DELETE FROM public.teacher_document_approvals
WHERE approval_id IN (
    SELECT approval_id FROM (
        SELECT approval_id,
               ROW_NUMBER() OVER (
                   PARTITION BY doc_id, status
                   ORDER BY approved_at
               ) AS rn
        FROM public.teacher_document_approvals
    ) sub WHERE rn > 1
);

ALTER TABLE public.teacher_document_approvals
  ADD CONSTRAINT unique_doc_approval
  UNIQUE (doc_id, status);

-- ─── 4. Fungsi approval baru untuk Waka Kurikulum ────────────
CREATE OR REPLACE FUNCTION public.fn_waka_approve_doc(
  p_doc_id  UUID,
  p_action  VARCHAR(10),
  p_catatan TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, core
AS $$
DECLARE
  v_school_id         UUID;
  v_new_status        VARCHAR(30);
  v_kepsek_auth_id    UUID;
BEGIN
  IF NOT public.fn_is_waka_kurikulum() THEN
    RAISE EXCEPTION 'Akses ditolak: hanya Waka Kurikulum';
  END IF;

  SELECT school_id INTO v_school_id
  FROM public.teacher_documents
  WHERE doc_id = p_doc_id
    AND school_id = public.fn_current_school_id()
    AND status = 'MENUNGGU_WAKA';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dokumen tidak ditemukan atau status tidak valid';
  END IF;

  IF p_action = 'APPROVE' THEN
    v_new_status := 'DISAHKAN_WAKA';
  ELSIF p_action = 'REJECT' THEN
    v_new_status := 'DIREVIEW_GURU';
  ELSE
    RAISE EXCEPTION 'Action tidak valid';
  END IF;

  UPDATE public.teacher_documents
  SET status = v_new_status, updated_at = now()
  WHERE doc_id = p_doc_id;

  INSERT INTO public.teacher_document_approvals
    (doc_id, school_id, approved_by, status, catatan)
  VALUES (
    p_doc_id,
    v_school_id,
    auth.uid(),
    CASE WHEN p_action = 'APPROVE' THEN 'APPROVED' ELSE 'REJECTED' END,
    p_catatan
  )
  ON CONFLICT (doc_id, status) DO NOTHING;

  -- Notifikasi ke Kepsek setelah disahkan
  IF p_action = 'APPROVE' THEN
    SELECT u.auth_user_id INTO v_kepsek_auth_id
    FROM public.users u
    WHERE u.school_id = v_school_id
      AND u.is_kepsek = true
    LIMIT 1;

    IF v_kepsek_auth_id IS NOT NULL THEN
      INSERT INTO public.notifications
        (recipient_user_id, school_id, type, title, body)
      VALUES (
        v_kepsek_auth_id,
        v_school_id,
        'PERANGKAT_AJAR',
        'Perangkat Ajar Disahkan',
        'Waka Kurikulum telah mengesahkan perangkat ajar.'
      )
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_waka_approve_doc(UUID, VARCHAR, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_waka_approve_doc(UUID, VARCHAR, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_waka_approve_doc(UUID, VARCHAR, TEXT) TO authenticated;

-- ─── 5. Hapus fungsi lama ─────────────────────────────────────
DROP FUNCTION IF EXISTS public.fn_kepsek_approve_doc(UUID, VARCHAR, TEXT);
