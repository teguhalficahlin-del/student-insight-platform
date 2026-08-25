-- Migration: 20260825000800_fix_assessment_rls_school_write.sql
-- Tujuan  : Ganti 4 policy *_school_write (FOR ALL, hanya cek school_id)
--           dengan policy granular INSERT/UPDATE/DELETE berbasis KEPEMILIKAN.
-- Idempotent: DROP POLICY IF EXISTS + CREATE OR REPLACE FUNCTION.
--
-- MASALAH YANG DIPERBAIKI
-- Keempat policy berikut hadir di DB tapi TIDAK ADA di migration manapun (drift):
--   assessments_school_write, assessment_results_school_write,
--   grade_recap_school_write, student_groups_school_write
-- Semuanya FOR ALL dengan syarat tunggal `school_id = fn_current_school_id()`.
-- Akibatnya SIAPA PUN yang login di sekolah itu — termasuk SISWA, ORTU, TU,
-- DUDI, STAKEHOLDER — bisa INSERT/UPDATE/DELETE nilai siswa.
--
-- CATATAN TRANSAKSI
-- Sengaja TIDAK memakai BEGIN;/COMMIT; eksplisit. `supabase db push` sudah
-- menjalankan tiap file migration di dalam satu transaksi; menaruh BEGIN/COMMIT
-- di dalam file justru meng-commit transaksi luar lebih awal.
--
-- CATATAN GATE ROLE — MENYIMPANG DARI USULAN AWAL, DISENGAJA
-- Usulan awal memakai gate `fn_current_user_role() = 'GURU'`. Itu TIDAK dipakai.
-- Alasannya, di DB produksi ada 7 staf pengajar aktif ber-role selain 'GURU'
-- yang memegang teaching_assignments aktif:
--   BK 3, WAKA_KURIKULUM 1, KEPSEK 1, WAKA_HUMAS 1, WAKA_KESISWAAN 1
-- Gate role literal akan mengunci ketujuhnya dari mencatat nilai.
-- Gate KEPEMILIKAN (teacher_id = pemanggil) sudah menjamin hanya pemilik yang
-- menulis; menambah gate role tidak menambah keamanan, hanya menambah lockout.
--
-- CATATAN UPSERT
-- guru/js/api.js menulis ketiga tabel via .upsert() = INSERT ... ON CONFLICT
-- DO UPDATE. Itu butuh policy INSERT (WITH CHECK) DAN UPDATE (USING + WITH
-- CHECK) sekaligus. Policy INSERT saja akan membuat simpan kedua gagal.

-- ============================================================
-- HELPER 1: fn_owns_assessment
-- assessment_results tidak punya kolom teacher_id — kepemilikan
-- diturunkan lewat assessment_id -> assessments.teacher_id.
-- SECURITY DEFINER wajib: assessments ber-RLS, sehingga EXISTS mentah
-- di dalam USING/WITH CHECK akan dievaluasi memakai visibilitas RLS
-- si pemanggil, bukan aturan yang dimaksud (AGENT_WORKING_RULES §5).
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_owns_assessment(p_assessment_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM   assessments a
        WHERE  a.id         = p_assessment_id
          AND  a.teacher_id = fn_current_user_id()
          AND  a.school_id  = fn_current_school_id()
    );
$$;

