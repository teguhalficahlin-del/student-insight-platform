-- Orphan: tabel cases/case_events sudah di-drop di Sprint Forum-1 (commit 4717199).
-- fn_involved_in_case dan fn_is_case_subject_or_parent mereferensikan tabel yang tidak ada lagi.
-- Tidak ada RLS policy, view, atau fungsi lain yang mereferensikan keduanya.
DROP FUNCTION IF EXISTS fn_involved_in_case(uuid) CASCADE;
DROP FUNCTION IF EXISTS fn_is_case_subject_or_parent(uuid, uuid) CASCADE;

-- Verifikasi: harus 0 rows setelah DROP
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname IN ('fn_involved_in_case', 'fn_is_case_subject_or_parent')
  ) THEN
    RAISE EXCEPTION 'Orphan function masih ada setelah DROP — migration gagal';
  END IF;
END $$;
