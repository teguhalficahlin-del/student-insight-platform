-- Migration: 20260728100000_sip_cp_penilaian_rpc_fix.sql
-- Tujuan: Tambah Prioritas 0 di fn_get_cp_for_subject —
--   LIKE pattern match ('DDPK X TJKT') sebelum exact match ('DDPK')
--   agar mapel produktif (DDPK, KIK, MPP) bisa menemukan CP-nya.

CREATE OR REPLACE FUNCTION public.fn_get_cp_for_subject(
    p_subject_id   UUID,
    p_program_code VARCHAR,
    p_grade_level  SMALLINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, core
AS $$
DECLARE
    v_kode_pattern     VARCHAR;
    v_snm_row          RECORD;
    v_core_subject_id  UUID;
    v_confidence       VARCHAR;
    v_cp_row           RECORD;
    v_phase_id         UUID;
    v_result           JSONB;
    v_elemen           JSONB;
BEGIN
    -- Ambil kode mapel lokal dari public.subjects
    SELECT UPPER(TRIM(code)) INTO v_kode_pattern
    FROM public.subjects
    WHERE subject_id = p_subject_id
      AND is_active = true
    LIMIT 1;

    IF v_kode_pattern IS NULL THEN
        RETURN jsonb_build_object('found', false);
    END IF;

    -- Prioritas 0 (BARU): LIKE pattern — cocok untuk 'DDPK X TJKT', 'DDPK X AKL', dst.
    SELECT core_subject_id, confidence INTO v_snm_row
    FROM core.subject_name_mapping
    WHERE kode_pattern LIKE (v_kode_pattern || ' X %')
      AND program_hint  = p_program_code
      AND grade_level   = p_grade_level
      AND is_active     = true
    ORDER BY confidence DESC
    LIMIT 1;

    -- Prioritas 1: exact kode+program+grade
    IF v_snm_row IS NULL THEN
        SELECT core_subject_id, confidence INTO v_snm_row
        FROM core.subject_name_mapping
        WHERE kode_pattern = v_kode_pattern
          AND program_hint  = p_program_code
          AND grade_level   = p_grade_level
          AND is_active     = true
        LIMIT 1;
    END IF;

    -- Prioritas 2: kode+program, grade NULL
    IF v_snm_row IS NULL THEN
        SELECT core_subject_id, confidence INTO v_snm_row
        FROM core.subject_name_mapping
        WHERE kode_pattern = v_kode_pattern
          AND program_hint  = p_program_code
          AND grade_level   IS NULL
          AND is_active     = true
        LIMIT 1;
    END IF;

    -- Prioritas 3: kode saja, program NULL, grade NULL
    IF v_snm_row IS NULL THEN
        SELECT core_subject_id, confidence INTO v_snm_row
        FROM core.subject_name_mapping
        WHERE kode_pattern = v_kode_pattern
          AND program_hint  IS NULL
          AND grade_level   IS NULL
          AND is_active     = true
        LIMIT 1;
    END IF;

    IF v_snm_row IS NULL THEN
        RETURN jsonb_build_object('found', false);
    END IF;

    v_core_subject_id := v_snm_row.core_subject_id;
    v_confidence      := v_snm_row.confidence;

    -- Tentukan phase_id dari grade_level
    SELECT phase_id INTO v_phase_id
    FROM core.phases
    WHERE (p_grade_level = 10 AND code = 'E')
       OR (p_grade_level IN (11, 12) AND code = 'F')
    LIMIT 1;

    IF v_phase_id IS NULL THEN
        SELECT phase_id INTO v_phase_id
        FROM core.phases
        ORDER BY code DESC
        LIMIT 1;
    END IF;

    -- Ambil CP via subject_phases → capaian_pembelajaran
    SELECT cp.cp_id, cp.cp_umum, cp.bskap_ref,
           cs.code AS core_subject_code, cs.name AS core_subject_name
    INTO v_cp_row
    FROM core.subject_phases sp
    JOIN core.capaian_pembelajaran cp ON cp.subject_phase_id = sp.subject_phase_id
    JOIN core.subjects cs              ON cs.subject_id      = sp.subject_id
    WHERE sp.subject_id = v_core_subject_id
      AND sp.phase_id   = v_phase_id
      AND cp.is_active  = true
    ORDER BY cp.display_order NULLS LAST
    LIMIT 1;

    IF v_cp_row IS NULL THEN
        RETURN jsonb_build_object('found', false);
    END IF;

    -- Ambil semua elemen CP
    SELECT jsonb_agg(
        jsonb_build_object(
            'element_id',    e.element_id,
            'element_order', e.element_order,
            'nama_elemen',   e.nama_elemen,
            'deskripsi_cp',  e.deskripsi_cp
        ) ORDER BY e.element_order
    ) INTO v_elemen
    FROM core.cp_elements e
    WHERE e.cp_id     = v_cp_row.cp_id
      AND e.is_active = true;

    v_result := jsonb_build_object(
        'found',              true,
        'confidence',         v_confidence,
        'core_subject_code',  v_cp_row.core_subject_code,
        'core_subject_name',  v_cp_row.core_subject_name,
        'cp_umum',            v_cp_row.cp_umum,
        'bskap_ref',          v_cp_row.bskap_ref,
        'elemen',             COALESCE(v_elemen, '[]'::JSONB)
    );

    RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_get_cp_for_subject(UUID, VARCHAR, SMALLINT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_get_cp_for_subject(UUID, VARCHAR, SMALLINT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_get_cp_for_subject(UUID, VARCHAR, SMALLINT) TO authenticated;
