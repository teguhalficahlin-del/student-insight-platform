-- F-01: enforce tenant consistency for public.student_parents.
-- F-02: make student relationship helpers explicitly tenant-scoped.

CREATE OR REPLACE FUNCTION public.fn_validate_student_parent_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
    v_parent_role       role_type;
    v_parent_school_id  uuid;
    v_student_school_id uuid;
BEGIN
    IF NEW.school_id IS NULL THEN
        RAISE EXCEPTION 'student_parents_tenant_guard: school_id wajib diisi'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT u.role_type, u.school_id
      INTO v_parent_role, v_parent_school_id
    FROM public.users u
    WHERE u.user_id = NEW.parent_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'student_parents_tenant_guard: parent_user_id % tidak ditemukan di public.users', NEW.parent_user_id
            USING ERRCODE = 'P0001';
    END IF;

    IF v_parent_role IS DISTINCT FROM 'ORTU'::role_type THEN
        RAISE EXCEPTION
            'student_parents_tenant_guard: parent_user_id % harus memiliki role_type ORTU, ditemukan %',
            NEW.parent_user_id, v_parent_role
            USING ERRCODE = 'P0001';
    END IF;

    IF v_parent_school_id IS DISTINCT FROM NEW.school_id THEN
        RAISE EXCEPTION
            'student_parents_tenant_guard: school_id parent (%) tidak sama dengan school_id relasi (%)',
            v_parent_school_id, NEW.school_id
            USING ERRCODE = 'P0001';
    END IF;

    SELECT s.school_id
      INTO v_student_school_id
    FROM public.students s
    WHERE s.student_id = NEW.student_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION
            'student_parents_tenant_guard: student_id % tidak ditemukan di public.students', NEW.student_id
            USING ERRCODE = 'P0001';
    END IF;

    IF v_student_school_id IS DISTINCT FROM NEW.school_id THEN
        RAISE EXCEPTION
            'student_parents_tenant_guard: school_id siswa (%) tidak sama dengan school_id relasi (%)',
            v_student_school_id, NEW.school_id
            USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_validate_student_parent_tenant() TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_validate_student_parent_tenant() TO service_role;
REVOKE EXECUTE ON FUNCTION public.fn_validate_student_parent_tenant() FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_validate_student_parent_tenant() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_validate_student_parent_tenant ON public.student_parents;
CREATE TRIGGER trg_validate_student_parent_tenant
BEFORE INSERT OR UPDATE ON public.student_parents
FOR EACH ROW
EXECUTE FUNCTION public.fn_validate_student_parent_tenant();

CREATE OR REPLACE FUNCTION public.fn_teaches_student(p_student_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $function$
    SELECT public.fn_student_in_current_school(p_student_id)
       AND EXISTS (
            SELECT 1
            FROM public.class_enrollments ce
            JOIN public.teaching_assignments ta
              ON ta.class_id = ce.class_id
             AND ta.school_id = ce.school_id
            WHERE ce.student_id = p_student_id
              AND ce.school_id = public.fn_current_school_id()
              AND ta.school_id = public.fn_current_school_id()
              AND ta.user_id = public.fn_current_user_id()
              AND ta.is_active = TRUE
              AND ce.withdrawn_at IS NULL
       );
$function$;

GRANT EXECUTE ON FUNCTION public.fn_teaches_student(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_teaches_student(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.fn_teaches_student(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_teaches_student(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.fn_wali_of_student(p_student_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $function$
    SELECT public.fn_student_in_current_school(p_student_id)
       AND public.fn_wali_kelas_class_id() IS NOT NULL
       AND EXISTS (
            SELECT 1
            FROM public.class_enrollments ce
            WHERE ce.student_id = p_student_id
              AND ce.school_id = public.fn_current_school_id()
              AND ce.class_id = public.fn_wali_kelas_class_id()
              AND ce.withdrawn_at IS NULL
       );
$function$;

GRANT EXECUTE ON FUNCTION public.fn_wali_of_student(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_wali_of_student(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.fn_wali_of_student(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_wali_of_student(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.fn_kaprodi_of_student(p_student_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $function$
    SELECT public.fn_student_in_current_school(p_student_id)
       AND public.fn_kaprodi_program_id() IS NOT NULL
       AND EXISTS (
            SELECT 1
            FROM public.students s
            WHERE s.student_id = p_student_id
              AND s.school_id = public.fn_current_school_id()
              AND s.program_id = public.fn_kaprodi_program_id()
       );
$function$;

GRANT EXECUTE ON FUNCTION public.fn_kaprodi_of_student(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_kaprodi_of_student(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.fn_kaprodi_of_student(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_kaprodi_of_student(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.fn_dudi_supervises_student(p_student_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $function$
    SELECT public.fn_student_in_current_school(p_student_id)
       AND EXISTS (
            SELECT 1
            FROM public.pkl_placements pp
            WHERE pp.student_id = p_student_id
              AND pp.school_id = public.fn_current_school_id()
              AND pp.dudi_user_id = public.fn_current_user_id()
              AND pp.is_active = TRUE
       );
$function$;

GRANT EXECUTE ON FUNCTION public.fn_dudi_supervises_student(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_dudi_supervises_student(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.fn_dudi_supervises_student(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_dudi_supervises_student(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.fn_can_see_student(p_student_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $function$
    SELECT public.fn_student_in_current_school(p_student_id)
       AND (
            public.fn_is_schoolwide_observer()
         OR public.fn_teaches_student(p_student_id)
         OR public.fn_wali_of_student(p_student_id)
         OR public.fn_kaprodi_of_student(p_student_id)
       );
$function$;

GRANT EXECUTE ON FUNCTION public.fn_can_see_student(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_can_see_student(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.fn_can_see_student(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_can_see_student(uuid) FROM PUBLIC;
