ALTER TABLE public.school_config
    ADD COLUMN IF NOT EXISTS password_changed BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.school_config.password_changed IS
    'TRUE setelah admin mengganti password default. Diset saat ganti password pertama.';
