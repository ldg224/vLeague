-- The Office: switching the transfer window on clears dates that have already passed (22 Nov 2026). Safe to re-run. Needs 0093.
-- Before, the switch could be YES while an old closing time kept the window shut, with nothing on screen to say so.

create or replace function public.office_save_settings(p jsonb) returns public.office_settings
language plpgsql security definer set search_path = public as $$
declare c public.office_settings; k text; st0 text; st1 text;
  keys text[] := array['cap', 'over_limit', 'releases_per_window', 'window_open', 'opens_at', 'closes_at', 'pos_min', 'squad_min', 'squad_max'];
begin
  if not public.is_office() then raise exception 'Only the league office can change Office settings.'; end if;
  for k in select jsonb_object_keys(p) loop
    if not (k = any (keys)) then raise exception 'unknown setting %', k; end if;
  end loop;
  if p ? 'pos_min' and (jsonb_typeof(p -> 'pos_min') <> 'object'
      or exists (select 1 from jsonb_each(p -> 'pos_min') e where e.key not in ('GK', 'DEF', 'MID', 'FWD') or jsonb_typeof(e.value) <> 'number' or (e.value)::text::int not between 0 and 11)) then
    raise exception 'those settings are out of range (each position''s minimum from 0 to 11)';
  end if;
  select * into c from public.office_settings where id = 1 for update;
  st0 := public.office_window_status();
  update public.office_settings set
    cap                 = coalesce((p ->> 'cap')::int, cap),
    over_limit          = coalesce((p ->> 'over_limit')::int, over_limit),
    releases_per_window = coalesce((p ->> 'releases_per_window')::int, releases_per_window),
    window_open         = coalesce((p ->> 'window_open')::boolean, window_open),
    opens_at            = case when p ? 'opens_at' then nullif(p ->> 'opens_at', '')::timestamptz else opens_at end,
    closes_at           = case when p ? 'closes_at' then nullif(p ->> 'closes_at', '')::timestamptz else closes_at end,
    pos_min             = case when p ? 'pos_min' then pos_min || (p -> 'pos_min') else pos_min end,
    squad_min           = coalesce((p ->> 'squad_min')::int, squad_min),
    squad_max           = coalesce((p ->> 'squad_max')::int, squad_max),
    window_started_at   = case when coalesce((p ->> 'window_open')::boolean, window_open) and not window_open then now() else window_started_at end,
    updated_at          = now()
  where id = 1 returning * into c;
  -- 0094: switching the window on while its closing time has already passed would leave it shut (22 Nov 2026). Clear the old dates instead,
  -- so YES means open until switched off. Dates sent in the same save are kept as given.
  if (p ->> 'window_open')::boolean and not (p ? 'closes_at') and c.closes_at is not null and c.closes_at <= now() then
    update public.office_settings set opens_at = null, closes_at = null where id = 1 returning * into c;
  end if;
  st1 := public.office_window_status();
  if st0 in ('closed', 'not_yet') and st1 in ('open', 'round') then
    update public.office_settings set window_started_at = now() where id = 1 returning * into c;
  end if;
  perform public.office_tidy();
  perform public.office_process_queue();
  return c;
exception when check_violation then
  raise exception 'those settings are out of range (a cap from 0 to 10,000,000, an over-cap limit from 0 to 1,000,000, 0 to 50 releases, a squad of 11 to 40 with the most at least the fewest, a window that closes after it opens)';
end $$;
revoke all on function public.office_save_settings(jsonb) from public, anon;
grant execute on function public.office_save_settings(jsonb) to authenticated;
