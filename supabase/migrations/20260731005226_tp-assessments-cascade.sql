-- Ubah FK tp_assessments.learning_objective_id dari NO ACTION ke CASCADE
-- Sehingga hard delete learning_objectives otomatis hapus nilai siswa terkait.

BEGIN;

ALTER TABLE public.tp_assessments
  DROP CONSTRAINT IF EXISTS tp_assessments_learning_objective_id_fkey;

ALTER TABLE public.tp_assessments
  ADD CONSTRAINT tp_assessments_learning_objective_id_fkey
    FOREIGN KEY (learning_objective_id)
    REFERENCES public.learning_objectives(learning_objective_id)
    ON DELETE CASCADE;

COMMIT;
