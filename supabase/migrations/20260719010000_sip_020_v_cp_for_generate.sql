-- SIP-020: View v_cp_for_generate
-- Expose data CP dari core schema ke public schema
-- agar bisa diakses Edge Function via Supabase client standard

CREATE OR REPLACE VIEW public.v_cp_for_generate AS
SELECT
  sp.subject_id                                                  AS core_subject_id,
  sp.phase_id,
  p.code                                                         AS fase_code,
  s.name                                                         AS subject_name,
  s.code                                                         AS subject_code,
  s.subject_type,
  cp.cp_umum,
  cp.rasional,
  cp.tujuan,
  cp.karakteristik,
  COALESCE(
    json_agg(
      json_build_object(
        'urutan',    e.element_order,
        'nama',      e.nama_elemen,
        'deskripsi', e.deskripsi_cp
      ) ORDER BY e.element_order
    ) FILTER (WHERE e.element_id IS NOT NULL AND e.is_active = true),
    '[]'::json
  )                                                              AS elemen
FROM core.subject_phases sp
JOIN core.phases p            ON p.phase_id = sp.phase_id
JOIN core.subjects s          ON s.subject_id = sp.subject_id
JOIN core.capaian_pembelajaran cp ON cp.subject_phase_id = sp.subject_phase_id
LEFT JOIN core.cp_elements e  ON e.cp_id = cp.cp_id
WHERE s.is_active = true
GROUP BY
  sp.subject_id, sp.phase_id,
  p.code, s.name, s.code, s.subject_type,
  cp.cp_umum, cp.rasional, cp.tujuan, cp.karakteristik;

-- Access control: authenticated saja
GRANT  SELECT ON public.v_cp_for_generate TO authenticated;
REVOKE ALL    ON public.v_cp_for_generate FROM anon;
REVOKE SELECT ON public.v_cp_for_generate FROM PUBLIC;

COMMENT ON VIEW public.v_cp_for_generate IS
  'Expose core.capaian_pembelajaran + core.cp_elements untuk Edge Function generate-atp-v2.
   Hanya authenticated. Data CP PENDING diisi dari SK BSKAP No. 046/H/KR/2025.';
