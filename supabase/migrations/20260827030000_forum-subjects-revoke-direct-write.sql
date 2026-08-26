-- ============================================================
-- RLS-02 — Cabut direct write pada forum_post_subjects
--
-- MASALAH:
--   Policy rls_forum_subj_write adalah FOR ALL dengan syarat tunggal
--   school_id = fn_current_school_id(), dan role `authenticated`
--   memegang INSERT/UPDATE/DELETE penuh di level tabel. Artinya user
--   manapun di sekolah tersebut bisa menyisipkan atau menghapus baris
--   forum_post_subjects milik posting orang lain.
--
--   Ini bukan sekadar masalah integritas data, melainkan ESKALASI
--   BACA: fn_can_read_forum_post menentukan akses lewat tabel ini —
--     cabang 6 (Guru Wali): akses bila ada baris forum_post_subjects
--                           yang student_id-nya tanggungan si guru;
--     cabang 7 (BK)       : akses bila posting punya minimal satu
--                           subjek siswa.
--   Menambah baris = memberi diri sendiri (atau orang lain) akses
--   baca ke posting yang seharusnya tertutup.
--
-- BUKTI KONDISI SAAT INI:
--   pg_policies:
--     rls_forum_subj_write | ALL    | USING (school_id = fn_current_school_id())
--                                   | WITH CHECK (school_id = fn_current_school_id())
--     rls_forum_subj_read  | SELECT | USING (school_id = fn_current_school_id()
--                                            AND fn_can_read_forum_post(post_id))
--   role_table_grants: authenticated memegang
--     SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE
--
-- GATE INVESTIGASI (sudah dijalankan, LULUS):
--   Satu-satunya fungsi lain di schema public yang menyebut
--   forum_post_subjects adalah fn_can_read_forum_post
--   (prosecdef = true, provolatile = 's', hanya MEMBACA).
--   Tidak ada penulis non-SECURITY-DEFINER, sehingga mencabut
--   privilege write tidak memutus jalur manapun.
--
-- KLIEN:
--   Nol perubahan. Grep `forum_post_subjects` pada seluruh *.js dan
--   *.html tidak menemukan satu pun referensi — penulisan hanya
--   terjadi di dalam fn_create_forum_post (SECURITY DEFINER), yang
--   berjalan sebagai owner sehingga melewati RLS maupun privilege
--   tabel milik `authenticated`.
--
-- FIX:
--   Drop policy write, lalu cabut INSERT/UPDATE/DELETE dari
--   `authenticated` sebagai lapis kedua (defense-in-depth): policy
--   yang hilang saja sudah default-deny, tapi REVOKE memastikan
--   penambahan policy baru yang ceroboh di kemudian hari tidak
--   otomatis membuka kembali jalur tulis.
--   Policy baca rls_forum_subj_read DIBIARKAN UTUH.
--
-- IDEMPOTENSI:
--   DROP POLICY IF EXISTS dan REVOKE keduanya aman dijalankan ulang.
--
-- PRIVILEGE:
--   Tidak ada CREATE FUNCTION SECURITY DEFINER baru pada migration
--   ini, sehingga aturan GRANT + dua REVOKE (CLAUDE.md §6c) tidak
--   berlaku. Role anon tidak pernah punya grant di tabel ini.
-- ============================================================

BEGIN;

DROP POLICY IF EXISTS rls_forum_subj_write ON public.forum_post_subjects;

REVOKE INSERT, UPDATE, DELETE
    ON public.forum_post_subjects
    FROM authenticated;

COMMIT;
