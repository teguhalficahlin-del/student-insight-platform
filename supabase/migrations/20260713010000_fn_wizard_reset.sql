-- ============================================================
-- fn_wizard_reset_students + fn_wizard_reset_schedules
--
-- SECURITY DEFINER untuk menghapus data dari wizard onboarding
-- tanpa melewati RLS client-side yang memblokir attendance
-- (policy dicabut di ABS-3) dan guru_wali_assignments
-- (policy hanya KEPSEK/WAKA, bukan ADMINISTRATIVE).
--
-- Dua fungsi terpisah karena scope dan FK-order berbeda.
-- Keduanya memverifikasi pemanggil = ADMINISTRATIVE sekolah ybs.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. fn_wizard_reset_students
--    Hapus semua data siswa (aktif) untuk satu sekolah,
--    atau subset jika p_student_ids diisi.
--
--    Urutan FK yang benar:
--      case_events (cascade dari cases) → cases
--      attendance → observations → teacher_journals
--      student_updates → pkl_attendance → pkl_placements
--      guru_wali_assignments (RESTRICT ke students)
--      class_enrollments → student_parents
--      users (akun portal siswa)
--      students
--
--    Return: jsonb { deleted_students int, auth_user_ids uuid[] }
--    Client wajib memanggil edge fn delete-user untuk tiap
--    auth_user_id agar akun auth.users ikut dihapus.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_wizard_reset_students(
    p_school_id    uuid,
    p_student_ids  uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_ids           uuid[];
    v_user_ids      uuid[];
    v_auth_ids      uuid[];
    v_deleted_count int;
BEGIN
    -- Verifikasi pemanggil adalah ADMINISTRATIVE sekolah ini
    IF fn_current_school_id() <> p_school_id THEN
        RAISE EXCEPTION 'Akses ditolak: bukan sekolah Anda.';
    END IF;
    IF fn_current_user_role() <> 'ADMINISTRATIVE' THEN
        RAISE EXCEPTION 'Akses ditolak: hanya ADMINISTRATIVE yang dapat mereset data siswa.';
    END IF;

    -- Kumpulkan student_ids target
    IF p_student_ids IS NULL THEN
        SELECT ARRAY_AGG(student_id) INTO v_ids
        FROM students WHERE school_id = p_school_id;
    ELSE
        SELECT ARRAY_AGG(student_id) INTO v_ids
        FROM students
        WHERE student_id = ANY(p_student_ids) AND school_id = p_school_id;
    END IF;

    IF v_ids IS NULL OR array_length(v_ids, 1) = 0 THEN
        RETURN jsonb_build_object('deleted_students', 0, 'auth_user_ids', '[]'::jsonb);
    END IF;

    -- Simpan user_id siswa (untuk hapus akun portal + ambil auth_user_id)
    SELECT ARRAY_AGG(user_id) INTO v_user_ids
    FROM students WHERE student_id = ANY(v_ids) AND user_id IS NOT NULL;

    IF v_user_ids IS NOT NULL AND array_length(v_user_ids, 1) > 0 THEN
        SELECT ARRAY_AGG(auth_user_id) INTO v_auth_ids
        FROM users WHERE user_id = ANY(v_user_ids) AND auth_user_id IS NOT NULL;
    END IF;

    -- ── Hapus data transaksional (urut FK) ──────────────────────

    -- Kasus: case_events cascade saat cases dihapus
    DELETE FROM cases
    WHERE student_id = ANY(v_ids) AND school_id = p_school_id;

    -- Absensi reguler
    DELETE FROM attendance
    WHERE student_id = ANY(v_ids) AND school_id = p_school_id;

    -- Observasi
    DELETE FROM observations
    WHERE student_id = ANY(v_ids) AND school_id = p_school_id;

    -- Jurnal guru yang terkait siswa
    DELETE FROM teacher_journals
    WHERE student_id = ANY(v_ids) AND school_id = p_school_id;

    -- Student updates
    DELETE FROM student_updates
    WHERE student_id = ANY(v_ids) AND school_id = p_school_id;

    -- PKL
    DELETE FROM pkl_attendance
    WHERE student_id = ANY(v_ids);

    DELETE FROM pkl_placements
    WHERE student_id = ANY(v_ids) AND school_id = p_school_id;

    -- Penugasan forum guru wali (FK RESTRICT ke students)
    DELETE FROM guru_wali_assignments
    WHERE student_id = ANY(v_ids) AND school_id = p_school_id;

    -- Byproduct impor: enrollmen & relasi ortu-siswa
    DELETE FROM class_enrollments
    WHERE student_id = ANY(v_ids);

    DELETE FROM student_parents
    WHERE student_id = ANY(v_ids);

    -- Posting forum siswa (FK RESTRICT ke users)
    IF v_user_ids IS NOT NULL THEN
        DELETE FROM forum_posts
        WHERE author_user_id = ANY(v_user_ids);
    END IF;

    -- Akun portal siswa (baris di tabel users)
    IF v_user_ids IS NOT NULL THEN
        DELETE FROM users WHERE user_id = ANY(v_user_ids) AND school_id = p_school_id;
    END IF;

    -- Baris siswa
    DELETE FROM students WHERE student_id = ANY(v_ids) AND school_id = p_school_id;
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

    RETURN jsonb_build_object(
        'deleted_students', v_deleted_count,
        'auth_user_ids',    COALESCE(to_jsonb(v_auth_ids), '[]'::jsonb)
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION fn_wizard_reset_students(uuid, uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_wizard_reset_students(uuid, uuid[]) FROM anon;
GRANT  EXECUTE ON FUNCTION fn_wizard_reset_students(uuid, uuid[]) TO authenticated;

COMMENT ON FUNCTION fn_wizard_reset_students IS
    'Reset data siswa dari wizard onboarding. Menghapus semua data transaksional '
    '(attendance, observasi, kasus, PKL, guru_wali) sebelum menghapus siswa. '
    'Hanya bisa dipanggil oleh ADMINISTRATIVE sekolah tersebut. '
    'Kembalikan auth_user_ids yang harus dihapus klien via edge fn delete-user.';


-- ────────────────────────────────────────────────────────────
-- 2. fn_wizard_reset_schedules
--    Hapus semua data jadwal untuk satu sekolah.
--
--    Urutan FK yang benar:
--      attendance (schedule_id RESTRICT ke teaching_schedules)
--      substitute_schedules (schedule_id RESTRICT)
--      observations dengan schedule_id (schedule_id RESTRICT)
--      teaching_schedules (assignment_id RESTRICT ke teaching_assignments)
--      schedule_templates (independen)
--      teaching_assignments (independen setelah teaching_schedules gone)
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_wizard_reset_schedules(
    p_school_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_schedule_ids  uuid[];
    v_deleted_sched int;
    v_deleted_tpl   int;
    v_deleted_asgn  int;
BEGIN
    -- Verifikasi pemanggil adalah ADMINISTRATIVE sekolah ini
    IF fn_current_school_id() <> p_school_id THEN
        RAISE EXCEPTION 'Akses ditolak: bukan sekolah Anda.';
    END IF;
    IF fn_current_user_role() <> 'ADMINISTRATIVE' THEN
        RAISE EXCEPTION 'Akses ditolak: hanya ADMINISTRATIVE yang dapat mereset jadwal.';
    END IF;

    -- Kumpulkan schedule_ids untuk hapus data yang RESTRICT ke teaching_schedules
    SELECT ARRAY_AGG(schedule_id) INTO v_schedule_ids
    FROM teaching_schedules WHERE school_id = p_school_id;

    IF v_schedule_ids IS NOT NULL AND array_length(v_schedule_ids, 1) > 0 THEN
        -- Absensi yang terkait sesi jadwal
        DELETE FROM attendance
        WHERE schedule_id = ANY(v_schedule_ids);

        -- Jadwal guru pengganti
        DELETE FROM substitute_schedules
        WHERE schedule_id = ANY(v_schedule_ids);

        -- Observasi yang terkait sesi jadwal
        DELETE FROM observations
        WHERE schedule_id = ANY(v_schedule_ids) AND school_id = p_school_id;
    END IF;

    -- Sesi jadwal konkret
    DELETE FROM teaching_schedules WHERE school_id = p_school_id;
    GET DIAGNOSTICS v_deleted_sched = ROW_COUNT;

    -- Template jadwal mingguan
    DELETE FROM schedule_templates WHERE school_id = p_school_id;
    GET DIAGNOSTICS v_deleted_tpl = ROW_COUNT;

    -- Penugasan mengajar
    DELETE FROM teaching_assignments WHERE school_id = p_school_id;
    GET DIAGNOSTICS v_deleted_asgn = ROW_COUNT;

    RETURN jsonb_build_object(
        'deleted_schedules',         v_deleted_sched,
        'deleted_templates',         v_deleted_tpl,
        'deleted_assignments',       v_deleted_asgn
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION fn_wizard_reset_schedules(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_wizard_reset_schedules(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION fn_wizard_reset_schedules(uuid) TO authenticated;

COMMENT ON FUNCTION fn_wizard_reset_schedules IS
    'Reset semua data jadwal dari wizard onboarding. Menghapus attendance/substitute/'
    'observations terkait sesi jadwal sebelum menghapus teaching_schedules, lalu '
    'schedule_templates dan teaching_assignments. '
    'Hanya bisa dipanggil oleh ADMINISTRATIVE sekolah tersebut.';


-- ────────────────────────────────────────────────────────────
-- 3. Tambah ADMINISTRATIVE ke policy delete bk_class_assignments
--    agar step 11 wizard (hapus penugasan BK) bisa berjalan
--    tanpa server-side function.
-- ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS rls_bk_class_write ON bk_class_assignments;
CREATE POLICY rls_bk_class_write ON bk_class_assignments FOR ALL
    USING  (school_id = fn_current_school_id()
            AND fn_current_user_role() IN ('KEPSEK','WAKA_KESISWAAN','ADMINISTRATIVE'))
    WITH CHECK (school_id = fn_current_school_id()
            AND fn_current_user_role() IN ('KEPSEK','WAKA_KESISWAAN','ADMINISTRATIVE'));
