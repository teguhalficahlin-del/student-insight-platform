BEGIN;

CREATE OR REPLACE FUNCTION public.fn_dudi_owns_placement(p_placement_id uuid, p_student_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT public.fn_current_user_role() = 'DUDI'
       AND EXISTS (
           SELECT 1 FROM public.pkl_placements pp
           JOIN public.students s ON s.student_id = pp.student_id AND s.school_id = pp.school_id
           WHERE pp.placement_id = p_placement_id AND pp.student_id = p_student_id
             AND pp.school_id = public.fn_current_school_id()
             AND pp.dudi_user_id = public.fn_current_user_id()
       );
$$;
GRANT EXECUTE ON FUNCTION public.fn_dudi_owns_placement(uuid, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_dudi_owns_placement(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_dudi_owns_placement(uuid, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.fn_dudi_can_record_attendance(p_placement_id uuid, p_student_id uuid, p_date date)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT public.fn_dudi_owns_placement(p_placement_id, p_student_id)
       AND p_date <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta')::date
       AND EXISTS (
           SELECT 1 FROM public.pkl_placements pp
           WHERE pp.placement_id = p_placement_id AND pp.is_active IS TRUE
             AND p_date BETWEEN pp.start_date AND pp.end_date
       );
$$;
GRANT EXECUTE ON FUNCTION public.fn_dudi_can_record_attendance(uuid, uuid, date) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_dudi_can_record_attendance(uuid, uuid, date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_dudi_can_record_attendance(uuid, uuid, date) FROM PUBLIC;

-- Return only the student identity needed for owned placement history, not a broader student directory.
CREATE OR REPLACE FUNCTION public.fn_dudi_placements()
RETURNS TABLE(placement_id uuid, student_id uuid, full_name text, nis text,
              start_date date, end_date date, is_active boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT pp.placement_id, pp.student_id, s.full_name::text, s.nis::text,
           pp.start_date, pp.end_date, pp.is_active
    FROM public.pkl_placements pp
    JOIN public.students s ON s.student_id = pp.student_id AND s.school_id = pp.school_id
    WHERE public.fn_current_user_role() = 'DUDI'
      AND pp.school_id = public.fn_current_school_id()
      AND pp.dudi_user_id = public.fn_current_user_id()
    ORDER BY pp.start_date, pp.placement_id;
$$;
GRANT EXECUTE ON FUNCTION public.fn_dudi_placements() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_dudi_placements() FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_dudi_placements() FROM PUBLIC;

DROP POLICY IF EXISTS rls_pkl_attendance_rw_dudi ON public.pkl_attendance;
DROP POLICY IF EXISTS rls_pkl_attendance_read_dudi ON public.pkl_attendance;
CREATE POLICY rls_pkl_attendance_read_dudi ON public.pkl_attendance FOR SELECT TO authenticated
    USING (school_id = fn_current_school_id() AND fn_dudi_owns_placement(placement_id, student_id));
DROP POLICY IF EXISTS rls_pkl_attendance_insert_dudi ON public.pkl_attendance;
CREATE POLICY rls_pkl_attendance_insert_dudi ON public.pkl_attendance FOR INSERT TO authenticated
    WITH CHECK (school_id = fn_current_school_id() AND recorded_by_user_id = fn_current_user_id()
        AND fn_dudi_can_record_attendance(placement_id, student_id, attendance_date));
DROP POLICY IF EXISTS rls_pkl_attendance_update_dudi ON public.pkl_attendance;
CREATE POLICY rls_pkl_attendance_update_dudi ON public.pkl_attendance FOR UPDATE TO authenticated
    USING (school_id = fn_current_school_id() AND fn_dudi_owns_placement(placement_id, student_id))
    WITH CHECK (school_id = fn_current_school_id() AND recorded_by_user_id = fn_current_user_id()
        AND fn_dudi_can_record_attendance(placement_id, student_id, attendance_date));

CREATE OR REPLACE FUNCTION public.trg_pkl_attendance_student_match()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_student_id uuid;
    v_school_id uuid;
BEGIN
    SELECT pp.student_id, pp.school_id INTO v_student_id, v_school_id
    FROM public.pkl_placements pp
    JOIN public.students s ON s.student_id = pp.student_id AND s.school_id = pp.school_id
    WHERE pp.placement_id = NEW.placement_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Penempatan PKL tidak ditemukan.' USING ERRCODE = '23503';
    END IF;
    IF NEW.student_id IS DISTINCT FROM v_student_id OR NEW.school_id IS DISTINCT FROM v_school_id THEN
        RAISE EXCEPTION 'Siswa atau sekolah tidak cocok dengan penempatan PKL.' USING ERRCODE = '23514';
    END IF;
    IF public.fn_current_user_role() = 'DUDI' THEN
        IF NOT public.fn_dudi_can_record_attendance(NEW.placement_id, NEW.student_id, NEW.attendance_date) THEN
            RAISE EXCEPTION 'Absensi hanya untuk penempatan aktif milik Anda, dalam periode PKL, dan bukan tanggal mendatang.'
                USING ERRCODE = '42501';
        END IF;
        IF TG_OP = 'UPDATE' AND (NEW.placement_id, NEW.student_id, NEW.school_id, NEW.attendance_date)
            IS DISTINCT FROM (OLD.placement_id, OLD.student_id, OLD.school_id, OLD.attendance_date) THEN
            RAISE EXCEPTION 'Identitas absensi PKL tidak dapat dipindahkan.' USING ERRCODE = '42501';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
GRANT EXECUTE ON FUNCTION public.trg_pkl_attendance_student_match() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.trg_pkl_attendance_student_match() FROM anon;
REVOKE EXECUTE ON FUNCTION public.trg_pkl_attendance_student_match() FROM PUBLIC;

DROP POLICY IF EXISTS rls_observations_read_dudi_own ON public.observations;
CREATE POLICY rls_observations_read_dudi_own ON public.observations FOR SELECT TO authenticated
    USING (school_id = fn_current_school_id() AND fn_current_user_role() = 'DUDI'
        AND author_user_id = fn_current_user_id() AND visibility = 'RESTRICTED' AND is_void = false);

DROP POLICY IF EXISTS rls_observations_insert_dudi ON public.observations;
CREATE POLICY rls_observations_insert_dudi ON public.observations FOR INSERT TO authenticated
    WITH CHECK (school_id = fn_current_school_id() AND fn_current_user_role() = 'DUDI'
        AND author_user_id = fn_current_user_id() AND visibility = 'RESTRICTED'
        AND EXISTS (
            SELECT 1 FROM public.fn_dudi_placements() pp
            WHERE pp.student_id = observations.student_id AND pp.is_active IS TRUE
              AND (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta')::date BETWEEN pp.start_date AND pp.end_date
        ));

COMMIT;
