-- ============================================================
-- Migration 20260824110000: Sprint D — RPC SECURITY DEFINER
--   fn_get_wali_kelas_user_id(p_class_id uuid)
--
-- MASALAH (dari audit SEC-P1):
--   parent/js/api.js:450 melakukan query langsung ke tabel users:
--     supabase.from('users')
--       .select('user_id')
--       .eq('wali_kelas_class_id', classId)
--       .eq('school_id', schoolId)
--       .eq('is_active', true)
--       .maybeSingle()
--
--   Tiga celah teridentifikasi:
--   1. Kolom wali_kelas_class_id sengaja dikecualikan dari
--      v_users_staff_directory, sehingga tidak bisa dimigrasi
--      ke view seperti Sprint A/B/C.
--   2. RLS policy (rls_users_read_staff_names) tidak membatasi
--      kolom — ORTU yang lolos policy bisa membaca semua kolom
--      users termasuk yang sensitif.
--   3. Bug laten: policy lolos hanya jika fn_has_teaching_schedule()
--      true — wali kelas yang tidak punya jadwal mengajar hari ini
--      tidak ditemukan meskipun wali_kelas_class_id cocok.
--
-- SOLUSI:
--   RPC SECURITY DEFINER yang:
--   (a) Memvalidasi caller adalah ORTU di tenant yang sama
--   (b) Memvalidasi p_class_id terkait anak ORTU pemanggil
--       via student_parents + class_enrollments
--   (c) Mengambil wali_kelas_class_id langsung — tidak bergantung
--       pada fn_has_teaching_schedule() (memperbaiki bug laten)
--   (d) Mengembalikan hanya user_id (shape minimal, tidak expose
--       kolom sensitif lain)
--
--   Disetujui Romo sebagai bagian Sprint D (24 Agustus 2026).
-- ============================================================

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
    v_result uuid;
BEGIN
    -- Guard: caller wajib ORTU di tenant yang sama
    IF (
        SELECT role_type
        FROM public.users
        WHERE auth_user_id = auth.uid()
          AND school_id = fn_current_school_id()
          AND role_type = 'ORTU'
          AND deleted_at IS NULL
        LIMIT 1
    ) IS NULL THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;

    -- Guard: p_class_id wajib terkait dengan anak ORTU pemanggil
    IF NOT EXISTS (
        SELECT 1
        FROM public.student_parents sp
        JOIN public.class_enrollments ce
          ON ce.student_id = sp.student_id
        WHERE sp.parent_user_id = auth.uid()
          AND sp.school_id = fn_current_school_id()
          AND ce.class_id = p_class_id
          AND ce.withdrawn_at IS NULL
    ) THEN
        RAISE EXCEPTION 'class not linked to parent'
        USING ERRCODE = '42501';
    END IF;

    -- Ambil wali kelas berdasarkan wali_kelas_class_id langsung
    -- (tidak pakai fn_has_teaching_schedule() — perbaikan bug laten)
    SELECT u.user_id INTO v_result
    FROM public.users u
    WHERE u.school_id = fn_current_school_id()
      AND u.wali_kelas_class_id = p_class_id
      AND u.is_active = true
      AND u.deleted_at IS NULL
    LIMIT 1;

    RETURN v_result; -- NULL jika tidak ada wali kelas
END;
$$;

-- Privilege: hanya authenticated; cabut dari anon dan PUBLIC
REVOKE EXECUTE ON FUNCTION public.fn_get_wali_kelas_user_id(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_get_wali_kelas_user_id(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.fn_get_wali_kelas_user_id(uuid) TO authenticated;

COMMIT;
