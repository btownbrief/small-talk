-- Small Talk: drain notifications / moderate pending photos / sweep orphan photo
-- folders every 5 minutes by calling the st-notify edge function from pg_cron.
-- The shared secret lives in Vault (never in this file):
--   select vault.create_secret('<the NOTIFY_CRON_SECRET value>', 'st_notify_cron_secret');
-- then run this file once:  supabase db query --linked -f supabase/small-talk-CRON.sql
-- (pg_cron + pg_net are project-wide extensions; enabling them here does not touch
--  the sibling apps' objects.)
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('st-notify-drain') where exists (select 1 from cron.job where jobname = 'st-notify-drain');
select cron.schedule(
  'st-notify-drain',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://jnouvwxomrcffqwilqkq.supabase.co/functions/v1/st-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'st_notify_cron_secret' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);
