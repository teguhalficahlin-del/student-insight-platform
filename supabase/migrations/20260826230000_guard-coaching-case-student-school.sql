BEGIN;

-- ── Guard student↔school di rls_cc_insert ────────────────────
-- Celah: GURU sekolah A bisa INSERT coaching_case dengan
-- student_id milik sekolah B. Tidak ada FK composite maupun
-- BEFORE INSERT trigger yang menutupnya.
--
-- fn_student_in_current_school(uuid) SUDAH ADA sejak migration
-- 20260707120000 / 20260731030000, dengan grant yang sudah benar
-- (authenticated + service_role, tanpa anon/PUBLIC). Body TIDAK
-- diubah — menambah filter student_status='AKTIF' akan memutus
-- cabang DUDI/PKL (siswa PKL berstatus 'PKL', bukan 'AKTIF') dan
-- merusak fn_create_placement / fn_finish_placement yang juga
-- memanggil fungsi ini.
--
-- Migration ini HANYA memasang predikat guard di with_check.

DROP POLICY IF EXISTS rls_cc_insert ON public.coaching_cases;

CREATE POLICY rls_cc_insert ON public.coaching_cases
    FOR INSERT
    TO authenticated
    WITH CHECK (
        school_id                   = fn_current_school_id()
        AND created_by_user_id      = fn_current_user_id()
        AND current_handler_user_id = fn_current_user_id()
        AND fn_current_user_role() <> ALL (ARRAY['SISWA'::role_type, 'ORTU'::role_type, 'STAKEHOLDER'::role_type])
        AND fn_student_in_current_school(student_id)
        AND NOT (
            fn_current_user_role() = 'DUDI'::role_type
            AND (track <> 'PKL'::case_track OR NOT fn_dudi_supervises_student(student_id))
        )
    );

COMMIT;
