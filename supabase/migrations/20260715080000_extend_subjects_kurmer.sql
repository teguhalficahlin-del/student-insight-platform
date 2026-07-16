ALTER TABLE subjects
  ADD COLUMN IF NOT EXISTS kelompok_mapel VARCHAR(20)
    CHECK (kelompok_mapel IN ('UMUM','KEJURUAN','PILIHAN','MUATAN_LOKAL')),
  ADD COLUMN IF NOT EXISTS fase_default VARCHAR(1)
    CHECK (fase_default IN ('E','F'));

COMMENT ON COLUMN subjects.kelompok_mapel IS
  'Kelompok mata pelajaran Kurikulum Merdeka SMK';
COMMENT ON COLUMN subjects.fase_default IS
  'Fase default: E=kelas X, F=kelas XI-XII';
