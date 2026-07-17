CREATE SCHEMA IF NOT EXISTS learning;

GRANT USAGE ON SCHEMA learning TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA learning TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA learning
  GRANT ALL ON TABLES TO anon, authenticated, service_role;

CREATE TABLE learning.spike_test (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id  uuid,
  created_by uuid,
  content    text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE learning.spike_test ENABLE ROW LEVEL SECURITY;

CREATE POLICY "spike_test_owner" ON learning.spike_test
  FOR ALL
  USING (created_by = auth.uid());
