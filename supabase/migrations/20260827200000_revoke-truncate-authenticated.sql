-- RLS tidak berlaku untuk TRUNCATE (PostgreSQL design).
-- Default Supabase memberi TRUNCATE ke authenticated pada semua tabel public.
-- Tidak ada kode aplikasi atau edge function yang menggunakan TRUNCATE sebagai role authenticated.
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM authenticated;

-- Verifikasi: tidak boleh ada baris TRUNCATE untuk authenticated setelah revoke
DO $$ DECLARE cnt int;
BEGIN
  SELECT COUNT(*) INTO cnt
  FROM information_schema.role_table_grants
  WHERE grantee = 'authenticated'
    AND privilege_type = 'TRUNCATE';
  IF cnt > 0 THEN
    RAISE WARNING 'Masih ada % baris TRUNCATE untuk role authenticated', cnt;
  END IF;
END $$;
