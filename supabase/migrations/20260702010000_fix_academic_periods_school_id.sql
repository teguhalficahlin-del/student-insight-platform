-- Fix: uq_academic_period harus menyertakan school_id (multi-tenant)
-- Sebelumnya: UNIQUE (academic_year, semester) → dua sekolah tidak bisa
-- punya tahun ajaran yang sama. Perbaiki menjadi per-sekolah.

ALTER TABLE public.academic_periods
    DROP CONSTRAINT uq_academic_period;

ALTER TABLE public.academic_periods
    ADD CONSTRAINT uq_academic_period
    UNIQUE (school_id, academic_year, semester);
