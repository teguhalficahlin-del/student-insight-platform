-- ============================================================
-- SIP SMK: Role TU — Enum value (1/2)
-- PostgreSQL SQLSTATE 55P04 workaround: ALTER TYPE ADD VALUE
-- harus commit sendiri sebelum nilai baru bisa digunakan dalam
-- fungsi atau policy. fn_is_tu() + RLS ada di 20260722050000.
-- ============================================================
ALTER TYPE role_type ADD VALUE IF NOT EXISTS 'TU';
