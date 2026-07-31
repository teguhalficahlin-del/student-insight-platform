-- Fix: tambah guard school_id di fn_create_placement dan fn_finish_placement.
--
-- Kedua fungsi sebelumnya adalah SECURITY DEFINER tanpa validasi school_id —
-- setiap user authenticated bisa memanipulasi PKL siswa dari sekolah manapun.
--
-- Guard yang ditambahkan:
--   fn_create_placement : cek student ∈ sekolah caller + cek DUDI ∈ sekolah caller
--   fn_finish_placement : cek student ∈ sekolah caller + cek placement_id ↔ student_id cocok
--
-- Helper yang dipakai: fn_student_in_current_school(uuid) → boolean (sudah ada,
-- dipakai juga di rls_cases_insert, migration 20260707120000).
-- RETURNS void tidak berubah → tidak perlu DROP.

BEGIN;

CREATE OR REPLACE FUNCTION fn_create_placement(
    p_student_id   uuid,
    p_dudi_user_id uuid,
    p_start_date   date,
    p_end_date     date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF NOT fn_student_in_current_school(p_student_id) THEN
        RAISE EXCEPTION 'domain_invariant_violation: student tidak ditemukan di sekolah ini';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM users
        WHERE user_id  = p_dudi_user_id
          AND school_id = fn_current_school_id()
    ) THEN
        RAISE EXCEPTION 'domain_invariant_violation: DUDI tidak ditemukan di sekolah ini';
    END IF;

    INSERT INTO pkl_placements (student_id, dudi_user_id, start_date, end_date, is_active)
    VALUES (p_student_id, p_dudi_user_id, p_start_date, p_end_date, true);

    UPDATE students
    SET student_status = 'PKL'
    WHERE student_id = p_student_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION fn_create_placement(uuid, uuid, date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_create_placement(uuid, uuid, date, date) FROM anon;
GRANT  EXECUTE ON FUNCTION fn_create_placement(uuid, uuid, date, date) TO authenticated;


CREATE OR REPLACE FUNCTION fn_finish_placement(
    p_student_id   uuid,
    p_placement_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF NOT fn_student_in_current_school(p_student_id) THEN
        RAISE EXCEPTION 'domain_invariant_violation: student tidak ditemukan di sekolah ini';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pkl_placements
        WHERE placement_id = p_placement_id
          AND student_id   = p_student_id
    ) THEN
        RAISE EXCEPTION 'domain_invariant_violation: placement tidak ditemukan untuk siswa ini';
    END IF;

    UPDATE pkl_placements
    SET is_active = false
    WHERE placement_id = p_placement_id;

    UPDATE students
    SET student_status = 'AKTIF'
    WHERE student_id = p_student_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION fn_finish_placement(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION fn_finish_placement(uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION fn_finish_placement(uuid, uuid) TO authenticated;

COMMIT;
