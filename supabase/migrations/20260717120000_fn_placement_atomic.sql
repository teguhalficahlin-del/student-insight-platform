-- fn_create_placement: atomic insert pkl_placements + update student_status
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
    INSERT INTO pkl_placements (student_id, dudi_user_id, start_date, end_date, is_active)
    VALUES (p_student_id, p_dudi_user_id, p_start_date, p_end_date, true);

    UPDATE students
    SET student_status = 'PKL'
    WHERE student_id = p_student_id;
END;
$$;

-- fn_finish_placement: atomic update pkl_placements + update student_status
CREATE OR REPLACE FUNCTION fn_finish_placement(
    p_student_id   uuid,
    p_placement_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE pkl_placements
    SET is_active = false
    WHERE placement_id = p_placement_id;

    UPDATE students
    SET student_status = 'AKTIF'
    WHERE student_id = p_student_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION fn_create_placement(uuid, uuid, date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION fn_create_placement(uuid, uuid, date, date) TO authenticated;

REVOKE EXECUTE ON FUNCTION fn_finish_placement(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION fn_finish_placement(uuid, uuid) TO authenticated;
