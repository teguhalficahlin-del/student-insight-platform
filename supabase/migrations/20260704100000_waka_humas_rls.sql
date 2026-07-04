-- ============================================================
-- WAKA_HUMAS: fungsi helper, RLS, dan pagar ketat PKL
-- (Enum & kolom sudah ditambahkan di 20260704090000)
-- ============================================================

-- ── 1. Helper fn_is_waka_humas() ────────────────────────────
CREATE OR REPLACE FUNCTION fn_is_waka_humas()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM users u
        WHERE u.auth_user_id = auth.uid()
          AND (u.role_type = 'WAKA_HUMAS' OR u.is_waka_humas)
    );
$$;
GRANT EXECUTE ON FUNCTION fn_is_waka_humas() TO authenticated;

-- ── 2. Helper: apakah siswa sedang aktif PKL ────────────────
CREATE OR REPLACE FUNCTION fn_student_is_on_pkl(p_student_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM pkl_placements pp
        WHERE pp.student_id  = p_student_id
          AND pp.school_id   = fn_current_school_id()
          AND pp.start_date <= CURRENT_DATE
          AND (pp.end_date IS NULL OR pp.end_date >= CURRENT_DATE)
    );
$$;
GRANT EXECUTE ON FUNCTION fn_student_is_on_pkl(uuid) TO authenticated;

-- ── 3. Update fn_matches_case_handler — sertakan WAKA_HUMAS ─
CREATE OR REPLACE FUNCTION fn_matches_case_handler(p_handler_role role_type, p_student_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT fn_current_user_role() = p_handler_role
        OR (p_handler_role = 'BK'::role_type             AND fn_is_bk())
        OR (p_handler_role = 'KEPSEK'::role_type         AND fn_is_kepsek())
        OR (p_handler_role = 'WAKA_KESISWAAN'::role_type AND fn_is_waka_kesiswaan())
        OR (p_handler_role = 'WAKA_KURIKULUM'::role_type AND fn_is_waka_kurikulum())
        OR (p_handler_role = 'WAKA_HUMAS'::role_type     AND fn_is_waka_humas())
        OR (p_handler_role = 'KAPRODI'::role_type        AND fn_kaprodi_of_student(p_student_id))
        OR (p_handler_role = 'WALI_KELAS'::role_type     AND fn_wali_of_student(p_student_id));
$$;

-- ── 4. fn_get_stale_staff — sertakan is_waka_humas ──────────
CREATE OR REPLACE FUNCTION fn_get_stale_staff()
RETURNS TABLE (user_id uuid, full_name text, login_identifier text, teacher_code text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT u.user_id, u.full_name, u.login_identifier, u.teacher_code
    FROM   users u
    JOIN   school_config sc ON sc.school_id = fn_current_school_id()
    WHERE  u.school_id   = fn_current_school_id()
    AND    u.is_active   = TRUE
    AND    u.role_type   = 'GURU'
    AND    u.is_kepsek          IS NOT TRUE
    AND    u.is_bk              IS NOT TRUE
    AND    u.is_waka_kurikulum  IS NOT TRUE
    AND    u.is_waka_kesiswaan  IS NOT TRUE
    AND    u.is_waka_humas      IS NOT TRUE
    AND    u.wali_kelas_class_id IS NULL
    AND    u.kaprodi_program_id  IS NULL
    AND NOT EXISTS (
        SELECT 1 FROM teaching_assignments ta
        WHERE  ta.user_id       = u.user_id
        AND    ta.school_id     = fn_current_school_id()
        AND    ta.academic_year = sc.current_academic_year
    )
    ORDER BY u.full_name;
$$;
GRANT EXECUTE ON FUNCTION fn_get_stale_staff() TO authenticated;

-- ── 5. PKL placements: WAKA_HUMAS bisa baca & kelola ────────
DROP POLICY IF EXISTS rls_pkl_read_staff ON pkl_placements;
CREATE POLICY rls_pkl_read_staff ON pkl_placements FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY[
            'GURU','BK','WALI_KELAS','KAPRODI','KEPSEK','WAKA_HUMAS'
        ]::role_type[]));

