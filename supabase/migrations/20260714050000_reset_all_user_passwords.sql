-- Reset semua password user ke '12345678'
-- Dikecualikan: ADMINISTRATIVE (admin sekolah) dan superadmin platform
-- (superadmin tidak ada di public.users sama sekali)
UPDATE auth.users au
SET    encrypted_password = crypt('12345678', gen_salt('bf'))
WHERE  au.id IN (
    SELECT auth_user_id
    FROM   public.users
    WHERE  role_type <> 'ADMINISTRATIVE'
);
