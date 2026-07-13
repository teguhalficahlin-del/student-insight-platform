-- ============================================================
-- Fix fn_wizard_reset_students:
-- 1. teacher_journals tidak punya student_id — hapus dari fungsi
-- 2. student_updates tidak punya student_id — filter via case_id
--    dan harus dihapus sebelum case_events dan cases
-- ============================================================
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
    v_case_ids      uuid[];
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

    -- Simpan case_ids untuk hapus child tables sebelum cases
    SELECT ARRAY_AGG(case_id) INTO v_case_ids
    FROM cases WHERE student_id = ANY(v_ids) AND school_id = p_school_id;

    -- Simpan user_id siswa
    SELECT ARRAY_AGG(user_id) INTO v_user_ids
    FROM students WHERE student_id = ANY(v_ids) AND user_id IS NOT NULL;

    IF v_user_ids IS NOT NULL AND array_length(v_user_ids, 1) > 0 THEN
        SELECT ARRAY_AGG(auth_user_id) INTO v_auth_ids
        FROM users WHERE user_id = ANY(v_user_ids) AND auth_user_id IS NOT NULL;
    END IF;

    -- ── Hapus data transaksional (urut FK) ──────────────────────

    -- student_updates via case_id (tidak punya student_id)
    IF v_case_ids IS NOT NULL AND array_length(v_case_ids, 1) > 0 THEN
        DELETE FROM student_updates WHERE case_id = ANY(v_case_ids);
    END IF;

    -- Nonaktifkan trigger immutable pada case_events sementara
    ALTER TABLE case_events DISABLE TRIGGER trg_case_events_immutable;

    -- case_events dulu (RESTRICT ke cases)
    IF v_case_ids IS NOT NULL AND array_length(v_case_ids, 1) > 0 THEN
        DELETE FROM case_events WHERE case_id = ANY(v_case_ids);
    END IF;

    -- Aktifkan kembali trigger
    ALTER TABLE case_events ENABLE TRIGGER trg_case_events_immutable;

    -- Baru cases bisa dihapus
    DELETE FROM cases
    WHERE student_id = ANY(v_ids) AND school_id = p_school_id;

    -- Absensi reguler
    DELETE FROM attendance
    WHERE student_id = ANY(v_ids) AND school_id = p_school_id;

    -- Observasi
    DELETE FROM observations
    WHERE student_id = ANY(v_ids) AND school_id = p_school_id;

    -- PKL
    DELETE FROM pkl_attendance
    WHERE student_id = ANY(v_ids);

    DELETE FROM pkl_placements
    WHERE student_id = ANY(v_ids) AND school_id = p_school_id;

    -- Penugasan guru wali (RESTRICT ke students)
    DELETE FROM guru_wali_assignments
    WHERE student_id = ANY(v_ids) AND school_id = p_school_id;

    -- Relasi impor
    DELETE FROM class_enrollments
    WHERE student_id = ANY(v_ids);

    DELETE FROM student_parents
    WHERE student_id = ANY(v_ids);

    -- Posting forum siswa (RESTRICT ke users)
    IF v_user_ids IS NOT NULL THEN
        DELETE FROM forum_posts
        WHERE author_user_id = ANY(v_user_ids);
    END IF;

    -- Akun portal siswa
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
