-- ============================================================
-- T1-07 lanjutan — rls_cc_update lepas dari GUC app.coaching_sync_active
--
-- LATAR:
--   Migration 20260827050000 memindahkan policy coaching dari GUC ke
--   pg_trigger_depth(), tapi hanya menempel sebagian di database ini.
--   Kondisi live sebelum migration ini (dibaca dari pg_policies):
--
--     rls_cch_insert  WITH CHECK ... AND pg_trigger_depth() > 0    <- sudah
--     rls_cch_update  USING      ... AND pg_trigger_depth() > 0    <- sudah
--     rls_cc_update   USING      ... AND current_setting(
--                                        'app.coaching_sync_active') = 'true'
--                                                                  <- TERTINGGAL
--
--   Karena sudah menempel sebagian, 20260827050000 TIDAK di-repair dan
--   TIDAK dijalankan ulang. Migration bertimestamp lebih tinggi ini yang
--   menyelesaikan sisanya.
--
-- MASALAH YANG DITUTUP:
--   app.coaching_sync_active adalah GUC biasa. Siapa pun yang login bisa
--   menyalakannya lewat set_config(), yang tersedia bebas via PostgREST.
--   Selama rls_cc_update masih membacanya, seorang authenticated user bisa:
--
--     SELECT set_config('app.coaching_sync_active','true',true);
--     UPDATE coaching_cases SET title = '...', description = '...';
--
--   title dan description TIDAK dijaga fn_coaching_case_guard (guard itu
--   hanya menutup current_handler_user_id, status, is_shared_to_student,
--   is_shared_to_parent, closed_at, closed_by_user_id). Jadi isi kasus BK
--   bisa ditulis ulang tanpa meninggalkan event CASE_EDITED — jejak audit
--   hilang. Itu lubang yang ditutup di sini.
--
-- KENAPA AMAN — DIVERIFIKASI, BUKAN DIASUMSIKAN:
--   pg_trigger_depth() > 0 selalu FALSE untuk statement yang datang
--   langsung dari klien, jadi policy ini menolak semua UPDATE langsung.
--   Jalur sah tidak terpengaruh karena ia tidak pernah lewat RLS sama
--   sekali. Dibuktikan dari katalog:
--
--     coaching_cases          pemilik=postgres  relforcerowsecurity=false
--     fn_coaching_case_sync_handler  SECURITY DEFINER, pemilik=postgres
--     rolbypassrls(postgres)  = true
--
--   Artinya UPDATE yang dijalankan fn_coaching_case_sync_handler berjalan
--   sebagai postgres, dan karena postgres pemilik tabel tanpa FORCE RLS
--   plus punya BYPASSRLS, RLS tidak dievaluasi untuk statement itu.
--   Cabang GUC di policy memang dead code bagi jalur sah — ia semata-mata
--   pintu yang bisa dibuka klien.
--
-- CAKUPAN: satu policy. Tidak ada objek lain yang disentuh.
--   - fn_coaching_case_guard SUDAH memakai pg_trigger_depth() <= 1 di
--     database ini; 'coaching_sync_active' hanya tersisa di komentarnya.
--     Tidak ada cabang GUC untuk dihapus, jadi fungsinya tidak diubah —
--     menulis ulang fungsi tanpa perubahan perilaku hanya menambah risiko.
--   - fn_coaching_case_log_create dan fn_coaching_case_sync_handler masih
--     memanggil set_config('app.coaching_sync_active', ...). Sesudah
--     migration ini tidak ada lagi PEMBACA GUC tersebut, sehingga panggilan
--     itu menjadi no-op tak berbahaya. Sengaja dibiarkan: keduanya di luar
--     cakupan, dan menyentuh fungsi trigger kasus BK tanpa kebutuhan nyata
--     bukan pertukaran risiko yang sepadan. Kandidat pembersihan kosmetik.
--
-- WITH CHECK TIDAK DIUBAH. Disalin apa adanya dari definisi live
--   (school_id = fn_current_school_id() AND
--    fn_student_in_current_school(student_id)) supaya migration ini murni
--   mengubah klausa USING dan tidak diam-diam menggeser aturan lain.
--
-- IDEMPOTENSI: DROP POLICY IF EXISTS + CREATE POLICY.
--   PostgreSQL tidak punya CREATE POLICY IF NOT EXISTS, dan
--   CREATE OR REPLACE POLICY juga tidak ada, jadi drop-lalu-create adalah
--   satu-satunya bentuk yang bisa dijalankan berulang. Aman karena berada
--   dalam satu transaksi — tidak ada jendela waktu tabel tanpa policy yang
--   terlihat oleh sesi lain.
-- ============================================================

BEGIN;

DROP POLICY IF EXISTS rls_cc_update ON public.coaching_cases;

CREATE POLICY rls_cc_update ON public.coaching_cases
    FOR UPDATE
    TO authenticated
    USING (
        school_id = fn_current_school_id()
        AND pg_trigger_depth() > 0
    )
    WITH CHECK (
        school_id = fn_current_school_id()
        AND fn_student_in_current_school(student_id)
    );

COMMIT;