GRANT  EXECUTE ON FUNCTION public.fn_owns_assessment(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_owns_assessment(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_owns_assessment(UUID) FROM PUBLIC;

-- ============================================================
-- HELPER 2: fn_owns_learning_objective
-- grade_recap tidak punya teacher_id — kepemilikan diturunkan lewat
-- learning_objective_id -> learning_objectives.teacher_id (NOT NULL).
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_owns_learning_objective(p_lo_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM   learning_objectives lo
        WHERE  lo.id         = p_lo_id
          AND  lo.teacher_id = fn_current_user_id()
          AND  lo.school_id  = fn_current_school_id()
    );
$$;

GRANT  EXECUTE ON FUNCTION public.fn_owns_learning_objective(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_owns_learning_objective(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_owns_learning_objective(UUID) FROM PUBLIC;

-- ============================================================
-- HELPER 3: fn_teaches_class
-- student_groups TIDAK punya jalur kepemilikan sama sekali — kolomnya
-- hanya school_id, class_id, student_id, grup. Pengelompokan siswa
-- adalah data tingkat kelas, jadi yang berhak menulis adalah staf yang
-- benar-benar mengajar kelas itu (teaching_assignments aktif).
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_teaches_class(p_class_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM   teaching_assignments ta
        WHERE  ta.user_id   = fn_current_user_id()
          AND  ta.class_id  = p_class_id
          AND  ta.school_id = fn_current_school_id()
          AND  ta.is_active = true
    );
$$;

GRANT  EXECUTE ON FUNCTION public.fn_teaches_class(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_teaches_class(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_teaches_class(UUID) FROM PUBLIC;

-- ============================================================
-- assessment_results — policy granular (BELUM ADA sebelumnya)
-- Sebelum migration ini tabel hanya punya SELECT (assessment_results_school_read)
-- + school_write. Jadi CREATE dulu, DROP belakangan.
-- ============================================================
DROP POLICY IF EXISTS rls_assessment_results_insert_owner ON public.assessment_results;
CREATE POLICY rls_assessment_results_insert_owner
    ON public.assessment_results
    FOR INSERT
    WITH CHECK (
        school_id = fn_current_school_id()
        AND fn_owns_assessment(assessment_id)
    );

DROP POLICY IF EXISTS rls_assessment_results_update_owner ON public.assessment_results;
CREATE POLICY rls_assessment_results_update_owner
    ON public.assessment_results
    FOR UPDATE
    USING (
        school_id = fn_current_school_id()
        AND fn_owns_assessment(assessment_id)
    )
    WITH CHECK (
        school_id = fn_current_school_id()
        AND fn_owns_assessment(assessment_id)
    );

DROP POLICY IF EXISTS rls_assessment_results_delete_owner ON public.assessment_results;
CREATE POLICY rls_assessment_results_delete_owner
    ON public.assessment_results
    FOR DELETE
    USING (
        school_id = fn_current_school_id()
        AND fn_owns_assessment(assessment_id)
    );

-- ============================================================
-- grade_recap — policy granular (BELUM ADA sebelumnya)
-- ============================================================
DROP POLICY IF EXISTS rls_grade_recap_insert_owner ON public.grade_recap;
CREATE POLICY rls_grade_recap_insert_owner
    ON public.grade_recap
    FOR INSERT
    WITH CHECK (
        school_id = fn_current_school_id()
        AND fn_owns_learning_objective(learning_objective_id)
    );

DROP POLICY IF EXISTS rls_grade_recap_update_owner ON public.grade_recap;
CREATE POLICY rls_grade_recap_update_owner
    ON public.grade_recap
    FOR UPDATE
    USING (
        school_id = fn_current_school_id()
        AND fn_owns_learning_objective(learning_objective_id)
    )
    WITH CHECK (
        school_id = fn_current_school_id()
        AND fn_owns_learning_objective(learning_objective_id)
    );

DROP POLICY IF EXISTS rls_grade_recap_delete_owner ON public.grade_recap;
CREATE POLICY rls_grade_recap_delete_owner
    ON public.grade_recap
    FOR DELETE
    USING (
        school_id = fn_current_school_id()
        AND fn_owns_learning_objective(learning_objective_id)
    );

-- ============================================================
-- student_groups — policy granular (BELUM ADA sebelumnya)
-- ============================================================
DROP POLICY IF EXISTS rls_student_groups_insert_pengajar ON public.student_groups;
CREATE POLICY rls_student_groups_insert_pengajar
    ON public.student_groups
    FOR INSERT
    WITH CHECK (
        school_id = fn_current_school_id()
        AND fn_teaches_class(class_id)
    );

DROP POLICY IF EXISTS rls_student_groups_update_pengajar ON public.student_groups;
CREATE POLICY rls_student_groups_update_pengajar
    ON public.student_groups
    FOR UPDATE
    USING (
        school_id = fn_current_school_id()
        AND fn_teaches_class(class_id)
    )
    WITH CHECK (
        school_id = fn_current_school_id()
        AND fn_teaches_class(class_id)
    );

DROP POLICY IF EXISTS rls_student_groups_delete_pengajar ON public.student_groups;
CREATE POLICY rls_student_groups_delete_pengajar
    ON public.student_groups
    FOR DELETE
    USING (
        school_id = fn_current_school_id()
        AND fn_teaches_class(class_id)
    );

-- ============================================================
-- assessments — ganti gate role 'GURU' dengan gate kepemilikan
--
-- Policy lama rls_assessments_{insert,update,delete}_guru mensyaratkan
-- fn_current_user_role() = 'GURU'. Selama ini pembatasan itu tertutupi oleh
-- assessments_school_write yang permissive. Begitu school_write di-DROP,
-- 7 staf pengajar aktif ber-role BK/WAKA_*/KEPSEK langsung kehilangan akses
-- membuat dan mengubah penilaian di kelas yang mereka ajar sendiri.
--
-- Gate kepemilikan di bawah lebih longgar untuk staf sah TAPI tetap jauh
-- lebih ketat daripada school_write: hanya pemilik baris yang bisa menulis.
-- ============================================================
DROP POLICY IF EXISTS rls_assessments_insert_guru  ON public.assessments;
DROP POLICY IF EXISTS rls_assessments_insert_owner ON public.assessments;
CREATE POLICY rls_assessments_insert_owner
    ON public.assessments
    FOR INSERT
    WITH CHECK (
        school_id  = fn_current_school_id()
        AND teacher_id = fn_current_user_id()
    );

DROP POLICY IF EXISTS rls_assessments_update_guru  ON public.assessments;
DROP POLICY IF EXISTS rls_assessments_update_owner ON public.assessments;
CREATE POLICY rls_assessments_update_owner
    ON public.assessments
    FOR UPDATE
    USING (
        school_id  = fn_current_school_id()
        AND teacher_id = fn_current_user_id()
    )
    WITH CHECK (
        school_id  = fn_current_school_id()
        AND teacher_id = fn_current_user_id()
    );

DROP POLICY IF EXISTS rls_assessments_delete_guru  ON public.assessments;
DROP POLICY IF EXISTS rls_assessments_delete_owner ON public.assessments;
CREATE POLICY rls_assessments_delete_owner
    ON public.assessments
    FOR DELETE
    USING (
        school_id  = fn_current_school_id()
        AND teacher_id = fn_current_user_id()
    );

-- ============================================================
-- DROP 4 policy *_school_write — LANGKAH TERAKHIR
-- Baru dijalankan setelah seluruh policy pengganti terpasang, supaya
-- tidak ada jendela waktu tanpa jalur tulis.
--
-- SELECT tidak terdampak: keempat tabel tetap punya *_school_read,
-- dan assessments masih punya 6 policy SELECT per-role.
-- ============================================================
DROP POLICY IF EXISTS assessments_school_write        ON public.assessments;
DROP POLICY IF EXISTS assessment_results_school_write ON public.assessment_results;
DROP POLICY IF EXISTS grade_recap_school_write        ON public.grade_recap;
DROP POLICY IF EXISTS student_groups_school_write     ON public.student_groups;
