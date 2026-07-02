-- ============================================================
-- Tahap 3b — Void (batalkan) observasi yang salah
-- ============================================================
-- Sebelumnya observasi write-once: guru yang salah kirim tidak bisa
-- memperbaiki, dan satu-satunya cara hapus adalah DELETE langsung di DB
-- (kehilangan jejak). Tambahkan soft-delete (void) meniru pola attendance
-- (is_void + void_reason): baris tetap ada untuk audit, tapi disembunyikan
-- dari siswa/ortu/DUDI dan ditandai di konsol admin.
--
-- Yang boleh void: ADMINISTRATIVE (admin sekolah) & KEPSEK.
-- ============================================================

-- STEP 1 — kolom void (idempoten)
ALTER TABLE public.observations
    ADD COLUMN IF NOT EXISTS is_void     BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS void_reason TEXT,
    ADD COLUMN IF NOT EXISTS voided_by   UUID REFERENCES public.users(user_id),
    ADD COLUMN IF NOT EXISTS voided_at   TIMESTAMPTZ;

COMMENT ON COLUMN public.observations.is_void     IS 'True jika observasi dibatalkan (soft-delete). Disembunyikan dari siswa/ortu/DUDI.';
COMMENT ON COLUMN public.observations.void_reason IS 'Alasan pembatalan yang dicatat admin/kepsek.';

-- STEP 2 — kebijakan UPDATE untuk void (admin & kepsek, dalam sekolahnya)
DROP POLICY IF EXISTS rls_observations_void_admin ON public.observations;
CREATE POLICY rls_observations_void_admin ON public.observations
    FOR UPDATE
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() IN ('ADMINISTRATIVE'::role_type, 'KEPSEK'::role_type)
    )
    WITH CHECK (
        school_id = fn_current_school_id()
        AND fn_current_user_role() IN ('ADMINISTRATIVE'::role_type, 'KEPSEK'::role_type)
    );

-- STEP 2b — beri admin akses BACA observasi (untuk mengelola/void).
-- Admin sudah punya kebijakan DELETE (rls_observations_delete_administrative)
-- tapi belum SELECT — tak konsisten & bikin konsol admin kosong. Kepsek
-- sudah bisa baca via fn_is_schoolwide_observer(); admin belum.
DROP POLICY IF EXISTS rls_observations_read_administrative ON public.observations;
CREATE POLICY rls_observations_read_administrative ON public.observations
    FOR SELECT
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ADMINISTRATIVE'::role_type
    );

-- STEP 3 — sembunyikan observasi ter-void dari pembaca "subjek"
-- (siswa, orang tua, DUDI). Staf/admin tetap bisa melihat (untuk audit
-- + tampil di konsol dalam keadaan dicoret).

DROP POLICY IF EXISTS rls_observations_read_student ON public.observations;
CREATE POLICY rls_observations_read_student ON public.observations
    FOR SELECT
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'SISWA'::role_type
        AND visibility = 'STUDENT_VISIBLE'::visibility_level
        AND is_void = FALSE
        AND student_id = (SELECT s.student_id FROM students s WHERE s.user_id = fn_current_user_id())
    );

DROP POLICY IF EXISTS rls_observations_read_parent ON public.observations;
CREATE POLICY rls_observations_read_parent ON public.observations
    FOR SELECT
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'ORTU'::role_type
        AND visibility = 'STUDENT_VISIBLE'::visibility_level
        AND is_void = FALSE
        AND EXISTS (
            SELECT 1 FROM student_parents sp
            WHERE sp.student_id = observations.student_id
              AND sp.parent_user_id = fn_current_user_id()
        )
    );

DROP POLICY IF EXISTS rls_observations_read_dudi_own ON public.observations;
CREATE POLICY rls_observations_read_dudi_own ON public.observations
    FOR SELECT
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'DUDI'::role_type
        AND is_void = FALSE
        AND author_user_id = fn_current_user_id()
    );
