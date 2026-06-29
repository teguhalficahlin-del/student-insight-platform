-- ============================================================
-- Migration: 20260630140000_dudi_observation_write.sql
-- Beri DUDI izin MENULIS observasi untuk siswa PKL-nya.
-- ============================================================
--
-- LATAR BELAKANG
-- Kontrak awal (06_rls_policies.sql, policy rls_observations_write)
-- hanya mengizinkan GURU/WALI_KELAS/BK/KAPRODI/KEPSEK menulis
-- observasi — DUDI TIDAK termasuk. Akibatnya panel "Observasi DUDI"
-- di dashboard Kaprodi selalu kosong karena DUDI tak pernah bisa
-- membuat observasi.
--
-- Migrasi ini menambah policy INSERT khusus DUDI, dibatasi ke siswa
-- yang benar-benar ia supervisi lewat penempatan PKL aktif
-- (fn_dudi_supervises_student) dan author_user_id wajib dirinya.
-- Policy bersifat aditif (di-OR dengan policy write yang sudah ada),
-- jadi tak perlu mengubah policy lama.
--
-- Sisi BACA sudah aman: rls_observations_read_staff mengizinkan
-- KAPRODI membaca seluruh observasi (termasuk dari DUDI), dan
-- dashboard menyaring penulis berperan DUDI di lapisan query.
-- ============================================================

DROP POLICY IF EXISTS rls_observations_write_dudi ON observations;
CREATE POLICY rls_observations_write_dudi ON observations
    FOR INSERT WITH CHECK (
        fn_current_user_role() = 'DUDI'
        AND author_user_id = fn_current_user_id()
        AND fn_dudi_supervises_student(student_id)
    );

COMMENT ON POLICY rls_observations_write_dudi ON observations IS
    'DUDI boleh membuat observasi hanya untuk siswa PKL yang ia supervisi '
    '(penempatan aktif). Visibilitas tetap diatur trigger asimetri '
    'POSITIF→STUDENT_VISIBLE / NEGATIF→INTERNAL_SCHOOL seperti penulis lain.';
