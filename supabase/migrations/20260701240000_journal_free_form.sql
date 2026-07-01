-- ============================================================
-- Migration: 20260701240000_journal_free_form.sql
--
-- Jurnal mengajar guru adalah catatan pribadi bebas — tidak terikat
-- sesi jadwal, kelas, maupun periode akademik. Drop trigger period
-- lock agar guru bisa menulis/mengedit jurnal kapan saja, termasuk
-- setelah semester ditutup.
--
-- trg_teacher_signal_journal tetap ada: jika guru mengisi jurnal
-- dengan schedule_id (misalnya dari fitur masa depan), sinyal
-- kehadiran tetap tercatat. Jika schedule_id NULL (jurnal bebas),
-- fn_teacher_attendance_signal sudah punya guard RETURN NEW → aman.
-- ============================================================

DROP TRIGGER IF EXISTS trg_journal_period_lock ON teacher_journals;
DROP FUNCTION IF EXISTS fn_journal_period_lock();

COMMENT ON TABLE teacher_journals IS
    'Private teacher journal. No shared read access. '
    'RLS policy: owner only. '
    'Free-form — not tied to any schedule, class, or academic period. '
    'Teacher may write and edit entries at any time.';
