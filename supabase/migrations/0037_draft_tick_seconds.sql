-- B-09: the draft clock ran once a minute, so an auto-pick could wait up to 60 seconds after a team's timer hit zero.
-- It now runs every 5 seconds. The job is replaced in one go: if this Postgres can't schedule seconds (pg_cron older
-- than 1.5), the schedule line fails and, run as one script, the old every-minute job is left in place. Safe to re-run.

select cron.unschedule(jobid) from cron.job where jobname = 'vleague-draft-tick';
select cron.schedule('vleague-draft-tick', '5 seconds', 'select public.draft_tick();');
