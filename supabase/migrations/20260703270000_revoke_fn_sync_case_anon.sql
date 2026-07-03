-- Migration 20260703270000: revoke fn_sync_case dari PUBLIC/anon
-- fn_sync_case hanya boleh dipanggil oleh service_role (edge fn).
-- CREATE OR REPLACE tidak otomatis merevoke grant lama.

REVOKE ALL ON FUNCTION public.fn_sync_case(text,uuid,uuid,uuid,text,text,text,text)       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fn_sync_case(text,uuid,uuid,uuid,text,text,text,text,text)  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.fn_sync_case(text,uuid,uuid,uuid,text,text,text,text,text) TO service_role;
