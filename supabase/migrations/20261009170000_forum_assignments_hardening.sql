-- Append after the latest migration; no existing assignments are rewritten.
CREATE OR REPLACE FUNCTION public.fn_get_forum_bk_staff()
RETURNS TABLE(user_id uuid, full_name text, role_type text, login_identifier text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT u.user_id, u.full_name::text, u.role_type::text, u.login_identifier::text
    FROM public.users u
    WHERE u.school_id = public.fn_current_school_id()
      AND u.is_active IS TRUE
      AND u.deleted_at IS NULL
      AND (u.role_type = 'BK' OR u.is_bk IS TRUE)
      AND u.role_type NOT IN ('SISWA', 'ORTU', 'DUDI', 'STAKEHOLDER')
      AND EXISTS (
          SELECT 1 FROM public.users caller
          WHERE caller.auth_user_id = auth.uid()
            AND caller.school_id = u.school_id
            AND caller.role_type = 'ADMINISTRATIVE'
            AND caller.is_active IS TRUE
            AND caller.deleted_at IS NULL
      )
    ORDER BY u.full_name;
$$;
GRANT EXECUTE ON FUNCTION public.fn_get_forum_bk_staff() TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.fn_get_forum_bk_staff() FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_get_forum_bk_staff() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.fn_guard_forum_assignment_tenant()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid;
BEGIN
    -- Allow revoking legacy bad references, but never their reactivation.
    IF TG_OP = 'UPDATE' THEN
        IF NEW.is_active IS FALSE
           AND (to_jsonb(NEW) - 'is_active') = (to_jsonb(OLD) - 'is_active') THEN
            RETURN NEW;
        END IF;
    END IF;

    CASE TG_TABLE_NAME
        WHEN 'bk_class_assignments' THEN
            v_user_id := NEW.bk_user_id;
            IF NOT EXISTS (
                SELECT 1 FROM public.classes c
                WHERE c.class_id = NEW.class_id AND c.school_id = NEW.school_id
            ) THEN
                RAISE EXCEPTION 'Kelas penugasan harus berada di sekolah yang sama.' USING ERRCODE = '23514';
            END IF;
        WHEN 'guru_wali_assignments' THEN
            v_user_id := NEW.guru_user_id;
            IF NOT EXISTS (
                SELECT 1 FROM public.students s
                WHERE s.student_id = NEW.student_id AND s.school_id = NEW.school_id
            ) THEN
                RAISE EXCEPTION 'Siswa penugasan harus berada di sekolah yang sama.' USING ERRCODE = '23514';
            END IF;
        WHEN 'duty_schedules' THEN
            v_user_id := NEW.user_id;
        ELSE
            RAISE EXCEPTION 'Tabel penugasan tidak didukung.' USING ERRCODE = '23514';
    END CASE;

    IF NOT EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.user_id = v_user_id AND u.school_id = NEW.school_id
    ) THEN
        RAISE EXCEPTION 'Staf penugasan harus berada di sekolah yang sama.' USING ERRCODE = '23514';
    END IF;
    IF NEW.assigned_by_user_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.user_id = NEW.assigned_by_user_id AND u.school_id = NEW.school_id
    ) THEN
        RAISE EXCEPTION 'Pemberi penugasan harus berada di sekolah yang sama.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_guard_forum_assignment_tenant() TO service_role;
REVOKE EXECUTE ON FUNCTION public.fn_guard_forum_assignment_tenant() FROM authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.fn_guard_forum_assignment_tenant() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_forum_assignment_tenant ON public.bk_class_assignments;
CREATE TRIGGER trg_forum_assignment_tenant
BEFORE INSERT OR UPDATE ON public.bk_class_assignments
FOR EACH ROW EXECUTE FUNCTION public.fn_guard_forum_assignment_tenant();
DROP TRIGGER IF EXISTS trg_forum_assignment_tenant ON public.guru_wali_assignments;
CREATE TRIGGER trg_forum_assignment_tenant
BEFORE INSERT OR UPDATE ON public.guru_wali_assignments
FOR EACH ROW EXECUTE FUNCTION public.fn_guard_forum_assignment_tenant();
DROP TRIGGER IF EXISTS trg_forum_assignment_tenant ON public.duty_schedules;
CREATE TRIGGER trg_forum_assignment_tenant
BEFORE INSERT OR UPDATE ON public.duty_schedules
FOR EACH ROW EXECUTE FUNCTION public.fn_guard_forum_assignment_tenant();

