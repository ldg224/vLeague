-- 0.30: press conferences (preset answers), reactions, and a line-up lock that can never fall after the week's first kick-off.
-- Needs 0014 (rounds, sync_week_deadline).

-- 1. A week's line-ups always lock at or before its first kick-off, even when the office types a later time by hand.
create or replace function public.sync_week_deadline(p_week int) returns void
language plpgsql security definer set search_path = public as $$
declare first_ko timestamptz; r record; at timestamptz;
begin
  select min(starts_at) into first_ko from public.fixtures where week = p_week and starts_at is not null and not postponed;
  select * into r from public.rounds where week = p_week;
  if first_ko is null and r.lock_at_override is null then
    delete from public.deadlines where week = p_week and locked_at is null;
    return;
  end if;
  at := coalesce(r.lock_at_override, first_ko - make_interval(mins => coalesce(r.lock_minutes_before, 180)));
  if first_ko is not null then at := least(at, first_ko); end if;
  insert into public.deadlines (week, locks_at) values (p_week, at)
  on conflict (week) do update set locks_at = excluded.locks_at where public.deadlines.locked_at is null;
end $$;
revoke all on function public.sync_week_deadline(int) from public, anon, authenticated;

-- Fix any week that is still open and set to lock after its first game.
do $$ declare w int; begin
  for w in select d.week from public.deadlines d where d.locked_at is null loop perform public.sync_week_deadline(w); end loop;
end $$;

-- 2. Press questions. answers: [{ id, text, tone, fans, mood, team, opp }]; each effect is a whole number of percent
-- (-3 to 3). The page adds a club's answers up and caps each meter at 3%.
create table if not exists public.press_questions (
  id      text primary key check (id ~ '^[a-z0-9_]{2,40}$'),
  text    text not null check (char_length(text) between 5 and 200),
  answers jsonb not null check (jsonb_typeof(answers) = 'array' and jsonb_array_length(answers) between 2 and 5),
  active  boolean not null default true
);
alter table public.press_questions enable row level security;
drop policy if exists press_questions_read on public.press_questions;
create policy press_questions_read on public.press_questions for select to authenticated using (true);
drop policy if exists press_questions_office on public.press_questions;
create policy press_questions_office on public.press_questions for all to authenticated using (public.is_office()) with check (public.is_office());
revoke all on public.press_questions from anon, authenticated;
grant select on public.press_questions to authenticated;
grant insert, update, delete on public.press_questions to authenticated;

insert into public.press_questions (id, text, answers) values
 ('form', 'How are the players feeling going into this one?', '[
   {"id":"a","tone":"confident","text":"Sharp and hungry. We’re expecting a big performance.","fans":2,"mood":1,"team":1,"opp":0},
   {"id":"b","tone":"humble","text":"We’ve worked hard. We’ll take it one game at a time.","fans":1,"mood":2,"team":0,"opp":0},
   {"id":"c","tone":"deflecting","text":"You’ll have to ask them. I just pick the team.","fans":-1,"mood":0,"team":0,"opp":0}]'),
 ('opposition', 'What do you make of your opponents?', '[
   {"id":"a","tone":"confident","text":"They should be worried about us, not the other way round.","fans":2,"mood":0,"team":1,"opp":-1},
   {"id":"b","tone":"humble","text":"A dangerous side. We’ll need to be at our best.","fans":0,"mood":1,"team":0,"opp":1},
   {"id":"c","tone":"deflecting","text":"I’m focused on our own game.","fans":0,"mood":0,"team":0,"opp":0}]'),
 ('pressure', 'There’s a lot of pressure on this result. Does it get to you?', '[
   {"id":"a","tone":"confident","text":"Pressure is a privilege. We thrive on it.","fans":1,"mood":1,"team":1,"opp":0},
   {"id":"b","tone":"humble","text":"Of course, but the group backs each other.","fans":1,"mood":2,"team":0,"opp":0},
   {"id":"c","tone":"deflecting","text":"Pressure is for tyres.","fans":1,"mood":-1,"team":0,"opp":0}]'),
 ('tactics', 'Will you change anything tactically?', '[
   {"id":"a","tone":"confident","text":"We play our way and make them adjust to us.","fans":1,"mood":0,"team":1,"opp":0},
   {"id":"b","tone":"humble","text":"We’ve looked at what they do well and we’re ready for it.","fans":0,"mood":0,"team":1,"opp":0},
   {"id":"c","tone":"deflecting","text":"I’m not giving away my plans.","fans":0,"mood":0,"team":0,"opp":0}]'),
 ('fans', 'What would you say to the fans?', '[
   {"id":"a","tone":"confident","text":"Come and be loud. We’ll give you something to cheer.","fans":3,"mood":0,"team":0,"opp":0},
   {"id":"b","tone":"humble","text":"Thank you for sticking with us. We won’t take it for granted.","fans":2,"mood":1,"team":0,"opp":0},
   {"id":"c","tone":"deflecting","text":"They know where to find me.","fans":-1,"mood":0,"team":0,"opp":0}]'),
 ('injuries', 'Any worries about the squad?', '[
   {"id":"a","tone":"confident","text":"Everyone’s fit and fired up.","fans":1,"mood":1,"team":1,"opp":0},
   {"id":"b","tone":"humble","text":"A few knocks, but we have depth. The next player steps up.","fans":0,"mood":2,"team":0,"opp":0},
   {"id":"c","tone":"deflecting","text":"I never talk about injuries.","fans":0,"mood":-1,"team":0,"opp":0}]'),
 ('rivalry', 'Is there any extra edge in this fixture?', '[
   {"id":"a","tone":"confident","text":"Every game matters. We want to put them in their place.","fans":2,"mood":0,"team":1,"opp":-1},
   {"id":"b","tone":"humble","text":"Respect for them. Whoever wants it more will win.","fans":1,"mood":1,"team":0,"opp":0},
   {"id":"c","tone":"deflecting","text":"Three points are three points.","fans":0,"mood":0,"team":0,"opp":0}]'),
 ('target', 'Where do you want to be at the end of the season?', '[
   {"id":"a","tone":"confident","text":"On top. Nothing less.","fans":2,"mood":0,"team":1,"opp":0},
   {"id":"b","tone":"humble","text":"Better than last time. Let’s see where that takes us.","fans":1,"mood":1,"team":0,"opp":0},
   {"id":"c","tone":"deflecting","text":"Too early to say.","fans":0,"mood":0,"team":0,"opp":0}]')
