-- ============================================================
-- Migration: 20260630130000_pkl_attendance.sql
-- Fitur PKL — absensi harian siswa PKL oleh DUDI.
-- ============================================================
--
-- LATAR BELAKANG
-- Tabel `attendance` sekolah terikat ke teaching_schedules (sesi
-- mengajar), sehingga TIDAK bisa dipakai DUDI untuk mencatat
-- kehadiran siswa PKL di tempat usaha. PKL bersifat harian (satu
-- baris per siswa per hari), bukan per sesi jadwal sekolah.
--
-- Migrasi ini menambahkan tabel terpisah `pkl_attendance` plus RLS:
--   * DUDI  — tulis & baca HANYA untuk siswa di penempatan (placement)
--             miliknya sendiri.
--   * Staf  — BK, WALI_KELAS, KAPRODI, KEPSEK, WAKA_KESISWAAN baca semua
--             (penyaringan per-program dilakukan di lapisan query
--             dashboard, sama seperti pola pkl_placements/students).
--   * ADMINISTRATIVE — DELETE untuk keperluan cascade hapus siswa.
--
-- Status memakai enum attendance_status yang sudah ada
-- (HADIR/TIDAK_HADIR/IZIN/SAKIT/EKSKUL); untuk PKL yang relevan
-- HADIR/TIDAK_HADIR/IZIN/SAKIT.
-- ============================================================


-- ------------------------------------------------------------
-- TABEL: pkl_attendance
-- Identitas komposit logis: (placement_id, attendance_date).
-- student_id didenormalkan dari placement agar RLS & query lebih
-- sederhana; konsistensinya dijaga trigger di bawah.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pkl_attendance (
    pkl_attendance_id   UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),
    placement_id        UUID              NOT NULL REFERENCES pkl_placements(placement_id) ON DELETE RESTRICT,
    student_id          UUID              NOT NULL REFERENCES students(student_id) ON DELETE RESTRICT,
    attendance_date     DATE              NOT NULL DEFAULT CURRENT_DATE,
    status              attendance_status NOT NULL DEFAULT 'HADIR',
    check_in_time       TIME,
    check_out_time      TIME,
    notes               TEXT,
    recorded_by_user_id UUID              NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    created_at          TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ       NOT NULL DEFAULT NOW(),

    -- Satu catatan absensi per penempatan per hari
    CONSTRAINT uq_pkl_attendance_per_day UNIQUE (placement_id, attendance_date),

    -- Jam pulang harus setelah jam masuk (bila keduanya diisi)
    CONSTRAINT chk_pkl_checkout_after_checkin
        CHECK (check_out_time IS NULL OR check_in_time IS NULL OR check_out_time > check_in_time)
);

CREATE INDEX IF NOT EXISTS idx_pkl_attendance_placement ON pkl_attendance(placement_id, attendance_date);
CREATE INDEX IF NOT EXISTS idx_pkl_attendance_student   ON pkl_attendance(student_id, attendance_date DESC);
CREATE INDEX IF NOT EXISTS idx_pkl_attendance_date      ON pkl_attendance(attendance_date);

COMMENT ON TABLE pkl_attendance IS
    'Absensi harian siswa PKL oleh DUDI. Satu baris = satu siswa per hari. '
    'Terpisah dari attendance sekolah (yang terikat teaching_schedules). '
    'student_id didenormalkan dari placement (dijaga trigger trg_pkl_attendance_student_match).';
COMMENT ON COLUMN pkl_attendance.student_id IS
    'Didenormalkan dari pkl_placements.student_id. Trigger memastikan tetap konsisten dengan placement_id.';


-- ------------------------------------------------------------
-- TRIGGER: jaga student_id selalu cocok dengan placement-nya.
-- Mencegah DUDI menulis baris dengan student_id ≠ siswa pada
-- placement_id (yang akan melubangi penjagaan RLS).
-- Pola sama dengan trg_substitute_not_original.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_pkl_attendance_student_match()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF NEW.student_id <> (
        SELECT student_id FROM pkl_placements WHERE placement_id = NEW.placement_id
    ) THEN
        RAISE EXCEPTION 'student_id (%) tidak cocok dengan siswa pada placement_id (%)',
            NEW.student_id, NEW.placement_id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pkl_attendance_student_match_check ON pkl_attendance;
CREATE TRIGGER trg_pkl_attendance_student_match_check
    BEFORE INSERT OR UPDATE ON pkl_attendance
    FOR EACH ROW EXECUTE FUNCTION trg_pkl_attendance_student_match();


-- ------------------------------------------------------------
-- updated_at auto-touch (memakai helper fn_touch_updated_at bila
-- ada; bila tidak, dibuat di sini agar migrasi mandiri).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pkl_attendance_touch ON pkl_attendance;
CREATE TRIGGER trg_pkl_attendance_touch
    BEFORE UPDATE ON pkl_attendance
    FOR EACH ROW EXECUTE FUNCTION fn_touch_updated_at();


-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE pkl_attendance ENABLE ROW LEVEL SECURITY;

-- DUDI: baca & tulis (INSERT/UPDATE/DELETE) hanya untuk siswa yang
-- ia supervisi lewat penempatan PKL aktif. Pada INSERT/UPDATE,
-- recorded_by_user_id wajib dirinya sendiri.
DROP POLICY IF EXISTS rls_pkl_attendance_rw_dudi ON pkl_attendance;
CREATE POLICY rls_pkl_attendance_rw_dudi ON pkl_attendance
    FOR ALL
    USING (
        fn_current_user_role() = 'DUDI'
        AND fn_dudi_supervises_student(student_id)
    )
    WITH CHECK (
        fn_current_user_role() = 'DUDI'
        AND fn_dudi_supervises_student(student_id)
        AND recorded_by_user_id = fn_current_user_id()
    );

-- Staf akademik: baca semua. Penyaringan per-program (untuk Kaprodi)
-- dilakukan di lapisan query dashboard — konsisten dengan pola
-- rls_pkl_read_staff / rls_students_read_staff yang juga tak ter-scope.
DROP POLICY IF EXISTS rls_pkl_attendance_read_staff ON pkl_attendance;
CREATE POLICY rls_pkl_attendance_read_staff ON pkl_attendance
    FOR SELECT USING (
        fn_current_user_role() IN ('BK', 'WALI_KELAS', 'KAPRODI', 'KEPSEK', 'WAKA_KESISWAAN')
    );

-- ADMINISTRATIVE: DELETE untuk cascade hapus siswa lewat wizard
-- (sejalan dengan rls_attendance_delete_administrative).
DROP POLICY IF EXISTS rls_pkl_attendance_delete_administrative ON pkl_attendance;
CREATE POLICY rls_pkl_attendance_delete_administrative ON pkl_attendance
    FOR DELETE USING (fn_current_user_role() = 'ADMINISTRATIVE');
