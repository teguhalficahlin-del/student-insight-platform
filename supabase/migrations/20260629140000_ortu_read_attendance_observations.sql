-- Buka akses BACA untuk role ORTU ke kehadiran (attendance) dan observasi
-- (observations) anak-anak yang tertaut padanya lewat student_parents.
--
-- LATAR BELAKANG
-- Satu akun ORTU dapat tertaut ke banyak siswa (student_parents adalah relasi
-- many-to-many). Prinsipnya sama dengan guru multi-peran: satu login, lalu
-- cakupan datanya diresolusikan saat query — di sini lewat student_parents,
-- persis seperti policy `rls_students_read_parent` pada tabel students. Dengan
-- begitu seorang orang tua melihat kehadiran & observasi SEMUA anaknya hanya
-- dengan satu kali login, tanpa akun per-anak.
--
-- Sebelum migrasi ini:
--   * attendance   — tidak ada policy ORTU (RLS menolak secara default).
--   * observations — komentar kontrak menyatakan "ORTU: blocked entirely".
--
-- KEPUTUSAN VISIBILITAS OBSERVASI
-- Orang tua hanya melihat observasi yang sudah ditandai layak dibagikan, yaitu
-- visibility = 'STUDENT_VISIBLE' — gerbang yang sama dengan yang dipakai siswa.
-- POSITIF default-nya STUDENT_VISIBLE; NEGATIF tetap INTERNAL_SCHOOL kecuali
-- guru sengaja mempublikasikannya. Catatan internal guru tidak pernah bocor ke
-- orang tua. Kita sengaja TIDAK menambah nilai enum baru (mis. PARENT_VISIBLE)
-- karena visibility_level dipakai bersama cases/case_events dan dikunci oleh
-- trigger immutability + audit; menambah tier baru di kemudian hari tetap bisa
-- dilakukan tanpa membongkar policy ini.

-- ── ATTENDANCE: orang tua membaca kehadiran tiap anak yang tertaut ──
-- Baris yang di-void (sesi batal, guru tidak hadir, dll.) disembunyikan dari
-- orang tua — sama seperti perlakuan pada siswa.
DROP POLICY IF EXISTS rls_attendance_read_parent ON attendance;

CREATE POLICY rls_attendance_read_parent ON attendance
    FOR SELECT USING (
        fn_current_user_role() = 'ORTU'
        AND is_void = FALSE
        AND EXISTS (
            SELECT 1 FROM student_parents sp
            WHERE sp.student_id     = attendance.student_id
              AND sp.parent_user_id = fn_current_user_id()
        )
    );

-- ── OBSERVATIONS: orang tua membaca observasi STUDENT_VISIBLE tiap anak ──
DROP POLICY IF EXISTS rls_observations_read_parent ON observations;

CREATE POLICY rls_observations_read_parent ON observations
    FOR SELECT USING (
        fn_current_user_role() = 'ORTU'
        AND visibility = 'STUDENT_VISIBLE'
        AND EXISTS (
            SELECT 1 FROM student_parents sp
            WHERE sp.student_id     = observations.student_id
              AND sp.parent_user_id = fn_current_user_id()
        )
    );
