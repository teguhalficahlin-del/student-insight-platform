-- DROP dua fungsi menggantung dari migration 20260728020000
-- fn_is_my_lo dan fn_lo_in_my_school query ke kolom learning_objective_id
-- di tabel learning_objectives lama yang sudah di-DROP di 20260809000003.
-- Tabel learning_objectives baru (20260809000004) pakai kolom id — kedua
-- fungsi lama tidak kompatibel dan tidak ada caller aktif di JS.

DROP FUNCTION IF EXISTS fn_is_my_lo(uuid);
DROP FUNCTION IF EXISTS fn_lo_in_my_school(uuid);
