-- ============================================================
-- FIX RESIDUAL-1 (H3 sisi-TULIS) — flag rangkap-jabatan kini
-- diberi wewenang TULIS setara peran itu, bukan cuma BACA.
-- ============================================================
-- Data nyata (1 Juli): 5 GURU+is_bk, 10 GURU+kaprodi_program_id,
-- 30 GURU+wali_kelas_class_id — semuanya lolos H3-baca (migrasi
-- 280000) tapi ditolak tiap kali mencoba aksi tulis khas jabatan
-- itu karena policy WRITE masih keyed role_type literal saja.
--
-- Keputusan pemilik platform (dikonfirmasi):
--   * BK/Kepsek/Waka  → tulis sekolah-luas (blanket), sama seperti
--     kekuatan H3-baca yang sudah ada.
--   * Wali Kelas      → hanya kasus/data SISWA DI KELAS WALIANNYA.
--   * Kaprodi         → hanya kasus/data SISWA DI JURUSANNYA.
--     (Tak berubah dari yang sudah berjalan di UI kaprodi —
--      dropdown pemilihan siswa PKL sudah scoped per program_id;
--      RLS kini menutup celah agar sejalan dgn UI.)
-- ============================================================

-- ── Helper baru: role_type ATAU flag ─────────────────────────
CREATE OR REPLACE FUNCTION fn_is_bk()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM users u
        WHERE u.auth_user_id = auth.uid()
          AND (u.role_type = 'BK' OR u.is_bk)
    );
$$;

CREATE OR REPLACE FUNCTION fn_is_waka_kesiswaan()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM users u
        WHERE u.auth_user_id = auth.uid()
          AND (u.role_type = 'WAKA_KESISWAAN' OR u.is_waka_kesiswaan)
    );
$$;

CREATE OR REPLACE FUNCTION fn_is_waka_kurikulum()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM users u
        WHERE u.auth_user_id = auth.uid()
          AND (u.role_type = 'WAKA_KURIKULUM' OR u.is_waka_kurikulum)
    );
$$;