CREATE OR REPLACE FUNCTION public.fn_get_forum_member_details(
    p_class_id uuid, p_academic_year text
)
RETURNS TABLE(user_id uuid, full_name text, role_type text, student_name text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_school_id uuid;
    v_program_id uuid;
    v_caller_school_id uuid := public.fn_current_school_id();
BEGIN
    SELECT c.school_id, c.program_id INTO v_school_id, v_program_id
    FROM public.classes c WHERE c.class_id = p_class_id;
    IF v_caller_school_id IS NULL OR v_school_id IS DISTINCT FROM v_caller_school_id THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT DISTINCT u.user_id, u.full_name::text, u.role_type::text, NULL::text
    FROM public.users u
    WHERE u.wali_kelas_class_id = p_class_id
      AND u.school_id = v_school_id AND u.is_active IS TRUE AND u.deleted_at IS NULL
      AND u.role_type NOT IN ('DUDI', 'SISWA', 'STAKEHOLDER')
    UNION
    SELECT DISTINCT u.user_id, u.full_name::text, u.role_type::text, NULL::text
    FROM public.teaching_assignments ta JOIN public.users u ON u.user_id = ta.user_id
    WHERE ta.class_id = p_class_id AND ta.academic_year = p_academic_year
      AND ta.is_active IS TRUE AND ta.school_id = v_school_id
      AND u.school_id = v_school_id AND u.is_active IS TRUE AND u.deleted_at IS NULL
      AND u.role_type NOT IN ('DUDI', 'SISWA', 'STAKEHOLDER')
    UNION
    SELECT DISTINCT u.user_id, u.full_name::text, u.role_type::text, NULL::text
    FROM public.guru_wali_assignments gwa JOIN public.users u ON u.user_id = gwa.guru_user_id
    WHERE gwa.academic_year = p_academic_year AND gwa.is_active IS TRUE
      AND gwa.school_id = v_school_id
      AND u.school_id = v_school_id AND u.is_active IS TRUE AND u.deleted_at IS NULL
      AND u.role_type NOT IN ('DUDI', 'SISWA', 'STAKEHOLDER')
      AND gwa.student_id IN (
          SELECT ce.student_id FROM public.class_enrollments ce
          WHERE ce.class_id = p_class_id AND ce.academic_year = p_academic_year
            AND ce.withdrawn_at IS NULL AND ce.school_id = v_school_id
      )
    UNION
    SELECT DISTINCT u.user_id, u.full_name::text, u.role_type::text, NULL::text
    FROM public.bk_class_assignments bca JOIN public.users u ON u.user_id = bca.bk_user_id
    WHERE bca.class_id = p_class_id AND bca.academic_year = p_academic_year
      AND bca.is_active IS TRUE AND bca.school_id = v_school_id
      AND u.school_id = v_school_id AND u.is_active IS TRUE AND u.deleted_at IS NULL
      AND u.role_type NOT IN ('DUDI', 'SISWA', 'STAKEHOLDER')
    UNION
    SELECT DISTINCT u.user_id, u.full_name::text, u.role_type::text, NULL::text
    FROM public.users u
    WHERE u.school_id = v_school_id AND u.is_active IS TRUE AND u.deleted_at IS NULL
      AND u.role_type NOT IN ('DUDI', 'SISWA', 'STAKEHOLDER')
      AND (u.role_type IN ('WAKA_KESISWAAN', 'KEPSEK', 'ADMINISTRATIVE')
           OR u.is_waka_kesiswaan IS TRUE OR u.is_kepsek IS TRUE)
    UNION
    SELECT DISTINCT u.user_id, u.full_name::text, u.role_type::text, NULL::text
    FROM public.users u
    WHERE u.school_id = v_school_id AND u.is_active IS TRUE AND u.deleted_at IS NULL
      AND v_program_id IS NOT NULL
      AND u.role_type NOT IN ('DUDI', 'SISWA', 'STAKEHOLDER')
      AND (u.program_id = v_program_id OR u.kaprodi_program_id = v_program_id)
    UNION
    SELECT DISTINCT u.user_id, u.full_name::text, u.role_type::text, s.full_name::text
    FROM public.student_parents sp
    JOIN public.students s ON s.student_id = sp.student_id
    JOIN public.class_enrollments ce ON ce.student_id = s.student_id
    JOIN public.users u ON u.user_id = sp.parent_user_id
    WHERE ce.class_id = p_class_id AND ce.academic_year = p_academic_year
      AND ce.withdrawn_at IS NULL AND ce.school_id = v_school_id
      AND sp.school_id = v_school_id AND s.school_id = v_school_id
      AND s.student_status = 'AKTIF'
      AND u.school_id = v_school_id AND u.is_active IS TRUE AND u.deleted_at IS NULL
    ORDER BY full_name;
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_get_forum_member_details(uuid, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.fn_get_forum_member_details(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_get_forum_member_details(uuid, text) FROM PUBLIC;
