-- ============================================================
-- Migration 20260702220000: Alumni karir + status KELUAR + retensi
--
-- 10.4 — Tracking karir alumni pasca lulus
-- 10.5 — Status KELUAR (drop-out) + re-enroll kembali ke AKTIF
-- 10.6 — Kolom anonymized_at untuk retensi / hapus data
-- ============================================================

-- 10.4: Karir alumni
ALTER TABLE students
    ADD COLUMN IF NOT EXISTS alumni_career_track TEXT
        CHECK (alumni_career_track IN ('KULIAH','KERJA','WIRAUSAHA','TIDAK_DIKETAHUI'))
        DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS alumni_career_note  TEXT DEFAULT NULL;

COMMENT ON COLUMN students.alumni_career_track IS
    'Jalur karir alumnus setelah lulus: KULIAH/KERJA/WIRAUSAHA/TIDAK_DIKETAHUI.';
COMMENT ON COLUMN students.alumni_career_note IS
    'Catatan bebas tentang karir/aktivitas alumnus.';

-- 10.5: Status KELUAR untuk siswa drop-out
-- student_status sudah TEXT — cukup dokumentasi nilai yang valid:
-- AKTIF | PKL | LULUS | KELUAR
-- Kolom keluar_at agar bisa dilacak kapan siswa keluar.
ALTER TABLE students
    ADD COLUMN IF NOT EXISTS keluar_at   TIMESTAMPTZ DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS keluar_note TEXT        DEFAULT NULL;

COMMENT ON COLUMN students.keluar_at   IS 'Tanggal siswa dinyatakan KELUAR (drop-out / pindah sekolah).';
COMMENT ON COLUMN students.keluar_note IS 'Alasan siswa keluar sekolah.';

-- 10.6: Retensi data — tandai alumni yang datanya sudah dianonimkan
ALTER TABLE students
    ADD COLUMN IF NOT EXISTS anonymized_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN students.anonymized_at IS
    'Waktu data alumni dianonimkan (nama/NIS dihapus) sesuai kebijakan retensi.';

-- Index untuk query retensi
CREATE INDEX IF NOT EXISTS idx_students_graduated_year
    ON students (school_id, graduated_academic_year)
    WHERE student_status = 'LULUS' AND anonymized_at IS NULL;
