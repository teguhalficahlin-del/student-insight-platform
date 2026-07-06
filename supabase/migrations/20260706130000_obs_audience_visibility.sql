-- Langkah 1/2: Tambah nilai enum baru ke visibility_level.
-- Harus di transaksi terpisah — PostgreSQL tidak mengizinkan
-- penggunaan nilai enum baru dalam transaksi yang sama dengan ADD VALUE.
ALTER TYPE visibility_level ADD VALUE IF NOT EXISTS 'PRIVATE';
ALTER TYPE visibility_level ADD VALUE IF NOT EXISTS 'RESTRICTED';
ALTER TYPE visibility_level ADD VALUE IF NOT EXISTS 'PUBLIC';
