-- ============================================================
-- FASE 1 Multi-tenant — Langkah 1: Tabel schools
-- ============================================================

CREATE TABLE schools (
    school_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL,
    npsn          TEXT UNIQUE,
    address       TEXT,
    phone         TEXT,
    logo_url      TEXT,
    primary_color TEXT NOT NULL DEFAULT '#1a56db',
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE schools ENABLE ROW LEVEL SECURITY;

-- Siapa pun yang login boleh baca sekolah sendiri (difilter via school_id nanti)
CREATE POLICY rls_schools_read_all
    ON schools FOR SELECT
    USING (auth.uid() IS NOT NULL);

-- Hanya superadmin (service_role) yang boleh insert/update schools
-- Portal admin biasa tidak bisa buat sekolah baru

-- Seed: SMK Harapan Rokan sebagai sekolah pertama
INSERT INTO schools (school_id, name, npsn)
VALUES ('00000000-0000-0000-0000-000000000001', 'SMK Harapan Rokan', '10494399');
