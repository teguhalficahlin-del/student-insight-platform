ALTER TABLE school_config
    ADD COLUMN IF NOT EXISTS address TEXT;

COMMENT ON COLUMN school_config.address IS
    'Alamat lengkap sekolah. Diisi saat setup wizard langkah Profil Sekolah.';
