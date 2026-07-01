-- ============================================================
-- FIX H1 + H2 + H3 — Isolasi baca staf pada data siswa sensitif
-- ============================================================
-- Model akses (dikonfirmasi pemilik platform, opsi A):
--   * Guru        → siswa yang DIA AJAR (via teaching_assignments)
--   * Wali Kelas  → + seluruh siswa kelas waliannya
--   * Kaprodi     → + seluruh siswa program keahliannya
--   * BK/Kepsek/Waka → seluruh siswa se-sekolah (via role_type ATAU flag)
--   * ADMINISTRATIVE, ORTU, SISWA, DUDI → kebijakan sendiri (tak diubah)
--
-- H1: sebelumnya rls_*_read_staff memberi GURU (termasuk wali/kaprodi
--     yang ber-role_type GURU) akses BLANKET ke observasi/kasus/absensi/
--     prestasi/enrolmen/pkl seluruh sekolah.
-- H2: fn_kaprodi_program_id() membaca kolom salah (program_id) →
--     diperbaiki ke kaprodi_program_id (fallback program_id utk role KAPRODI).
-- H3: flag is_bk/is_kepsek/is_waka_* tak pernah dibaca RLS →
--     fn_is_schoolwide_observer() kini membaca role_type ATAU flag.
-- ============================================================

-- ── H2: perbaiki kolom kaprodi ────────────────────────────────
CREATE OR REPLACE FUNCTION fn_kaprodi_program_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT COALESCE(kaprodi_program_id,
                    CASE WHEN role_type = 'KAPRODI' THEN program_id END)
    FROM users WHERE auth_user_id = auth.uid();
$$;

-- ── H3: pengamat se-sekolah (role_type ATAU flag) ─────────────
CREATE OR REPLACE FUNCTION fn_is_schoolwide_observer()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM users u
        WHERE u.auth_user_id = auth.uid()
          AND ( u.role_type IN ('BK','KEPSEK','WAKA_KURIKULUM','WAKA_KESISWAAN')
                OR u.is_bk OR u.is_kepsek OR u.is_waka_kurikulum OR u.is_waka_kesiswaan )
    );
$$;

-- ── Cakupan guru: siswa yang diajar ──────────────────────────
CREATE OR REPLACE FUNCTION fn_teaches_student(p_student_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM class_enrollments ce
        JOIN teaching_assignments ta ON ta.class_id = ce.class_id
        WHERE ce.student_id = p_student_id
          AND ta.user_id = fn_current_user_id()
          AND ta.is_active = true
          AND ce.withdrawn_at IS NULL
    );
$$;

-- ── Cakupan wali kelas: siswa kelas waliannya ────────────────
CREATE OR REPLACE FUNCTION fn_wali_of_student(p_student_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT fn_wali_kelas_class_id() IS NOT NULL AND EXISTS (
        SELECT 1 FROM class_enrollments ce
        WHERE ce.student_id = p_student_id
          AND ce.class_id = fn_wali_kelas_class_id()
          AND ce.withdrawn_at IS NULL
    );
$$;

-- ── Cakupan kaprodi: siswa program keahliannya ───────────────
CREATE OR REPLACE FUNCTION fn_kaprodi_of_student(p_student_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT fn_kaprodi_program_id() IS NOT NULL AND EXISTS (
        SELECT 1 FROM students s
        WHERE s.student_id = p_student_id
          AND s.program_id = fn_kaprodi_program_id()
    );
$$;

-- ── Gabungan: bolehkah staf melihat siswa ini ────────────────
CREATE OR REPLACE FUNCTION fn_can_see_student(p_student_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT fn_is_schoolwide_observer()
        OR fn_teaches_student(p_student_id)
        OR fn_wali_of_student(p_student_id)
        OR fn_kaprodi_of_student(p_student_id);
$$;

-- ============================================================
-- Kebijakan baca staf terpadu per tabel (drop lama → create baru)
-- ============================================================

-- ── students ──────────────────────────────────────────────────
DROP POLICY IF EXISTS rls_students_read_staff   ON students;
DROP POLICY IF EXISTS rls_students_read_kaprodi ON students;
DROP POLICY IF EXISTS rls_students_read_wali    ON students;
DROP POLICY IF EXISTS rls_students_read_waka    ON students;
CREATE POLICY rls_students_read_staff ON students FOR SELECT
    USING (school_id = fn_current_school_id() AND fn_can_see_student(student_id));

-- ── observations (+ penulis boleh baca miliknya) ─────────────
DROP POLICY IF EXISTS rls_observations_read_staff ON observations;
DROP POLICY IF EXISTS rls_observations_read_waka  ON observations;
CREATE POLICY rls_observations_read_staff ON observations FOR SELECT
    USING (school_id = fn_current_school_id()
           AND (fn_can_see_student(student_id) OR author_user_id = fn_current_user_id()));

-- ── cases (+ pernah terlibat boleh baca) ─────────────────────
DROP POLICY IF EXISTS rls_cases_read_admin ON cases;
DROP POLICY IF EXISTS rls_cases_read_guru  ON cases;
CREATE POLICY rls_cases_read_staff ON cases FOR SELECT
    USING (school_id = fn_current_school_id()
           AND (fn_can_see_student(student_id) OR fn_involved_in_case(case_id)));

-- ── achievements ─────────────────────────────────────────────
DROP POLICY IF EXISTS rls_achievements_read_staff ON achievements;
CREATE POLICY rls_achievements_read_staff ON achievements FOR SELECT
    USING (school_id = fn_current_school_id() AND fn_can_see_student(student_id));

-- ── attendance ───────────────────────────────────────────────
DROP POLICY IF EXISTS rls_attendance_read_staff ON attendance;
DROP POLICY IF EXISTS rls_attendance_read_waka  ON attendance;
DROP POLICY IF EXISTS rls_attendance_read_wali  ON attendance;
CREATE POLICY rls_attendance_read_staff ON attendance FOR SELECT
    USING (school_id = fn_current_school_id() AND is_void = false
           AND fn_can_see_student(student_id));

-- ── class_enrollments ────────────────────────────────────────
DROP POLICY IF EXISTS rls_enrollments_read_staff ON class_enrollments;
DROP POLICY IF EXISTS rls_enrollments_read_waka  ON class_enrollments;
CREATE POLICY rls_enrollments_read_staff ON class_enrollments FOR SELECT
    USING (school_id = fn_current_school_id() AND fn_can_see_student(student_id));

-- ── pkl_placements ───────────────────────────────────────────
DROP POLICY IF EXISTS rls_pkl_read_staff   ON pkl_placements;
DROP POLICY IF EXISTS rls_pkl_read_kaprodi ON pkl_placements;
CREATE POLICY rls_pkl_read_staff ON pkl_placements FOR SELECT
    USING (school_id = fn_current_school_id() AND fn_can_see_student(student_id));