on conflict (id) do nothing;

-- 3. A club's chosen answers. Readable by every signed-in user (they are quoted in the match preview).
create table if not exists public.press_answers (
  fixture    text not null references public.fixtures (id) on update cascade on delete cascade,
  club       text not null references public.clubs (code) on update cascade on delete cascade,
  question   text not null references public.press_questions (id) on update cascade on delete cascade,
  answer     text not null,
  created_at timestamptz not null default now(),
  primary key (fixture, club, question)
);
alter table public.press_answers enable row level security;
drop policy if exists press_answers_read on public.press_answers;
create policy press_answers_read on public.press_answers for select to authenticated using (true);
drop policy if exists press_answers_office on public.press_answers;
create policy press_answers_office on public.press_answers for all to authenticated using (public.is_office()) with check (public.is_office());
revoke all on public.press_answers from anon, authenticated;
grant select on public.press_answers to authenticated;
grant insert, update, delete on public.press_answers to authenticated;

-- The conference opens 24 hours before kick-off and closes at kick-off. Only the manager of one of the two clubs answers,
-- only for their own club, and a manager can change an answer until it closes.
create or replace function public.save_press_answer(p_fixture text, p_question text, p_answer text) returns void
language plpgsql security definer set search_path = public as $$
declare me text := public.my_club(); f record; q record;
begin
  if auth.uid() is null or me is null then raise exception 'Sign in as a club manager.'; end if;
  select * into f from public.fixtures where id = p_fixture;
  if not found or me not in (f.home, f.away) then raise exception 'That isn’t your club’s match.'; end if;
  if f.starts_at is null or f.postponed or now() < f.starts_at - interval '24 hours' or now() >= f.starts_at then
    raise exception 'The press conference isn’t open.';
  end if;
  select * into q from public.press_questions where id = p_question and active;
  if not found or not exists (select 1 from jsonb_array_elements(q.answers) a where a->>'id' = p_answer) then
    raise exception 'That isn’t one of the answers.';
  end if;
  insert into public.press_answers (fixture, club, question, answer) values (p_fixture, me, p_question, p_answer)
  on conflict (fixture, club, question) do update set answer = excluded.answer, created_at = now();
end $$;
revoke all on function public.save_press_answer(text, text, text) from public, anon;
grant execute on function public.save_press_answer(text, text, text) to authenticated;

-- 4. Reactions: one per person per thing. target is 'news:<id>', 'press:<fixture>:<club>' or 'result:<fixture>'.
create table if not exists public.reactions (
  target     text not null check (target ~ '^(news:[0-9]{1,12}|press:[a-z0-9-]{3,40}:[A-Za-z0-9]{2,6}|result:[a-z0-9-]{3,40})$'),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  emoji      text not null check (emoji in ('👍', '🔥', '😂', '👏', '😮')),
  created_at timestamptz not null default now(),
  primary key (target, user_id)
);
alter table public.reactions enable row level security;
drop policy if exists reactions_read on public.reactions;
create policy reactions_read on public.reactions for select to authenticated using (true);
drop policy if exists reactions_own on public.reactions;
create policy reactions_own on public.reactions for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.reactions from anon, authenticated;
grant select, insert, update, delete on public.reactions to authenticated;
