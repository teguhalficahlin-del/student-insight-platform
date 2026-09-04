-- Fix: fn_get_wali_kelas_user_id — guard pakai auth.uid() vs user_id
--
-- BUG: student_parents.parent_user_id menyimpan users.user_id,
--      tapi guard lama membandingkan dengan auth.uid() (= auth_user_id).
--      Akibat: guard selalu RAISE EXCEPTION 'class not linked to parent'
--      meski data relasi sudah benar.
--
-- FIX: resolve auth.uid() → users.user_id dulu via subquery,
--      baru bandingkan dengan sp.parent_user_id.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_get_wali_kelas_user_id(
    p_class_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_caller_user_id uuid;
    v_result         uuid;
BEGIN
    -- Resolve auth.uid() → users.user_id di tenant yang sama
    SELECT user_id INTO v_caller_user_id
    FROM public.users
    WHERE auth_user_id = auth.uid()
      AND school_id = fn_current_school_id()
      AND role_type = 'ORTU'
      AND deleted_at IS NULL
    LIMIT 1;

    -- Guard: caller wajib ORTU di tenant yang sama
    IF v_caller_user_id IS NULL THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    -- Guard: p_class_id wajib terkait dengan anak ORTU pemanggil
    -- Bandingkan dengan user_id (bukan auth.uid()) — ini fix utamanya
    IF NOT EXISTS (
        SELECT 1
        FROM public.student_parents sp
        JOIN public.class_enrollments ce
          ON ce.student_id = sp.student_id
        WHERE sp.parent_user_id = v_caller_user_id
          AND sp.school_id = fn_current_school_id()
          AND ce.class_id = p_class_id
          AND ce.withdrawn_at IS NULL
    ) THEN
        RAISE EXCEPTION 'class not linked to parent'
        USING ERRCODE = '42501';
    END IF;

    -- Ambil wali kelas
    SELECT u.user_id INTO v_result
    FROM public.users u
    WHERE u.school_id = fn_current_school_id()
      AND u.wali_kelas_class_id = p_class_id
      AND u.is_active = true
      AND u.deleted_at IS NULL
    LIMIT 1;

    RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_get_wali_kelas_user_id(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_get_wali_kelas_user_id(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_get_wali_kelas_user_id(uuid) TO authenticated;

COMMIT;
