-- Fase 1/2: Tambah nilai enum baru untuk catatan siswa.
-- Harus di file terpisah karena ADD VALUE tidak bisa dipakai
-- dalam transaksi yang sama dengan DML yang menggunakannya.
ALTER TYPE visibility_level ADD VALUE IF NOT EXISTS 'SISWA_SAJA';
ALTER TYPE visibility_level ADD VALUE IF NOT EXISTS 'ORTU_SAJA';
ALTER TYPE visibility_level ADD VALUE IF NOT EXISTS 'SISWA_DAN_ORTU';
