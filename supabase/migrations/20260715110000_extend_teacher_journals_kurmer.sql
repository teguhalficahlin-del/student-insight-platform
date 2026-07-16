ALTER TABLE teacher_journals
  ADD COLUMN IF NOT EXISTS tp_id UUID REFERENCES tujuan_pembelajaran(tp_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS kondisi_kelas VARCHAR(20)
    CHECK (kondisi_kelas IN ('SANGAT_BAIK','BAIK','CUKUP','TERGANGGU')),
  ADD COLUMN IF NOT EXISTS catatan_tambahan TEXT,
  ADD COLUMN IF NOT EXISTS tindak_lanjut TEXT;

COMMENT ON COLUMN teacher_journals.tp_id IS
  'TP yang diajarkan di sesi ini';
COMMENT ON COLUMN teacher_journals.kondisi_kelas IS
  'Kondisi kelas: SANGAT_BAIK/BAIK/CUKUP/TERGANGGU';
