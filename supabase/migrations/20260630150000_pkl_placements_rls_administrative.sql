-- ============================================================
-- Migration: 20260630150000_pkl_placements_rls_administrative.sql
-- Beri ADMINISTRATIVE akses tulis ke pkl_placements.
-- ============================================================
--
-- LATAR BELAKANG
-- rls_pkl_write_admin (kontrak asli) hanya mengizinkan KAPRODI dan KEPSEK.
-- ADMINISTRATIVE perlu akses tulis agar bisa:
--   (a) Membersihkan penempatan saat hapus siswa lewat wizard admin
--   (b) Konsisten dengan rls_students_write_administrative
-- Edge function bulk-import-pkl memakai service_role (bypass RLS),
-- tapi policy ini diperlukan bila kelak ada alur ADMINISTRATIVE
-- yang memakai session JWT biasa.
-- ============================================================

DROP POLICY IF EXISTS rls_pkl_write_administrative ON pkl_placements;
CREATE POLICY rls_pkl_write_administrative ON pkl_placements
    FOR ALL USING (fn_current_user_role() = 'ADMINISTRATIVE');
