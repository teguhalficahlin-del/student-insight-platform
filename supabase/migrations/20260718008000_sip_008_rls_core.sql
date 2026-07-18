-- SIP Sprint 1 — 008: RLS untuk semua tabel core.*
-- Rule: SELECT = authenticated, INSERT/UPDATE/DELETE = service_role saja
-- Idempotent: CREATE POLICY IF NOT EXISTS + DO...EXCEPTION

-- Helper macro: enable RLS + buat policy SELECT untuk authenticated
-- Dijalankan per tabel karena IF NOT EXISTS tidak ada untuk ALTER TABLE ENABLE RLS

DO $$ BEGIN
  -- curriculum_versions
  ALTER TABLE core.curriculum_versions ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN others THEN null;
END $$;

DO $$ BEGIN
  -- education_levels
  ALTER TABLE core.education_levels ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN others THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE core.phases ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN others THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE core.vocational_fields ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN others THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE core.vocational_programs ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN others THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE core.vocational_concentrations ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN others THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE core.subjects ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN others THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE core.subject_phases ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN others THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE core.capaian_pembelajaran ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN others THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE core.cp_elements ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN others THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE core.knowledge_national ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN others THEN null;
END $$;

-- SELECT policies — semua authenticated boleh baca
DO $$ BEGIN
  CREATE POLICY "core_curriculum_versions_read"
    ON core.curriculum_versions FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE POLICY "core_education_levels_read"
    ON core.education_levels FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE POLICY "core_phases_read"
    ON core.phases FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE POLICY "core_vocational_fields_read"
    ON core.vocational_fields FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE POLICY "core_vocational_programs_read"
    ON core.vocational_programs FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE POLICY "core_vocational_concentrations_read"
    ON core.vocational_concentrations FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE POLICY "core_subjects_read"
    ON core.subjects FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE POLICY "core_subject_phases_read"
    ON core.subject_phases FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE POLICY "core_capaian_pembelajaran_read"
    ON core.capaian_pembelajaran FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE POLICY "core_cp_elements_read"
    ON core.cp_elements FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE POLICY "core_knowledge_national_read"
    ON core.knowledge_national FOR SELECT TO authenticated USING (true);
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Tidak ada INSERT/UPDATE/DELETE policy untuk authenticated → default deny
-- service_role bypass RLS secara default di Supabase
