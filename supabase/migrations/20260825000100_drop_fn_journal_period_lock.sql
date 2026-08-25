-- Orphaned function — trigger trg_journal_period_lock sudah di-DROP
-- di migration 20260701240000_journal_free_form.sql.
-- Fungsi ini tidak memiliki trigger yang menggunakannya.
DROP FUNCTION IF EXISTS public.fn_journal_period_lock();
