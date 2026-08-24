-- assessment_criteria: jadikan kolom lama nullable agar model rentang JSONB bisa dipakai
-- tanpa konflik NOT NULL / overlap trigger lama.

ALTER TABLE public.assessment_criteria
  ALTER COLUMN predikat    DROP NOT NULL,
  ALTER COLUMN batas_bawah DROP NOT NULL,
  ALTER COLUMN batas_atas  DROP NOT NULL;

-- Hapus constraint range lama (batas_bawah < batas_atas) yang tidak relevan dengan model rentang
ALTER TABLE public.assessment_criteria
  DROP CONSTRAINT IF EXISTS chk_ac_range;

-- Nonaktifkan trigger overlap lama — tidak kompatibel dengan model rentang JSONB
DROP TRIGGER IF EXISTS trg_kktp_no_overlap          ON public.assessment_criteria;
DROP TRIGGER IF EXISTS trg_assessment_criteria_no_overlap ON public.assessment_criteria;
