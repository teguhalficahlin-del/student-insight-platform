-- Drop semua policy observasi lama yang tidak lagi relevan
-- setelah model catatan siswa diterapkan.
-- Catatan siswa murni antara guru ↔ siswa/ortu.
-- Admin, DUDI, WAKA tidak punya akses sama sekali.

DROP POLICY IF EXISTS rls_observations_write                ON observations;
DROP POLICY IF EXISTS rls_observations_write_guru           ON observations;
DROP POLICY IF EXISTS rls_observations_write_dudi           ON observations;
DROP POLICY IF EXISTS rls_observations_write_waka_kesiswaan ON observations;
DROP POLICY IF EXISTS rls_observations_read_dudi_own        ON observations;
DROP POLICY IF EXISTS rls_observations_read_administrative  ON observations;
DROP POLICY IF EXISTS rls_observations_delete_administrative ON observations;
DROP POLICY IF EXISTS rls_observations_void_admin           ON observations;
