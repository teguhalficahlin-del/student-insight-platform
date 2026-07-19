-- SIP Sprint 2 — 012: View v_core_subjects
-- Supabase JS client hanya bisa .from() ke public schema.
-- View ini menjembatani akses ke core.subjects (kurikulum nasional) tanpa
-- perlu query cross-schema langsung. RLS core.subjects sudah OPEN TO authenticated.
-- Data kurikulum nasional = tidak ada school_id / data tenant → tidak perlu RLS pada view.

CREATE OR REPLACE VIEW public.v_core_subjects AS
  SELECT
    subject_id,
    code,
    name,
    subject_type,
    is_generatable
  FROM core.subjects
  ORDER BY subject_type, name;

GRANT SELECT ON public.v_core_subjects TO authenticated;
