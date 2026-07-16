ALTER TABLE ld_prompt_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prompt_templates_read_authenticated"
  ON ld_prompt_templates
  FOR SELECT
  TO authenticated
  USING (true);
