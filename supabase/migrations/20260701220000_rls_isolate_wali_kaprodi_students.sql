-- ============================================================
-- Migration: 20260701220000_rls_isolate_wali_kaprodi_students.sql
-- Perbaiki privasi: WALI_KELAS & KAPRODI tidak boleh baca
-- semua siswa sekolah — harus dibatasi ke tanggung jawabnya:
--   WALI_KELAS → hanya siswa di kelas waliannya
--   KAPRODI    → hanya siswa di program keahliannya
--
-- AKAR MASALAH
-- Policy rls_students_read_staff (migrasi 20260701130000) memberi
-- akses SELECT ke GURU,BK,WALI_KELAS,KAPRODI,KEPSEK sekaligus tanpa
-- filter scope. WALI_KELAS & KAPRODI harusnya dibatasi.
--
-- PENDEKATAN
-- 1. Buat fn_kaprodi_program_id() — analog fn_wali_kelas_class_id().
-- 2. DROP rls_students_read_staff → ganti tanpa WALI_KELAS & KAPRODI.
-- 3. Tambah rls_students_read_wali   — scope ke kelas walian.
-- 4. Tambah rls_students_read_kaprodi — scope ke program keahlian.
-- ============================================================

-- ── 1. Helper function fn_kaprodi_program_id() ───────────────
-- Mengembalikan program_id dari baris users milik session aktif.
-- Nil untuk role yang tidak punya program_id (GURU, BK, dll.).
CREATE OR REPLACE FUNCTION fn_kaprodi_program_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT program_id FROM users WHERE auth_user_id = auth.uid();
$$;

-- ── 2. Perbaiki rls_students_read_staff ──────────────────────
-- Hapus policy lama yang terlalu lebar, ganti hanya GURU/BK/KEPSEK.
DROP POLICY IF EXISTS rls_students_read_staff ON students;

CREATE POLICY rls_students_read_staff ON students FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_current_user_role() = ANY (ARRAY['GURU','BK','KEPSEK']::role_type[]));

-- ── 3. WALI_KELAS — hanya siswa di kelas waliannya ───────────
-- Menggunakan fn_wali_kelas_class_id() (flag, bukan role_type) agar
-- berlaku untuk role_type='GURU' yang sekaligus menjabat wali kelas.
DROP POLICY IF EXISTS rls_students_read_wali ON students;

CREATE POLICY rls_students_read_wali ON students FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_wali_kelas_class_id() IS NOT NULL
        AND EXISTS (
            SELECT 1 FROM class_enrollments ce
            WHERE ce.student_id   = students.student_id
              AND ce.class_id     = fn_wali_kelas_class_id()
              AND ce.withdrawn_at IS NULL
        ));

-- ── 4. KAPRODI — hanya siswa di program keahliannya ──────────
-- students.program_id (NOT NULL) menunjuk program siswa tersebut.
-- users.program_id (untuk KAPRODI) menunjuk program yang dikelola.
-- fn_kaprodi_program_id() mengembalikan NULL untuk non-kaprodi →
-- EXISTS gagal → tidak ada baris yang lolos.
DROP POLICY IF EXISTS rls_students_read_kaprodi ON students;

CREATE POLICY rls_students_read_kaprodi ON students FOR SELECT
    USING (school_id = fn_current_school_id()
        AND fn_kaprodi_program_id() IS NOT NULL
        AND program_id = fn_kaprodi_program_id());
