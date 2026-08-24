-- DUD-01: Buat ulang policy INSERT observations untuk DUDI.
-- Migration 20260712030000 men-DROP rls_observations_write_dudi tanpa menggantinya,
-- sehingga DUDI tidak bisa INSERT ke tabel observations.
-- Policy baru mengizinkan visibility='RESTRICTED' (catatan internal sekolah untuk DUDI)
-- dan membatasi dengan 4 kondisi: role DUDI, author = caller,
-- siswa dalam pengawasan DUDI, dan school_id tenant.

DROP POLICY IF EXISTS rls_observations_insert_dudi ON observations;

CREATE POLICY rls_observations_insert_dudi ON observations
FOR INSERT WITH CHECK (
    fn_current_user_role() = 'DUDI'
    AND author_user_id    = fn_current_user_id()
    AND fn_dudi_supervises_student(student_id)
    AND school_id         = fn_current_school_id()
    AND visibility        = 'RESTRICTED'::visibility_level
);
