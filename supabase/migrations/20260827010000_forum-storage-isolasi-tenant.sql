-- ============================================================
-- STORAGE-01 — Isolasi bucket forum-attachments per tenant
--
-- MASALAH:
--   forum_attachments_download (SELECT) hanya memfilter bucket_id,
--   tanpa guard school_id. Setiap user `authenticated` dari tenant
--   manapun bisa me-list seluruh isi bucket dan membuat signed URL
--   untuk lampiran milik sekolah lain.
--   forum_attachments_upload (INSERT) juga hanya memfilter bucket_id,
--   sehingga tenant A bisa menulis ke folder tenant B.
--   Hanya forum_attachments_delete (dipasang di migration
--   20260824120000) yang sudah punya guard yang benar.
--
-- BUKTI KONDISI SAAT INI (pg_policies, storage.objects):
--   forum_attachments_download | SELECT | USING (bucket_id = 'forum-attachments')
--   forum_attachments_upload   | INSERT | WITH CHECK (bucket_id = 'forum-attachments')
--   forum_attachments_delete   | DELETE | USING (bucket_id = 'forum-attachments'
--                                        AND (storage.foldername(name))[1]
--                                            = (fn_current_school_id())::text)
--
-- FIX:
--   Identikkan guard SELECT dan INSERT dengan policy DELETE.
--
-- DATA LEGACY:
--   Bucket forum-attachments saat ini KOSONG (0 objek di
--   storage.objects), jadi tidak ada file dengan pola path lama yang
--   perlu dimigrasi dan tidak ada lampiran existing yang jadi tak
--   terbaca setelah policy diperketat.
--
-- KLIEN:
--   Tidak ada perubahan file klien. Pola path yang sudah dipakai
--   guru/js/dashboard.js dan tu/js/portal.js adalah
--   `${school_id}/${Date.now()}.${ext}` — persis format yang dicek
--   oleh (storage.foldername(name))[1].
--
-- IDEMPOTENSI:
--   PostgreSQL tidak mengenal CREATE POLICY IF NOT EXISTS, jadi
--   dipakai pola DROP POLICY IF EXISTS + CREATE POLICY.
--
-- PRIVILEGE:
--   Tidak ada CREATE FUNCTION SECURITY DEFINER baru pada migration
--   ini, sehingga aturan GRANT + dua REVOKE (CLAUDE.md §6c) tidak
--   berlaku. Policy diberikan langsung TO authenticated; role anon
--   tidak disebut sehingga tetap tertutup default-deny.
-- ============================================================

BEGIN;

DROP POLICY IF EXISTS "forum_attachments_download" ON storage.objects;
DROP POLICY IF EXISTS "forum_attachments_upload"   ON storage.objects;

CREATE POLICY "forum_attachments_download"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'forum-attachments'
    AND (storage.foldername(name))[1] =
        public.fn_current_school_id()::text
  );

CREATE POLICY "forum_attachments_upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'forum-attachments'
    AND (storage.foldername(name))[1] =
        public.fn_current_school_id()::text
  );

COMMIT;
