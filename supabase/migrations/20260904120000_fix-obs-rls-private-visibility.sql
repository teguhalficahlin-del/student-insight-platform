-- Fix: tambah PRIVATE ke allowlist visibility di rls_observations_insert
-- dan rls_observations_update_author.
--
-- BUG: opsi "Catatan pribadi (hanya saya)" di UI mengirim visibility=PRIVATE,
--      tapi kedua policy hanya mengizinkan SISWA_SAJA|ORTU_SAJA|SISWA_DAN_ORTU.
--      Akibat: setiap INSERT/UPDATE dengan PRIVATE ditolak RLS (42501).
--
-- READ isolation tetap aman: rls_observations_read_student dan _read_parent
-- tidak menyertakan PRIVATE sehingga catatan PRIVATE tidak bocor ke siswa/ortu.

BEGIN;

-- Supabase tidak mendukung ALTER POLICY … WITH CHECK secara langsung —
-- harus DROP + CREATE dengan definisi lengkap.

DROP POLICY IF EXISTS rls_observations_insert ON public.observations;
CREATE POLICY rls_observations_insert ON public.observations
    FOR INSERT
    WITH CHECK (
        school_id        = fn_current_school_id()
        AND fn_current_user_role() = 'GURU'::role_type
        AND author_user_id = fn_current_user_id()
        AND visibility   = ANY (ARRAY[
            'SISWA_SAJA'::visibility_level,
            'ORTU_SAJA'::visibility_level,
            'SISWA_DAN_ORTU'::visibility_level,
            'PRIVATE'::visibility_level
        ])
        AND fn_guru_teaches_student(student_id)
    );

DROP POLICY IF EXISTS rls_observations_update_author ON public.observations;
CREATE POLICY rls_observations_update_author ON public.observations
    FOR UPDATE
    USING (
        school_id        = fn_current_school_id()
        AND fn_current_user_role() = 'GURU'::role_type
        AND author_user_id = fn_current_user_id()
    )
    WITH CHECK (
        school_id        = fn_current_school_id()
        AND fn_current_user_role() = 'GURU'::role_type
        AND author_user_id = fn_current_user_id()
        AND visibility   = ANY (ARRAY[
            'SISWA_SAJA'::visibility_level,
            'ORTU_SAJA'::visibility_level,
            'SISWA_DAN_ORTU'::visibility_level,
            'PRIVATE'::visibility_level
        ])
    );

COMMIT;
