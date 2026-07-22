-- ============================================================
-- SIP SMK: Role TU — fn_is_tu() + 6 RLS SELECT policy (2/2)
-- Dijalankan SETELAH 20260722040000 commit, karena PostgreSQL
-- melarang penggunaan enum value baru ('TU') dalam transaksi
-- yang sama dengan ALTER TYPE ADD VALUE (SQLSTATE 55P04).
--
-- Standing rules (audit-handoff §3a):
--   - SECURITY DEFINER: REVOKE FROM PUBLIC + REVOKE FROM anon
--   - Semua policy: school_id = fn_current_school_id()
--   - attendance isolation: via EXISTS → teaching_schedules.school_id
-- ============================================================

-- ── 1. Helper fn_is_tu() ──────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_is_tu()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM users u
        WHERE u.auth_user_id = auth.uid()
          AND u.role_type    = 'TU'
    );
$$;
REVOKE EXECUTE ON FUNCTION fn_is_tu() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_is_tu() FROM anon;
GRANT  EXECUTE ON FUNCTION fn_is_tu() TO authenticated;

-- ── 2. duty_schedules: TU bisa baca jadwal piket sekolahnya ───
CREATE POLICY rls_duty_schedules_read_tu ON duty_schedules
FOR SELECT USING (
    school_id = fn_current_school_id()
    AND fn_current_user_role() = 'TU'::role_type
);

-- ── 3. late_arrivals: TU bisa baca semua (semua tanggal) ──────
CREATE POLICY rls_late_arrivals_read_tu ON late_arrivals
FOR SELECT USING (
    school_id = fn_current_school_id()
    AND fn_current_user_role() = 'TU'::role_type
);

-- ── 4. attendance: rekap kehadiran, scoped via teaching_schedules ──
-- attendance tidak punya school_id; tenant isolation via EXISTS subquery.
CREATE POLICY rls_attendance_read_tu ON attendance
FOR SELECT USING (
    fn_current_user_role() = 'TU'::role_type
    AND is_void = FALSE
    AND EXISTS (
        SELECT 1 FROM teaching_schedules ts
        WHERE ts.schedule_id = attendance.schedule_id
          AND ts.school_id   = fn_current_school_id()
    )
);

-- ── 5. teaching_schedules: diperlukan untuk join rekap kehadiran ──
CREATE POLICY rls_schedules_read_tu ON teaching_schedules
FOR SELECT USING (
    school_id = fn_current_school_id()
    AND fn_current_user_role() = 'TU'::role_type
);

-- ── 6. users: nama guru piket (duty_schedules.user_id → users) ──
CREATE POLICY rls_users_read_tu ON users
FOR SELECT USING (
    school_id = fn_current_school_id()
    AND fn_current_user_role() = 'TU'::role_type
);

-- ── 7. students: nama siswa (late_arrivals.student_id → students) ──
CREATE POLICY rls_students_read_tu ON students
FOR SELECT USING (
    school_id = fn_current_school_id()
    AND fn_current_user_role() = 'TU'::role_type
);
