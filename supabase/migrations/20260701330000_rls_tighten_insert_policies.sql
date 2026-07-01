-- ============================================================
-- FIX M1 (RESIDUAL-2) — Perketat 4 policy INSERT yang hanya
-- cek school_id tanpa cek peran.
-- ============================================================
-- Sebelum: rls_achievements_write, rls_cases_insert,
--          rls_case_events_insert_handler, rls_student_updates_insert
--          semua WITH CHECK (school_id = fn_current_school_id())
--          → SISWA/ORTU/DUDI/siapa pun bisa insert.
-- Selaras contracts/10_permission_engine.js:
--   achievements  → WALI_KELAS(kelasnya)/KAPRODI(programnya)/KEPSEK
--   cases         → GURU/KEPSEK/DUDI(siswa PKL yg dibimbing) (checkCaseCreate)
--   case_events   → hanya current handler kasus, kasus belum CLOSED (checkCaseAddComment)
--   student_updates → hanya current handler kasus, kasus belum CLOSED
-- rls_case_events_insert_kepsek TIDAK disentuh — sudah scoped KEPSEK.
-- current_handler_role masih dicocokkan literal role_type (bukan flag) —
-- pemetaan flag→handler_role adalah RESIDUAL-1 (H3 sisi-tulis), di luar
-- cakupan M1.
-- ============================================================

-- ── Helper baru: KEPSEK (role_type ATAU flag is_kepsek) ──────
CREATE OR REPLACE FUNCTION fn_is_kepsek()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM users u
        WHERE u.auth_user_id = auth.uid()
          AND (u.role_type = 'KEPSEK' OR u.is_kepsek)
    );
$$;

-- ── achievements: WALI_KELAS(kelasnya)/KAPRODI(programnya)/KEPSEK ──
DROP POLICY IF EXISTS rls_achievements_write ON achievements;
CREATE POLICY rls_achievements_write ON achievements FOR INSERT
    WITH CHECK (school_id = fn_current_school_id()
        AND recorded_by_user_id = fn_current_user_id()
        AND (fn_is_kepsek()
             OR fn_kaprodi_of_student(student_id)
             OR fn_wali_of_student(student_id)));

-- ── cases: GURU/KEPSEK/DUDI (DUDI hanya siswa PKL yang dibimbingnya) ──
DROP POLICY IF EXISTS rls_cases_insert ON cases;
CREATE POLICY rls_cases_insert ON cases FOR INSERT
    WITH CHECK (school_id = fn_current_school_id()
        AND created_by_user_id = fn_current_user_id()
        AND initiated_by_role = fn_current_user_role()
        AND fn_current_user_role() = ANY (ARRAY['GURU','KEPSEK','DUDI']::role_type[])
        AND (fn_current_user_role() <> 'DUDI'::role_type
             OR fn_dudi_supervises_student(student_id)));

-- ── case_events: hanya current handler kasus, kasus belum CLOSED ──
DROP POLICY IF EXISTS rls_case_events_insert_handler ON case_events;
CREATE POLICY rls_case_events_insert_handler ON case_events FOR INSERT
    WITH CHECK (school_id = fn_current_school_id()
        AND author_user_id = fn_current_user_id()
        AND author_role_at_time = fn_current_user_role()
        AND EXISTS (SELECT 1 FROM cases c
            WHERE c.case_id = case_events.case_id
              AND c.current_handler_role = fn_current_user_role()
              AND c.status <> 'CLOSED'::case_status));

-- ── student_updates: hanya current handler kasus, kasus belum CLOSED ──
DROP POLICY IF EXISTS rls_student_updates_insert ON student_updates;
CREATE POLICY rls_student_updates_insert ON student_updates FOR INSERT
    WITH CHECK (school_id = fn_current_school_id()
        AND author_user_id = fn_current_user_id()
        AND EXISTS (SELECT 1 FROM cases c
            WHERE c.case_id = student_updates.case_id
              AND c.current_handler_role = fn_current_user_role()
              AND c.status <> 'CLOSED'::case_status));
