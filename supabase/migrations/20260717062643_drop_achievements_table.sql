-- Hapus view yang bergantung pada tabel achievements
DROP VIEW IF EXISTS v_student_portal_achievements;

-- Hapus semua policy dulu
DROP POLICY IF EXISTS rls_achievements_write ON achievements;
DROP POLICY IF EXISTS rls_achievements_read_staff ON achievements;
DROP POLICY IF EXISTS rls_achievements_read_student ON achievements;
DROP POLICY IF EXISTS rls_achievements_void ON achievements;

-- Hapus tabel
DROP TABLE IF EXISTS achievements;
