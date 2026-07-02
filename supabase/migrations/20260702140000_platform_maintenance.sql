-- ============================================================
-- Maintenance banner platform-wide (kemungkinan_buruk.md 6.4 / 7.3)
-- ============================================================
-- Saat Supabase/platform sedang dipelihara, user hanya melihat error
-- generik. Tambah flag global yang bisa dinyalakan superadmin, lalu
-- ditampilkan sebagai banner di semua portal (via shared/branding.js).
--
-- Satu baris global (id=1). Ditulis hanya oleh service-role (edge fn
-- set-maintenance yang digerbang X-Superadmin-Key). Dibaca publik lewat
-- RPC SECURITY DEFINER (anon) supaya banner muncul bahkan di halaman login.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.platform_config (
    id                 SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    maintenance_active BOOLEAN NOT NULL DEFAULT FALSE,
    maintenance_message TEXT,
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.platform_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Kunci total dari akses langsung: hanya service-role (edge fn) & fungsi
-- SECURITY DEFINER di bawah yang boleh menyentuh tabel ini.
ALTER TABLE public.platform_config ENABLE ROW LEVEL SECURITY;

-- Status maintenance dapat dibaca siapa saja (anon) untuk banner.
CREATE OR REPLACE FUNCTION public.fn_maintenance_status()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
    SELECT jsonb_build_object(
        'active',  COALESCE(maintenance_active, FALSE),
        'message', maintenance_message
    )
    FROM platform_config WHERE id = 1;
$function$;

GRANT EXECUTE ON FUNCTION public.fn_maintenance_status() TO anon, authenticated;