-- ── Helper: apakah aktor saat ini cocok dgn current_handler_role
--    kasus, baik via role_type literal (staf dedicated) MAUPUN via
--    flag (GURU rangkap-jabatan), dgn cakupan sesuai jabatan ─────
-- fn_wali_of_student/fn_kaprodi_of_student (migrasi 280000) sudah
-- otomatis mencakup baik role_type dedicated maupun flag GURU,
-- SCOPED ke kelas/jurusan siswa bersangkutan. GURU polos tak perlu
-- helper tambahan: role_type-nya sendiri sudah 'GURU' baik dia
-- berflag atau tidak, jadi match literal sudah benar.
CREATE OR REPLACE FUNCTION fn_matches_case_handler(p_handler_role role_type, p_student_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT fn_current_user_role() = p_handler_role
        OR (p_handler_role = 'BK'::role_type AND fn_is_bk())
        OR (p_handler_role = 'KEPSEK'::role_type AND fn_is_kepsek())
        OR (p_handler_role = 'WAKA_KESISWAAN'::role_type AND fn_is_waka_kesiswaan())
        OR (p_handler_role = 'WAKA_KURIKULUM'::role_type AND fn_is_waka_kurikulum())
        OR (p_handler_role = 'KAPRODI'::role_type AND fn_kaprodi_of_student(p_student_id))
        OR (p_handler_role = 'WALI_KELAS'::role_type AND fn_wali_of_student(p_student_id));
$$;

-- ════════════════════════════════════════════════════════════
-- Kelompok A — tulis blanket (Kepsek/Kaprodi/Waka Kesiswaan)
-- ════════════════════════════════════════════════════════════

-- students: Kepsek sekolah-luas, Kaprodi hanya jurusannya sendiri
-- (program_id kolom milik baris students itu sendiri — aman dipakai
--  langsung tanpa subquery self-reference).
DROP POLICY IF EXISTS rls_students_write_admin ON students;
CREATE POLICY rls_students_write_admin ON students FOR ALL
    USING (school_id = fn_current_school_id()
        AND (fn_is_kepsek() OR program_id = fn_kaprodi_program_id()))
    WITH CHECK (school_id = fn_current_school_id()
        AND (fn_is_kepsek() OR program_id = fn_kaprodi_program_id()));

-- class_enrollments: sama pola, scoped via fn_kaprodi_of_student
DROP POLICY IF EXISTS rls_enrollments_write_admin ON class_enrollments;
CREATE POLICY rls_enrollments_write_admin ON class_enrollments FOR ALL
    USING (school_id = fn_current_school_id()
        AND (fn_is_kepsek() OR fn_kaprodi_of_student(student_id)))
    WITH CHECK (school_id = fn_current_school_id()
        AND (fn_is_kepsek() OR fn_kaprodi_of_student(student_id)));

-- pkl_placements: sama pola (selaras UI kaprodi yg sudah scoped program_id)
DROP POLICY IF EXISTS rls_pkl_write_admin ON pkl_placements;
CREATE POLICY rls_pkl_write_admin ON pkl_placements FOR ALL
    USING (school_id = fn_current_school_id()
        AND (fn_is_kepsek() OR fn_kaprodi_of_student(student_id)))
    WITH CHECK (school_id = fn_current_school_id()
        AND (fn_is_kepsek() OR fn_kaprodi_of_student(student_id)));

-- achievements: pembatalan prestasi (void) — Kepsek/Kaprodi jurusannya
DROP POLICY IF EXISTS rls_achievements_void ON achievements;
CREATE POLICY rls_achievements_void ON achievements FOR UPDATE
    USING (school_id = fn_current_school_id()
        AND (fn_is_kepsek() OR fn_kaprodi_of_student(student_id)))
    WITH CHECK (school_id = fn_current_school_id()
        AND (fn_is_kepsek() OR fn_kaprodi_of_student(student_id)));

-- observations: tulis Waka Kesiswaan (role_type ATAU flag)
DROP POLICY IF EXISTS rls_observations_write_waka_kesiswaan ON observations;
CREATE POLICY rls_observations_write_waka_kesiswaan ON observations FOR INSERT
    WITH CHECK (school_id = fn_current_school_id() AND fn_is_waka_kesiswaan());

-- ════════════════════════════════════════════════════════════
-- Kelompok B — kasus: handler kasus sadar-flag, WALI_KELAS/KAPRODI
-- discope ke kelas/jurusan siswa bersangkutan (bukan blanket)
-- ════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS rls_cases_update_sync ON cases;
CREATE POLICY rls_cases_update_sync ON cases FOR UPDATE
    USING (school_id = fn_current_school_id()
        AND (fn_matches_case_handler(current_handler_role, student_id)
          OR (fn_is_kepsek() AND status <> 'CLOSED'::case_status)
          OR (current_setting('app.case_sync_active', true) = 'true')));

DROP POLICY IF EXISTS rls_case_events_insert_handler ON case_events;
CREATE POLICY rls_case_events_insert_handler ON case_events FOR INSERT
    WITH CHECK (school_id = fn_current_school_id()
        AND author_user_id = fn_current_user_id()
        AND author_role_at_time = fn_current_user_role()
        AND EXISTS (SELECT 1 FROM cases c
            WHERE c.case_id = case_events.case_id
              AND fn_matches_case_handler(c.current_handler_role, c.student_id)
              AND c.status <> 'CLOSED'::case_status));

DROP POLICY IF EXISTS rls_case_events_insert_kepsek ON case_events;
CREATE POLICY rls_case_events_insert_kepsek ON case_events FOR INSERT
    WITH CHECK (school_id = fn_current_school_id() AND fn_is_kepsek());

DROP POLICY IF EXISTS rls_student_updates_insert ON student_updates;
CREATE POLICY rls_student_updates_insert ON student_updates FOR INSERT
    WITH CHECK (school_id = fn_current_school_id()
        AND author_user_id = fn_current_user_id()
        AND EXISTS (SELECT 1 FROM cases c
            WHERE c.case_id = student_updates.case_id
              AND fn_matches_case_handler(c.current_handler_role, c.student_id)
              AND c.status <> 'CLOSED'::case_status));
