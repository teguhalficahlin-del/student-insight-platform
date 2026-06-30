-- ============================================================
-- Data uji multi-peran: beberapa akun guru dengan >1 tab dashboard
-- ============================================================

-- 1. Ahmad Dwi Dinata (sudah Wali Kelas) → tambah BK
--    Hasil: 3 tab → Dashboard Guru · Wali Kelas · BK
UPDATE users
SET is_bk = TRUE
WHERE login_identifier = '197805051993081005';

-- 2. Cucu Hamdani (Waka Kurikulum) → tambah Wali Kelas
--    Ambil class_id dari kelas yang belum punya wali
--    Hasil: 3 tab → Dashboard Guru · Wali Kelas · Waka Kurikulum
UPDATE users
SET wali_kelas_class_id = (
    SELECT c.class_id
    FROM classes c
    LEFT JOIN users u ON u.wali_kelas_class_id = c.class_id
    WHERE u.user_id IS NULL
    LIMIT 1
)
WHERE login_identifier = '197208111996082007'
  AND wali_kelas_class_id IS NULL;

-- 3. Bambang Dwi Suherman (Kaprodi) → tambah BK
--    Hasil: 3 tab → Dashboard Guru · Kaprodi · BK
UPDATE users
SET is_bk = TRUE
WHERE login_identifier = '196502172005061007';
