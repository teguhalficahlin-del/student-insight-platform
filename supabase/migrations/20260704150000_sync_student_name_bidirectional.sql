-- ============================================================
-- Migration 20260704150000: tambah trigger arah balik users → students
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS user_name_sync ON users;
--   DROP FUNCTION IF EXISTS public.trg_sync_user_name_to_student();
-- SNAPSHOT PRA-APPLY: -
-- ============================================================

-- P3-D: Trigger existing (20260704000000) hanya menyebarkan perubahan
-- students → users. Bila TU mengedit nama di tabel users langsung,
-- students.full_name tidak ikut berubah → data divergen antar portal.
-- Trigger ini menutup arah balik: users → students.

CREATE OR REPLACE FUNCTION public.trg_sync_user_name_to_student()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    IF NEW.full_name IS DISTINCT FROM OLD.full_name THEN
        UPDATE students
        SET full_name  = NEW.full_name,
            updated_at = NOW()
        WHERE user_id = NEW.user_id
          AND full_name IS DISTINCT FROM NEW.full_name;
    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_sync_user_name_to_student() IS
    'P3-D: arah balik users.full_name -> students.full_name. '
    'Melengkapi trg_sync_student_name_to_user (20260704000000) agar '
    'perubahan nama siswa dari jalur manapun tetap konsisten.';

DROP TRIGGER IF EXISTS user_name_sync ON users;
CREATE TRIGGER user_name_sync
    AFTER UPDATE OF full_name ON users
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_sync_user_name_to_student();
