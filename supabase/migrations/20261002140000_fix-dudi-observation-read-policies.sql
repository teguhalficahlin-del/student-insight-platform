-- ============================================================
-- Migration: 20261002140000_fix-dudi-observation-read-policies.sql
--
-- TEMUAN AUDIT CODEX #4 (TINGGI) — catatan DUDI tak terbaca siapa pun.
--   DUDI menyimpan observasi dengan visibility='RESTRICTED' (dipaksa oleh
--   policy INSERT rls_observations_insert_dudi, DUD-01). Tapi SETELAH
--   model audience lama dibuang (observation_audience_members di-drop),
--   TIDAK ADA satu pun policy SELECT yang melayani visibility='RESTRICTED'.
--   Hasil: catatan tersimpan tapi tidak terbaca oleh siapa pun — siswa,
--   ortu, kaprodi, maupun waka humas.
--
--   Diverifikasi 2 Okt 2026 dari pg_policies: hanya ada read_guru (penulis),
--   read_student (SISWA_SAJA/SISWA_DAN_ORTU), read_parent (ORTU_SAJA/
--   SISWA_DAN_ORTU). Tidak ada yang menyebut RESTRICTED.
--
-- FIX (opsi B, disetujui Romo): pertahankan visibility='RESTRICTED',
--   tambah 3 policy SELECT yang melayaninya. Penerima = niat asli kode
--   DUDI lama: siswa ybs, orang tuanya, dan pengawas PKL (kaprodi +
--   waka humas).
--
-- PRIVASI — cakupan sempit by design:
--   Hanya catatan ber-visibility RESTRICTED yang terbuka, dan HANYA DUDI
--   yang bisa membuat observasi RESTRICTED (policy INSERT memaksanya).
--   Jadi policy kaprodi/waka humas di bawah TIDAK membuka observasi guru
--   biasa (yang memakai SISWA_SAJA/SISWA_DAN_ORTU/ORTU_SAJA) — hanya
--   catatan PKL dari DUDI.
--
-- Gaya policy (EXISTS ke students/student_parents, is_void=false,
-- fn_current_user_role) sengaja menyamai policy read_student/read_parent
-- yang sudah ada di tabel ini, demi konsistensi.
--
-- Idempoten: DROP POLICY IF EXISTS sebelum CREATE.
-- ============================================================

-- 1. Siswa membaca catatan DUDI (RESTRICTED) tentang dirinya sendiri
DROP POLICY IF EXISTS rls_observations_read_student_restricted ON observations;
CREATE POLICY rls_observations_read_student_restricted ON observations FOR SELECT
    USING (
        fn_current_user_role() = 'SISWA'
        AND visibility = 'RESTRICTED'::visibility_level
        AND is_void = false
        AND EXISTS (
            SELECT 1 FROM students s
            WHERE s.student_id = observations.student_id
              AND s.user_id    = fn_current_user_id()
              AND s.school_id  = fn_current_school_id()
        )
    );

-- 2. Orang tua membaca catatan DUDI tentang anaknya
DROP POLICY IF EXISTS rls_observations_read_parent_restricted ON observations;
CREATE POLICY rls_observations_read_parent_restricted ON observations FOR SELECT
    USING (
        fn_current_user_role() = 'ORTU'
        AND visibility = 'RESTRICTED'::visibility_level
        AND is_void = false
        AND EXISTS (
            SELECT 1 FROM student_parents sp
            WHERE sp.student_id     = observations.student_id
              AND sp.parent_user_id = fn_current_user_id()
        )
    );

-- 3. Pengawas PKL (Kaprodi & Waka Humas) membaca catatan DUDI di sekolahnya.
--    Penerima wajib menurut kode DUDI lama (getKaprodiAndWakaHumas),
--    difilter role_type — konsisten dengan sumber itu.
DROP POLICY IF EXISTS rls_observations_read_pkl_supervisor ON observations;
CREATE POLICY rls_observations_read_pkl_supervisor ON observations FOR SELECT
    USING (
        school_id = fn_current_school_id()
        AND visibility = 'RESTRICTED'::visibility_level
        AND is_void = false
        AND fn_current_user_role() = ANY (ARRAY['KAPRODI','WAKA_HUMAS']::role_type[])
    );
