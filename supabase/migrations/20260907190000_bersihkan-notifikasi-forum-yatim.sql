-- ============================================================
-- NOTIF-CLEAN-01 — Bersihkan notifikasi forum yang rujukannya kosong
--
-- MASALAH:
--   Migration 20260729040000 menghapus seluruh posting Forum Kelas.
--   FK notifications.forum_post_id bersifat ON DELETE SET NULL (bukan
--   CASCADE), sehingga notifikasinya tidak ikut terhapus — hanya
--   rujukannya yang dikosongkan. Teks notifikasi tetap tampil di
--   lonceng pengguna, menunjuk posting yang sudah tidak ada.
--
-- BUKTI KONDISI SAAT INI:
--   tipe               post_id  comment_id  jml  belum_dibaca  rentang
--   FORUM_POST_NEW     NULL     NULL        164  135           17-28 Jul 2026
--   FORUM_COMMENT_NEW  NULL     NULL         17   10           17-23 Jul 2026
--   Total 181 baris, 145 di antaranya belum dibaca sehingga masih
--   ikut dihitung pada badge lonceng. Seluruhnya milik 1 sekolah.
--
-- KRITERIA HAPUS (sengaja sempit):
--   Hanya tipe notifikasi forum, DAN forum_post_id NULL, DAN
--   forum_comment_id NULL — yaitu baris yang tidak menunjuk apa pun
--   sehingga tidak mungkin lagi dibuka penggunanya.
--   Tipe lain (LOGIN_NEW_DEVICE, CASE_BROADCAST, ESCALATION_DM,
--   LATE_ARRIVAL) memang wajar memiliki forum_post_id NULL dan TIDAK
--   disentuh.
--
-- KE DEPAN:
--   Sejak fn_delete_forum_post (migration 20260907170000), penghapusan
--   posting sudah membersihkan notifikasinya sendiri, jadi baris yatim
--   baru tidak akan terbentuk lagi lewat jalur itu. Migration ini
--   membereskan warisan yang sudah terlanjur ada.
--
-- IDEMPOTENSI:
--   DELETE dengan predikat; dijalankan ulang menghapus 0 baris.
--
-- VOLUME:
--   181 baris — jauh di bawah ambang EXPLAIN ANALYZE wajib (>1000)
--   dan statement_timeout 2 menit Supabase.
--
-- PRIVILEGE:
--   Tidak ada CREATE FUNCTION SECURITY DEFINER baru pada migration ini.
-- ============================================================

BEGIN;

DELETE FROM public.notifications
WHERE type::text IN ('FORUM_POST_NEW', 'FORUM_COMMENT_NEW')
  AND forum_post_id    IS NULL
  AND forum_comment_id IS NULL;

COMMIT;
