-- ============================================================
-- TEMUAN-2 (Audit Referential Integrity 2026-07-04)
-- Nama siswa tersimpan ganda: students.full_name (sumber akademik)
-- vs users.full_name (akun SISWA, disalin saat provisioning di
-- provision-student-accounts). Dua jalur edit terpisah
-- (updateStudent -> students, update-user-identifier -> users)
-- tidak saling sinkron => users.full_name bisa basi.
--
-- Perbaikan: students.full_name menjadi SUMBER TUNGGAL. Setiap kali
-- students.full_name berubah dan siswa punya akun (user_id NOT NULL),
-- baris users ikut ter-update dalam transaksi yang sama.
-- ============================================================

CREATE OR REPLACE FUNCTION public.trg_sync_student_name_to_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    IF NEW.full_name IS DISTINCT FROM OLD.full_name
       AND NEW.user_id IS NOT NULL THEN
        UPDATE users
        SET full_name = NEW.full_name,
            updated_at = NOW()
        WHERE user_id = NEW.user_id
          AND full_name IS DISTINCT FROM NEW.full_name;
    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_sync_student_name_to_user() IS
    'TEMUAN-2: propagasi students.full_name -> users.full_name untuk siswa berakun. '
    'Menjaga satu sumber kebenaran nama siswa.';

DROP TRIGGER IF EXISTS student_name_sync ON students;

CREATE TRIGGER student_name_sync
    AFTER UPDATE OF full_name ON students
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_sync_student_name_to_user();

-- Rekonsiliasi satu kali untuk data yang mungkin sudah divergen sebelum trigger ada.
UPDATE users u
SET full_name = s.full_name,
    updated_at = NOW()
FROM students s
WHERE s.user_id = u.user_id
  AND u.full_name IS DISTINCT FROM s.full_name;
