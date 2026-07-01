-- ============================================================
-- Migration: 20260701370000_drop_observation_period_lock.sql
--
-- Observasi siswa adalah catatan pedagogis bebas — tidak terikat
-- periode akademik. Drop trigger period lock agar staf bisa
-- menulis observasi kapan saja, termasuk setelah semester ditutup
-- (rekap historis, catatan terlambat, dll).
--
-- Paralel dengan 20260701240000 yang melakukan hal sama untuk
-- teacher_journals.
-- ============================================================

DROP TRIGGER IF EXISTS trg_observation_period_lock ON observations;
DROP FUNCTION IF EXISTS fn_observation_period_lock();

COMMENT ON TABLE observations IS
    'Student observation notes. No period lock — staff may write '
    'and edit observations at any time regardless of academic period.';
