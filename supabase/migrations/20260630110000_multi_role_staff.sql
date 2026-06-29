-- ============================================================
-- Multi-role staff: satu orang bisa rangkap jabatan.
-- ============================================================

-- 1. Tambah enum values baru
ALTER TYPE role_type ADD VALUE IF NOT EXISTS 'STAKEHOLDER';
ALTER TYPE role_type ADD VALUE IF NOT EXISTS 'WAKA_KURIKULUM';
ALTER TYPE role_type ADD VALUE IF NOT EXISTS 'WAKA_KESISWAAN';

-- 2. Tambah kolom jabatan pada tabel users
ALTER TABLE users ADD COLUMN IF NOT EXISTS kaprodi_program_id UUID REFERENCES programs(program_id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_bk BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_kepsek BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_waka_kurikulum BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_waka_kesiswaan BOOLEAN NOT NULL DEFAULT FALSE;

-- 3. Relax constraint wali_kelas: hanya non-staf yang dilarang
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_wali_kelas_role;
ALTER TABLE users ADD CONSTRAINT chk_wali_kelas_role
    CHECK (wali_kelas_class_id IS NULL OR role_type NOT IN ('SISWA', 'ORTU', 'DUDI', 'ADMINISTRATIVE'));

-- 4. Tambah identifier_type untuk stakeholder
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_identifier_type;
ALTER TABLE users ADD CONSTRAINT chk_identifier_type
    CHECK (identifier_type IN ('NIP', 'NIS', 'NIK', 'NAMA_USAHA', 'KODE_KHUSUS'));

COMMENT ON COLUMN users.kaprodi_program_id IS
    'Program keahlian yang dikepalai. Non-null = Kaprodi untuk program tersebut.';
COMMENT ON COLUMN users.is_bk IS
    'TRUE = berperan sebagai guru BK.';
COMMENT ON COLUMN users.is_kepsek IS
    'TRUE = berperan sebagai kepala sekolah.';
COMMENT ON COLUMN users.is_waka_kurikulum IS
    'TRUE = berperan sebagai wakil kepala bidang kurikulum.';
COMMENT ON COLUMN users.is_waka_kesiswaan IS
    'TRUE = berperan sebagai wakil kepala bidang kesiswaan.';
