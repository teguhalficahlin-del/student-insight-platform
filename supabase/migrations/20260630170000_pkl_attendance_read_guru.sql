-- ============================================================
-- Migration: 20260630170000_pkl_attendance_read_guru.sql
-- Tambahkan GURU ke rls_pkl_attendance_read_staff.
-- ============================================================
--
-- LATAR BELAKANG
-- Policy rls_pkl_attendance_read_staff (migration 20260630130000)
-- mengizinkan BK/WALI_KELAS/KAPRODI/KEPSEK/WAKA_KESISWAAN membaca
-- pkl_attendance, tapi TIDAK GURU.
--
-- Kaprodi yang rangkap jabatan (role_type='GURU' + kaprodi_program_id
-- non-null) — pola yang umum di SMK kecil — tidak bisa membaca
-- absensi PKL karena fn_current_user_role() mengembalikan 'GURU'.
-- Akibatnya panel Rekap Absensi PKL di dashboard Kaprodi selalu kosong.
--
-- FIX: tambahkan 'GURU' ke daftar role yang diizinkan, konsisten
-- dengan rls_pkl_read_staff di pkl_placements yang sudah menyertakan
-- GURU. Penyaringan per-program tetap dilakukan di lapisan query
-- dashboard (bukan di RLS), sama dengan pola yang ada.
-- ============================================================

DROP POLICY IF EXISTS rls_pkl_attendance_read_staff ON pkl_attendance;
CREATE POLICY rls_pkl_attendance_read_staff ON pkl_attendance
    FOR SELECT USING (
        fn_current_user_role() IN (
            'GURU', 'BK', 'WALI_KELAS', 'KAPRODI', 'KEPSEK', 'WAKA_KESISWAAN'
        )
    );
