-- Hapus policy yang memberikan akses ke staf dan administrative
DROP POLICY IF EXISTS rls_observations_read_administrative ON observations;
DROP POLICY IF EXISTS rls_observations_read_staff ON observations;

-- Verifikasi policy yang tersisa sudah benar:
-- rls_observations_insert: guru insert milik sendiri + fn_guru_teaches_student ✅
-- rls_observations_read_guru: guru baca milik sendiri ✅
-- rls_observations_read_student: siswa baca sesuai visibilitas ✅
-- rls_observations_read_parent: ortu baca sesuai visibilitas ✅
-- rls_observations_update_author: guru update milik sendiri ✅
-- rls_observations_void_admin: administrative void ← dipertahankan (moderasi, bukan akses baca konten)
