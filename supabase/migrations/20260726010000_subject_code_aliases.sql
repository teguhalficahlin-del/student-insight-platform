-- Migration: subject_code_aliases
-- Tabel alias kode mapel per sekolah (mis. 'B.INGG' → core_subject_id Bahasa Inggris).
-- Admin isi sendiri via overlay Susun Jadwal → tab "Kode Mapel".

CREATE TABLE IF NOT EXISTS public.subject_code_aliases (
    alias_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id       UUID NOT NULL REFERENCES public.schools(school_id),
    kode            VARCHAR(30) NOT NULL,
    core_subject_id UUID NOT NULL REFERENCES core.subjects(subject_id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (school_id, kode)
);

ALTER TABLE public.subject_code_aliases ENABLE ROW LEVEL SECURITY;

-- Semua staf autentikasi boleh baca alias sekolahnya (dipakai saat Terapkan Jadwal)
CREATE POLICY sca_select ON public.subject_code_aliases
    FOR SELECT TO authenticated
    USING (school_id = fn_current_school_id());

-- Hanya ADMINISTRATIVE yang boleh CRUD
CREATE POLICY sca_insert ON public.subject_code_aliases
    FOR INSERT TO authenticated
    WITH CHECK (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type);

CREATE POLICY sca_update ON public.subject_code_aliases
    FOR UPDATE TO authenticated
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type);

CREATE POLICY sca_delete ON public.subject_code_aliases
    FOR DELETE TO authenticated
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type);
