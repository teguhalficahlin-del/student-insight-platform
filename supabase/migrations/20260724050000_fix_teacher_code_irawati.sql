BEGIN;

-- Bypass trigger fn_guard_users_protected_columns (LOCAL = reset otomatis)
SELECT set_config('app.bypass_users_guard', 'on', true);

UPDATE users
SET teacher_code = 'IRW'
WHERE user_id = '3ce4208f-882e-47b4-ad3f-3b913fbe2910'
  AND teacher_code = 'RW';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM users
    WHERE user_id = '3ce4208f-882e-47b4-ad3f-3b913fbe2910'
      AND teacher_code = 'IRW'
  ) THEN
    RAISE EXCEPTION 'Fix gagal — teacher_code tidak terupdate';
  END IF;
END $$;

COMMIT;
