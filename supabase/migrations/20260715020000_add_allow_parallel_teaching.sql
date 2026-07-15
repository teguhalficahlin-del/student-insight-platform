-- Add allow_parallel_teaching flag to users table
-- Digunakan untuk guru moving class / team teaching yang boleh
-- dijadwalkan di lebih dari satu kelas pada waktu bersamaan.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS allow_parallel_teaching
  BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN users.allow_parallel_teaching IS
  'Jika TRUE, guru diizinkan mengajar paralel (moving class/team teaching). '
  'Validasi bentrok di bulk-import-schedules akan diabaikan untuk guru ini.';
