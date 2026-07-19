-- SIP-019: Fix FK mismatch notifikasi kepsek di fn_waka_approve_doc
-- Fungsi lama mengambil auth_user_id kepsek lalu insert ke recipient_user_id
-- yang seharusnya FK ke public.users.user_id, bukan auth.users.id.

CREATE OR REPLACE FUNCTION public.fn_waka_approve_doc(
    p_doc_id  UUID,
    p_action  VARCHAR(10),
    p_catatan TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_school_id       UUID;
  v_new_status      VARCHAR(30);
  v_kepsek_user_id  UUID;
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
    SELECT u.user_id INTO v_kepsek_user_id
    FROM public.users u
    WHERE u.school_id = v_school_id
      AND u.is_kepsek = true
    LIMIT 1;

    IF v_kepsek_user_id IS NOT NULL THEN
      INSERT INTO public.notifications
        (recipient_user_id, school_id, type, title, body)
      VALUES (
        v_kepsek_user_id,
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
