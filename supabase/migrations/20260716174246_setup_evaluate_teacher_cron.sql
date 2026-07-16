CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'evaluate-teacher-indicators-daily',
  '0 17 * * *',
  $$
    SELECT net.http_post(
      url := 'https://xovvuuwexoweoqyltepq.supabase.co/functions/v1/evaluate-teacher-indicators',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := '{}'::jsonb
    );
  $$
);
