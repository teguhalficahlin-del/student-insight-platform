-- ============================================================
-- Migration 20260824120000: TU-04/TU-07 — DELETE policy untuk
--   bucket storage 'forum-attachments'
--
-- MASALAH (dari audit Freebuff):
--   tu/js/portal.js memanggil
--     supabase.storage.from('forum-attachments').remove([oldPath])
--   di dua tempat:
--     1. rollback orphan saat pembuatan posting gagal setelah
--        file terlanjur ter-upload;
--     2. penghapusan lampiran lama saat lampiran diganti (TU-07).
--
--   Keduanya SELALU gagal. Migration 20260729010000 hanya membuat
--   dua policy pada storage.objects:
--     forum_attachments_upload    → INSERT, WITH CHECK bucket_id
--     forum_attachments_download  → SELECT, USING      bucket_id
--   Tidak ada policy DELETE sama sekali, dan RLS bersifat
--   default-deny, sehingga setiap remove() ditolak. Kedua
--   pemanggilan itu fire-and-forget (.catch → console.warn),
--   jadi kegagalannya tidak pernah terlihat pengguna — file
--   menumpuk sebagai orphan permanen di bucket.
--
--   Terverifikasi pada DB remote sebelum migration ini ditulis:
--     SELECT policyname, cmd FROM pg_policies
--     WHERE schemaname='storage' AND tablename='objects';
--     → forum_attachments_download  SELECT
--       forum_attachments_upload    INSERT
--     (tidak ada baris DELETE)
--
-- SOLUSI:
--   Tambah policy DELETE untuk role authenticated, dibatasi pada
--   bucket 'forum-attachments' DAN folder pertama pada path harus
--   sama dengan school_id pemanggil. Path dibentuk di portal.js
--   sebagai `${school_id}/${Date.now()}.${ext}`, sehingga
--   (storage.foldername(name))[1] = school_id pemilik file.
--
--   Objek tanpa folder (nama tanpa '/') menghasilkan array kosong,
--   sehingga [1] bernilai NULL dan perbandingan gagal — file
--   semacam itu tetap tidak bisa dihapus (default-deny terjaga).
--
--   public.fn_current_school_id() ditulis fully-qualified: policy
--   ini hidup di schema storage, jadi jangan bergantung pada
--   search_path saat CREATE POLICY dieksekusi.
--
-- CATATAN — dua hal yang SENGAJA tidak diubah migration ini:
--   1. forum_attachments_download (SELECT) tidak dibatasi
--      school_id — setiap authenticated user dari sekolah manapun
--      bisa mengunduh objek di bucket ini bila mengetahui path-nya.
--      Sama untuk forum_attachments_upload (INSERT). Ini celah
--      lintas-tenant yang sudah ada sejak 20260729010000 dan
--      berada di luar scope perbaikan TU-04; perlu keputusan
--      terpisah karena mengubah policy SELECT berisiko memutus
--      akses lampiran yang sudah beredar.
--   2. Policy DELETE ini memberi izin per-sekolah, bukan
--      per-penulis: siapa pun yang authenticated di sekolah yang
--      sama bisa menghapus lampiran forum sekolah itu. Mengikat
--      ke kepemilikan posting menuntut lookup ke forum_posts dari
--      dalam USING, yang menurut aturan repo (CLAUDE.md §7) wajib
--      lewat fungsi SECURITY DEFINER terpisah — bukan EXISTS
--      mentah. Disepakati sebagai scope sprint lanjutan.
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

DROP POLICY IF EXISTS "forum_attachments_delete" ON storage.objects;

CREATE POLICY "forum_attachments_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'forum-attachments'
    AND (storage.foldername(name))[1] =
        public.fn_current_school_id()::text
  );

COMMIT;
