-- Harden Kaprodi attendance and PKL workflows.
-- Keep all authorization decisions in the database; browser-side filters are
-- only presentation filters and must not be the security boundary.

BEGIN;

-- A Kaprodi may manage only students in the assigned program. School-wide
-- roles may manage students in their own school.
CREATE OR REPLACE FUNCTION public.fn_can_manage_pkl_student(p_student_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.users u
        JOIN public.students s ON s.student_id = p_student_id
        WHERE u.auth_user_id = auth.uid()
          AND u.school_id = public.fn_current_school_id()
          AND s.school_id = public.fn_current_school_id()
          AND (
              u.role_type IN ('ADMINISTRATIVE', 'KEPSEK')
              OR u.is_kepsek
              OR (
                  public.fn_kaprodi_program_id() IS NOT NULL
                  AND s.program_id = public.fn_kaprodi_program_id()
              )
          )
    );
$$;

REVOKE ALL ON FUNCTION public.fn_can_manage_pkl_student(uuid) FROM PUBLIC;

-- Class recap: return only the caller's permitted scope. The current school
-- year is the server-side default so a broad date range cannot mix years.
DROP FUNCTION IF EXISTS public.fn_attendance_recap_per_class(date, date);
CREATE FUNCTION public.fn_attendance_recap_per_class(
    p_date_start date DEFAULT NULL,
    p_date_end   date DEFAULT NULL
)
RETURNS TABLE (
    class_id uuid,
    name text,
    hadir bigint,
    alpa bigint,
    izin bigint,
    sakit bigint,
    total bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        c.class_id,
        c.name,
        COUNT(a.attendance_id) FILTER (WHERE a.status = 'HADIR') AS hadir,
        COUNT(a.attendance_id) FILTER (WHERE a.status = 'ALPA')  AS alpa,
        COUNT(a.attendance_id) FILTER (WHERE a.status = 'IZIN')  AS izin,
        COUNT(a.attendance_id) FILTER (WHERE a.status = 'SAKIT') AS sakit,
        COUNT(a.attendance_id) AS total
    FROM public.classes c
    LEFT JOIN public.teaching_schedules ts
           ON ts.class_id = c.class_id
          AND ts.school_id = public.fn_current_school_id()
          AND ts.academic_year = (
              SELECT sc.current_academic_year
              FROM public.school_config sc
              WHERE sc.school_id = public.fn_current_school_id()
          )
          AND (p_date_start IS NULL OR ts.session_date >= p_date_start)
          AND (p_date_end   IS NULL OR ts.session_date <= p_date_end)
    LEFT JOIN public.attendance a
           ON a.schedule_id = ts.schedule_id
          AND NOT a.is_void
    WHERE c.school_id = public.fn_current_school_id()
      AND c.is_active = TRUE
      AND (
          public.fn_current_user_role() = 'ADMINISTRATIVE'
          OR public.fn_is_schoolwide_observer()
          OR (
              public.fn_kaprodi_program_id() IS NOT NULL
              AND c.program_id = public.fn_kaprodi_program_id()
          )
      )
    GROUP BY c.class_id, c.name
    ORDER BY c.name;
$$;

REVOKE ALL ON FUNCTION public.fn_attendance_recap_per_class(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_attendance_recap_per_class(date, date) TO authenticated;

-- PKL recap: reject requests outside the caller's program/school scope.
CREATE OR REPLACE FUNCTION public.fn_pkl_attendance_recap(
    p_student_ids uuid[],
    p_date_start  date DEFAULT NULL,
    p_date_end    date DEFAULT NULL
)
RETURNS TABLE (
    student_id uuid,
    hadir bigint,
    alpa bigint,
    izin bigint,
    sakit bigint,
    total bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        s.student_id,
        COUNT(pa.pkl_attendance_id) FILTER (WHERE pa.status = 'HADIR') AS hadir,
        COUNT(pa.pkl_attendance_id) FILTER (WHERE pa.status = 'ALPA')  AS alpa,
        COUNT(pa.pkl_attendance_id) FILTER (WHERE pa.status = 'IZIN')  AS izin,
        COUNT(pa.pkl_attendance_id) FILTER (WHERE pa.status = 'SAKIT') AS sakit,
        COUNT(pa.pkl_attendance_id) AS total
    FROM unnest(p_student_ids) AS requested(student_id)
    JOIN public.students s
      ON s.student_id = requested.student_id
     AND s.school_id = public.fn_current_school_id()
     AND (
         public.fn_current_user_role() = 'ADMINISTRATIVE'
         OR public.fn_is_schoolwide_observer()
         OR (
             public.fn_kaprodi_program_id() IS NOT NULL
             AND s.program_id = public.fn_kaprodi_program_id()
         )
     )
    LEFT JOIN public.pkl_attendance pa
      ON pa.student_id = s.student_id
     AND pa.school_id = public.fn_current_school_id()
     AND (p_date_start IS NULL OR pa.attendance_date >= p_date_start)
     AND (p_date_end   IS NULL OR pa.attendance_date <= p_date_end)
    GROUP BY s.student_id;
$$;

REVOKE ALL ON FUNCTION public.fn_pkl_attendance_recap(uuid[], date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_pkl_attendance_recap(uuid[], date, date) TO authenticated;

-- Placement writes are restricted to school-wide managers or the Kaprodi of
-- the student's program. Both functions remain atomic and tenant-scoped.
CREATE OR REPLACE FUNCTION public.fn_create_placement(
    p_student_id   uuid,
    p_dudi_user_id uuid,
    p_start_date   date,
    p_end_date     date
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_school_id uuid := public.fn_current_school_id();
    v_student_program_id uuid;
BEGIN
    SELECT s.program_id
      INTO v_student_program_id
      FROM public.students s
     WHERE s.student_id = p_student_id
       AND s.school_id = v_school_id;

    IF v_student_program_id IS NULL
       OR NOT public.fn_can_manage_pkl_student(p_student_id) THEN
        RAISE EXCEPTION 'access_denied: pengguna tidak berwenang mengelola siswa ini';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.users d
        WHERE d.user_id = p_dudi_user_id
          AND d.school_id = v_school_id
          AND d.role_type = 'DUDI'
          AND (
              public.fn_current_user_role() IN ('ADMINISTRATIVE', 'KEPSEK')
              OR EXISTS (
                  SELECT 1
                  FROM public.users manager
                  WHERE manager.auth_user_id = auth.uid()
                    AND manager.is_kepsek
              )
              OR d.program_id = v_student_program_id
          )
    ) THEN
        RAISE EXCEPTION 'domain_invariant_violation: DUDI tidak ditemukan dalam cakupan pengguna';
    END IF;

    INSERT INTO public.pkl_placements (
        school_id, student_id, dudi_user_id, start_date, end_date, is_active
    )
    VALUES (v_school_id, p_student_id, p_dudi_user_id, p_start_date, p_end_date, true);

    UPDATE public.students
       SET student_status = 'PKL'
     WHERE student_id = p_student_id
       AND school_id = v_school_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_finish_placement(
    p_student_id   uuid,
    p_placement_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_school_id uuid := public.fn_current_school_id();
BEGIN
    IF NOT public.fn_can_manage_pkl_student(p_student_id) THEN
        RAISE EXCEPTION 'access_denied: pengguna tidak berwenang mengelola siswa ini';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.pkl_placements p
        WHERE p.placement_id = p_placement_id
          AND p.student_id = p_student_id
          AND p.school_id = v_school_id
          AND p.is_active = true
    ) THEN
        RAISE EXCEPTION 'domain_invariant_violation: placement aktif tidak ditemukan untuk siswa ini';
    END IF;

    UPDATE public.pkl_placements
       SET is_active = false
     WHERE placement_id = p_placement_id
       AND school_id = v_school_id;

    UPDATE public.students
       SET student_status = 'AKTIF'
     WHERE student_id = p_student_id
       AND school_id = v_school_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_create_placement(uuid, uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_create_placement(uuid, uuid, date, date) TO authenticated;
REVOKE ALL ON FUNCTION public.fn_finish_placement(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_finish_placement(uuid, uuid) TO authenticated;

COMMIT;
