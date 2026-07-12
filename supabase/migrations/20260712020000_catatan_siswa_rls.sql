-- Fase 2/2: Hapus data lama, drop tabel audience, buat fungsi
-- helper dan RLS baru untuk model catatan siswa.
-- Pembuat: GURU mapel yang mengajar siswa tersebut.
-- Audiens: SISWA_SAJA / ORTU_SAJA / SISWA_DAN_ORTU.

-- ── 1. Drop policy lama yang mereferensi observation_audience_members ─
DROP POLICY IF EXISTS rls_observations_read_staff    ON observations;
DROP POLICY IF EXISTS rls_observations_read_waka     ON observations;
DROP POLICY IF EXISTS rls_observations_read_student  ON observations;
DROP POLICY IF EXISTS rls_observations_read_parent   ON observations;
DROP POLICY IF EXISTS rls_observations_update_author ON observations;
DROP POLICY IF EXISTS rls_observations_insert        ON observations;
DROP POLICY IF EXISTS rls_observations_read_guru     ON observations;

-- ── 2. Hapus semua data observasi lama ───────────────────────
DELETE FROM observation_audience_members;
ALTER TABLE observations DISABLE TRIGGER USER;
DELETE FROM observations;
ALTER TABLE observations ENABLE TRIGGER USER;

-- ── 3. Drop tabel observation_audience_members ───────────────
DROP TABLE IF EXISTS observation_audience_members;

-- ── 4. Fungsi helper: cek guru mengajar siswa ini ────────────
CREATE OR REPLACE FUNCTION fn_guru_teaches_student(p_student_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM teaching_schedules ts
        JOIN class_enrollments  ce
          ON ce.class_id      = ts.class_id
         AND ce.academic_year  = ts.academic_year
        WHERE ts.scheduled_teacher_id = fn_current_user_id()
          AND ts.school_id            = fn_current_school_id()
          AND ce.student_id      = p_student_id
          AND ce.withdrawn_at   IS NULL
    );
$$;

REVOKE EXECUTE ON FUNCTION public.fn_guru_teaches_student(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_guru_teaches_student(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_guru_teaches_student(uuid) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.fn_guru_teaches_student(uuid) TO service_role;

-- ── 5. Buat RLS baru ─────────────────────────────────────────

-- INSERT: hanya GURU yang mengajar siswa tersebut
CREATE POLICY rls_observations_insert ON observations FOR INSERT
    WITH CHECK (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'GURU'
        AND author_user_id = fn_current_user_id()
        AND visibility = ANY (
            ARRAY['SISWA_SAJA','ORTU_SAJA','SISWA_DAN_ORTU']::visibility_level[]
        )
        AND fn_guru_teaches_student(student_id)
    );

-- SELECT guru: hanya bisa baca catatannya sendiri
CREATE POLICY rls_observations_read_guru ON observations FOR SELECT
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'GURU'
        AND author_user_id = fn_current_user_id()
    );

-- SELECT siswa: visibility SISWA_SAJA atau SISWA_DAN_ORTU
CREATE POLICY rls_observations_read_student ON observations FOR SELECT
    USING (
        fn_current_user_role() = 'SISWA'
        AND visibility = ANY (
            ARRAY['SISWA_SAJA','SISWA_DAN_ORTU']::visibility_level[]
        )
        AND EXISTS (
            SELECT 1 FROM students s
            WHERE s.student_id = observations.student_id
              AND s.user_id    = fn_current_user_id()
              AND s.school_id  = fn_current_school_id()
        )
    );

-- SELECT ortu: visibility ORTU_SAJA atau SISWA_DAN_ORTU
CREATE POLICY rls_observations_read_parent ON observations FOR SELECT
    USING (
        fn_current_user_role() = 'ORTU'
        AND visibility = ANY (
            ARRAY['ORTU_SAJA','SISWA_DAN_ORTU']::visibility_level[]
        )
        AND EXISTS (
            SELECT 1 FROM student_parents sp
            WHERE sp.student_id     = observations.student_id
              AND sp.parent_user_id = fn_current_user_id()
        )
    );

-- UPDATE: guru hanya update catatannya sendiri
CREATE POLICY rls_observations_update_author ON observations FOR UPDATE
    USING (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'GURU'
        AND author_user_id = fn_current_user_id()
    )
    WITH CHECK (
        school_id = fn_current_school_id()
        AND fn_current_user_role() = 'GURU'
        AND author_user_id = fn_current_user_id()
        AND visibility = ANY (
            ARRAY['SISWA_SAJA','ORTU_SAJA','SISWA_DAN_ORTU']::visibility_level[]
        )
    );
