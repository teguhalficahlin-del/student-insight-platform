-- Izinkan role ADMINISTRATIVE (TU) menulis & menghapus program keahlian
-- langsung lewat REST, agar pengelolaan manual (tambah/hapus) di wizard
-- onboarding berfungsi.
--
-- Sebelumnya hanya KEPSEK/KAPRODI yang boleh menulis ke `programs`, sehingga
-- DELETE oleh TU diam-diam menghapus 0 baris (difilter RLS, tanpa error) dan
-- tombol hapus tampak tidak berfungsi. INSERT manual pun ditolak. Satu-satunya
-- jalur tulis yang berfungsi untuk TU adalah edge function bulk-import-programs
-- (service-role, melewati RLS).

DROP POLICY IF EXISTS rls_programs_write_admin ON programs;

CREATE POLICY rls_programs_write_admin ON programs
    FOR ALL
    USING      (fn_current_user_role() IN ('KEPSEK', 'KAPRODI', 'ADMINISTRATIVE'))
    WITH CHECK (fn_current_user_role() IN ('KEPSEK', 'KAPRODI', 'ADMINISTRATIVE'));
