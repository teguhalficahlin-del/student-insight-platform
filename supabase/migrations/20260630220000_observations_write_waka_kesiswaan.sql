-- ============================================================
-- Migration: 20260630220000_observations_write_waka_kesiswaan.sql
-- Follow-up audit RLS (lihat [[project-rls-audit]]): WAKA_KESISWAAN
-- belum bisa MENULIS observasi.
--
-- LATAR BELAKANG
-- contracts/06_rls_policies.sql rls_observations_write hanya izinkan
-- GURU/WALI_KELAS/BK/KAPRODI/KEPSEK. Per [[project-actor-roles]],
-- WAKA_KESISWAAN "Input Observasi: Ya" (WAKA_KURIKULUM = Tidak, jadi
-- sengaja TIDAK ditambah). Form observasi di tab Dashboard Guru tampil
-- untuk semua user /guru/ termasuk waka, tapi submit-nya gagal RLS.
--
-- PENDEKATAN: ADITIF — policy INSERT baru khusus WAKA_KESISWAAN,
-- author_user_id wajib dirinya sendiri (pola sama rls_observations_write).
-- Tidak mengubah policy lama → nol risiko regresi.
-- ============================================================

DROP POLICY IF EXISTS rls_observations_write_waka_kesiswaan ON observations;
CREATE POLICY rls_observations_write_waka_kesiswaan ON observations
    FOR INSERT WITH CHECK (
        fn_current_user_role() = 'WAKA_KESISWAAN'
        AND author_user_id = fn_current_user_id()
    );
