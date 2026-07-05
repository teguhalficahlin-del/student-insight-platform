-- ============================================================
-- Migration 20260705070000: drop fn_sync_case versi lama
--
-- Migrasi 20260703200000 dan 20260703260000 sama-sama menggunakan
-- CREATE OR REPLACE dengan signature berbeda, sehingga menghasilkan
-- DUA overload fn_sync_case di database:
--   (8 param, tanpa p_audience) — dari mig 200000
--   (9 param, dengan p_audience DEFAULT) — dari mig 260000
--
-- PostgREST bisa gagal resolve saat keduanya ada (ambiguitas).
-- Hapus versi lama (8 param); versi baru (9 param) tetap aktif.
-- ============================================================

DROP FUNCTION IF EXISTS public.fn_sync_case(
    text, uuid, uuid, uuid, text, text, text, text
);
