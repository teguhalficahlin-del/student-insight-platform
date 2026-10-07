-- Selaraskan izin observasi dengan kontrak UI:
-- semua pengguna guru yang memiliki teacher_code dapat menulis dan membaca catatannya sendiri.
BEGIN;

DROP POLICY IF EXISTS rls_observations_insert ON public.observations;
CREATE POLICY rls_observations_insert ON public.observations
    FOR INSERT
    WITH CHECK (
        school_id = fn_current_school_id()
        AND author_user_id = fn_current_user_id()
        AND EXISTS (
            SELECT 1
            FROM public.users u
            WHERE u.user_id = fn_current_user_id()
              AND NULLIF(BTRIM(u.teacher_code), '') IS NOT NULL
        )
        AND visibility = ANY (ARRAY[
            'SISWA_SAJA'::visibility_level,
            'ORTU_SAJA'::visibility_level,
            'SISWA_DAN_ORTU'::visibility_level,
            'PRIVATE'::visibility_level
        ])
        AND fn_guru_teaches_student(student_id)
    );

DROP POLICY IF EXISTS rls_observations_read_guru ON public.observations;
CREATE POLICY rls_observations_read_guru ON public.observations
    FOR SELECT
    USING (
        school_id = fn_current_school_id()
        AND author_user_id = fn_current_user_id()
        AND EXISTS (
            SELECT 1
            FROM public.users u
            WHERE u.user_id = fn_current_user_id()
              AND NULLIF(BTRIM(u.teacher_code), '') IS NOT NULL
        )
    );

DROP POLICY IF EXISTS rls_observations_update_author ON public.observations;
CREATE POLICY rls_observations_update_author ON public.observations
    FOR UPDATE
    USING (
        school_id = fn_current_school_id()
        AND author_user_id = fn_current_user_id()
        AND EXISTS (
            SELECT 1
            FROM public.users u
            WHERE u.user_id = fn_current_user_id()
              AND NULLIF(BTRIM(u.teacher_code), '') IS NOT NULL
        )
    )
    WITH CHECK (
        school_id = fn_current_school_id()
        AND author_user_id = fn_current_user_id()
        AND EXISTS (
            SELECT 1
            FROM public.users u
            WHERE u.user_id = fn_current_user_id()
              AND NULLIF(BTRIM(u.teacher_code), '') IS NOT NULL
        )
        AND visibility = ANY (ARRAY[
            'SISWA_SAJA'::visibility_level,
            'ORTU_SAJA'::visibility_level,
            'SISWA_DAN_ORTU'::visibility_level,
            'PRIVATE'::visibility_level
        ])
    );

COMMIT;
