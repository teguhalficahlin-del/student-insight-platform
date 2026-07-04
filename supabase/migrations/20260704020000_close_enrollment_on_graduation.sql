-- ============================================================
-- TEMUAN-3 lanjutan (Audit Referential Integrity 2026-07-04)
-- Alur Tutup Tahun (admin/js/tutup-tahun.js:onConfirmGraduation) menandai
-- siswa LULUS + graduated_at, TETAPI tidak menutup class_enrollments-nya
-- (withdrawn_at dibiarkan NULL). Akibat: alumni tetap tampak "terdaftar"
-- di kelas tahun lalu → melanggar invariant "withdrawn_at IS NULL =
-- masih terdaftar", dan kelas lama tidak pernah kosong (tak bisa diarsip).
--
-- Perbaikan:
--   B (preventif) : trigger — begitu student_status menjadi LULUS, seluruh
--                   enrolment terbuka siswa itu otomatis ditutup.
--   A (retroaktif): tutup enrolment terbuka semua siswa yang sudah LULUS,
--                   lalu arsipkan (is_active=FALSE) kelas tahun lampau yang
--                   kini tak punya enrolment terbuka.
-- withdrawn_at dijaga > enrolled_at (constraint chk_withdrawal_after_enrollment)
-- via GREATEST(..., enrolled_at + 1 detik).
-- ============================================================

-- ── B: trigger preventif ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_close_enrollment_on_graduation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    IF NEW.student_status = 'LULUS'
       AND OLD.student_status IS DISTINCT FROM 'LULUS' THEN
        UPDATE class_enrollments ce
        SET withdrawn_at = GREATEST(COALESCE(NEW.graduated_at, NOW()),
                                    ce.enrolled_at + INTERVAL '1 second'),
            updated_at   = NOW()
        WHERE ce.student_id = NEW.student_id
          AND ce.withdrawn_at IS NULL;
    END IF;
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trg_close_enrollment_on_graduation() IS
    'TEMUAN-3: saat siswa menjadi LULUS, tutup semua enrolment terbukanya '
    'agar invariant class_enrollments terjaga dan kelas lama bisa diarsip.';

DROP TRIGGER IF EXISTS student_graduation_close_enrollment ON students;

CREATE TRIGGER student_graduation_close_enrollment
    AFTER UPDATE OF student_status ON students
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_close_enrollment_on_graduation();

-- ── A1: rekonsiliasi enrolment alumni lama ──────────────────
UPDATE class_enrollments ce
SET withdrawn_at = GREATEST(COALESCE(s.graduated_at, NOW()),
                            ce.enrolled_at + INTERVAL '1 second'),
    updated_at   = NOW()
FROM students s
WHERE ce.student_id = s.student_id
  AND s.student_status = 'LULUS'
  AND ce.withdrawn_at IS NULL;

-- ── A2: arsipkan kelas tahun lampau yang kini kosong ────────
UPDATE classes c
SET is_active  = FALSE,
    updated_at = NOW()
WHERE c.is_active = TRUE
  AND NOT EXISTS (
        SELECT 1 FROM class_enrollments ce
        WHERE ce.class_id = c.class_id
          AND ce.withdrawn_at IS NULL
      )
  AND c.academic_year <> (
        SELECT sc.current_academic_year
        FROM school_config sc
        WHERE sc.school_id = c.school_id
      );
