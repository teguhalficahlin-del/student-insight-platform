-- ============================================================
-- Monitoring penyimpanan database (kemungkinan_buruk.md 6.5)
-- ============================================================
-- Sebelumnya tak ada cara melihat pemakaian storage — admin/superadmin
-- baru sadar saat error mendadak. RPC ini memberi ukuran DB + tabel
-- terbesar, dipakai konsol superadmin lewat edge fn platform-stats.
--
-- SECURITY DEFINER + hanya boleh dieksekusi service_role (edge fn),
-- bukan anon/authenticated — data infra tak untuk publik.
-- ============================================================

CREATE OR REPLACE FUNCTION public.fn_platform_storage()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
    SELECT jsonb_build_object(
        'db_size_bytes',  pg_database_size(current_database()),
        'db_size_pretty', pg_size_pretty(pg_database_size(current_database())),
        'tables', (
            SELECT jsonb_agg(t) FROM (
                SELECT c.relname                                    AS name,
                       pg_total_relation_size(c.oid)               AS size_bytes,
                       pg_size_pretty(pg_total_relation_size(c.oid)) AS size_pretty,
                       c.reltuples::bigint                          AS est_rows
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relkind = 'r'
                ORDER BY pg_total_relation_size(c.oid) DESC
                LIMIT 10
            ) t
        )
    );
$function$;

REVOKE ALL ON FUNCTION public.fn_platform_storage() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_platform_storage() TO service_role;
