-- SIP Sprint 1 — 002: Create schema core
-- Schema ini bersifat READ-ONLY untuk tenant; hanya service_role (SIP Team) yang write.

CREATE SCHEMA IF NOT EXISTS core;

-- Grant USAGE ke authenticated agar bisa SELECT via RLS
GRANT USAGE ON SCHEMA core TO authenticated;
GRANT USAGE ON SCHEMA core TO service_role;

-- Default privileges: authenticated hanya SELECT; service_role full
ALTER DEFAULT PRIVILEGES IN SCHEMA core
  GRANT SELECT ON TABLES TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA core
  GRANT ALL ON TABLES TO service_role;
