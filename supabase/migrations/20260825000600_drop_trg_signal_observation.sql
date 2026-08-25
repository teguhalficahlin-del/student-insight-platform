-- DROP trigger sinyal kehadiran dari observations.
-- Keputusan arsitektur: sinyal kehadiran guru
-- hanya boleh dipicu dari input absensi
-- (trg_teacher_signal_attendance tetap aktif).
DROP TRIGGER IF EXISTS trg_teacher_signal_observation
  ON observations;
