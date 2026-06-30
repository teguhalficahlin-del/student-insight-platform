-- ============================================================
-- Migration: 20260630160000_dudi_observation_read_own.sql
-- Beri DUDI akses READ untuk observasi yang ditulis sendiri.
-- ============================================================
--
-- LATAR BELAKANG
-- Migration 20260630140000 memberi DUDI izin INSERT observasi.
-- Namun tidak ada policy SELECT untuk DUDI, sehingga DUDI tidak
-- bisa membaca kembali observasi yang baru saja mereka tulis.
-- Panel "Riwayat Catatan" di portal DUDI selalu kosong.
--
-- Policy ini membatasi: DUDI hanya bisa baca observasi yang
-- ia tulis sendiri (author_user_id = fn_current_user_id()),
-- bukan observasi dari DUDI lain atau guru.
-- ============================================================

DROP POLICY IF EXISTS rls_observations_read_dudi_own ON observations;
CREATE POLICY rls_observations_read_dudi_own ON observations
    FOR SELECT USING (
        fn_current_user_role() = 'DUDI'
        AND author_user_id = fn_current_user_id()
    );
