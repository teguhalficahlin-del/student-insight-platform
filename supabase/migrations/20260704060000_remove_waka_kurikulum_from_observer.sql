-- ============================================================
-- ITEM 4 — Keluarkan Waka Kurikulum dari fn_is_schoolwide_observer
-- ============================================================
-- Masalah: fn_is_schoolwide_observer() menyertakan WAKA_KURIKULUM
-- dan flag is_waka_kurikulum. Waka Kurikulum bertanggung jawab atas
-- jadwal & kurikulum — BUKAN pengawasan kehadiran siswa. Akses
-- seluruh absensi siswa adalah lingkup Waka Kesiswaan dan Kepsek.
--
-- Dampak pada user nyata:
--   Sebelum: Waka Kurikulum bisa buka rekap absensi seluruh siswa.
--   Sesudah: Waka Kurikulum hanya bisa baca absensi kelas/siswa
--            yang diajarnya (jika merangkap guru), seperti guru biasa.
-- ============================================================

CREATE OR REPLACE FUNCTION fn_is_schoolwide_observer()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM users u
        WHERE u.auth_user_id = auth.uid()
          AND ( u.role_type IN ('BK', 'KEPSEK', 'WAKA_KESISWAAN')
                OR u.is_bk OR u.is_kepsek OR u.is_waka_kesiswaan )
    );
$$;

COMMENT ON FUNCTION fn_is_schoolwide_observer() IS
    'TRUE jika caller adalah BK, Kepsek, atau Waka Kesiswaan '
    '(termasuk via flag). Waka Kurikulum TIDAK termasuk — '
    'akses absensi seluruh sekolah bukan tanggung jawabnya.';
