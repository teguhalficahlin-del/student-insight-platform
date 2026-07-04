-- Enum WAKA_HUMAS harus di migrasi terpisah karena PostgreSQL melarang
-- penggunaan nilai enum baru dalam transaksi yang sama dengan ALTER TYPE.
ALTER TYPE role_type ADD VALUE IF NOT EXISTS 'WAKA_HUMAS';
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_waka_humas BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN users.is_waka_humas IS
    'TRUE = berperan sebagai wakil kepala bidang hubungan masyarakat (HUMAS/industri).';