DROP POLICY IF EXISTS rls_pkl_write_admin ON pkl_placements;
CREATE POLICY rls_pkl_write_admin ON pkl_placements FOR ALL
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['KAPRODI','KEPSEK','WAKA_HUMAS']::role_type[]))
    WITH CHECK (school_id = fn_current_school_id());

-- ── 6. PKL attendance: WAKA_HUMAS bisa baca;
--       WAKA_KESISWAAN DICABUT (pagar ketat) ─────────────────
DROP POLICY IF EXISTS rls_pkl_attendance_read_staff ON pkl_attendance;
CREATE POLICY rls_pkl_attendance_read_staff ON pkl_attendance FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY[
            'GURU','BK','WALI_KELAS','KAPRODI','KEPSEK','WAKA_HUMAS'
        ]::role_type[]));

-- ── 7. Users read: WAKA_HUMAS bisa baca staf & DUDI ─────────
DROP POLICY IF EXISTS rls_users_read_staff ON users;
CREATE POLICY rls_users_read_staff ON users FOR SELECT
    USING (
        school_id = fn_current_school_id()
        AND (
            (fn_current_user_role() = ANY (ARRAY[
                'GURU','BK','WALI_KELAS','KAPRODI','KEPSEK',
                'WAKA_KURIKULUM','WAKA_KESISWAAN','WAKA_HUMAS','ADMINISTRATIVE'
            ]::role_type[])
            AND role_type = ANY (ARRAY[
                'GURU','BK','WALI_KELAS','KAPRODI','KEPSEK',
                'WAKA_KURIKULUM','WAKA_KESISWAAN','WAKA_HUMAS','DUDI','ADMINISTRATIVE'
            ]::role_type[]))
            OR auth_user_id = auth.uid()
            OR (fn_current_user_role() = ANY (ARRAY[
                'GURU','BK','WALI_KELAS','KAPRODI','KEPSEK',
                'WAKA_KURIKULUM','WAKA_KESISWAAN','WAKA_HUMAS','ADMINISTRATIVE'
            ]::role_type[])
            AND role_type = ANY (ARRAY['SISWA','ORTU']::role_type[]))
        )
    );

-- ── 8. Pagar ketat PKL: observasi siswa aktif PKL ditolak ───
DROP POLICY IF EXISTS rls_observations_write_guru ON observations;
CREATE POLICY rls_observations_write_guru ON observations FOR INSERT
    WITH CHECK (
        school_id = fn_current_school_id()
        AND NOT fn_student_is_on_pkl(student_id)
        AND (
            fn_current_user_role() = ANY (ARRAY['GURU','BK','WALI_KELAS','KAPRODI']::role_type[])
            OR fn_is_bk()
            OR fn_is_waka_kesiswaan()
        )
    );

-- ── 9. Pagar ketat PKL: kasus siswa aktif PKL hanya via DUDI
DROP POLICY IF EXISTS rls_cases_insert ON cases;
CREATE POLICY rls_cases_insert ON cases FOR INSERT
    WITH CHECK (
        school_id = fn_current_school_id()
        AND (
            fn_current_user_role() = 'DUDI'::role_type
            OR (
                fn_current_user_role() = ANY (ARRAY[
                    'GURU','BK','WALI_KELAS','KAPRODI','KEPSEK','WAKA_KESISWAAN','WAKA_HUMAS'
                ]::role_type[])
                AND NOT fn_student_is_on_pkl(student_id)
            )
            OR (fn_is_bk()              AND NOT fn_student_is_on_pkl(student_id))
            OR (fn_is_kepsek()          AND NOT fn_student_is_on_pkl(student_id))
            OR (fn_is_waka_kesiswaan()  AND NOT fn_student_is_on_pkl(student_id))
        )
    );
