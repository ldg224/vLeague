"""Row-level security checks for the vLeague Supabase project.

Acts as a guest (anon), a manager of FC Turtle, a manager with no club, and the league office, and checks what
each can read and change. Every check runs inside a transaction that is rolled back, so nothing is left behind.
Needs the Management API token in C:\\Users\\offic\\.vleague\\supabase-token.txt (never commit it).

    python supabase/tests/rls_check.py
"""
import json
import sys
import urllib.request
from pathlib import Path

REF = 'ywkhjpfzqtfssbxbvnbl'
TOKEN = (Path.home() / '.vleague' / 'supabase-token.txt').read_text().strip()
FAKE_MANAGER = '00000000-0000-4000-8000-00000000a001'
FAKE_NOCLUB = '00000000-0000-4000-8000-00000000a002'


def sql(query):
    req = urllib.request.Request(
        f'https://api.supabase.com/v1/projects/{REF}/database/query',
        data=json.dumps({'query': query}).encode(),
        headers={'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json', 'User-Agent': 'vleague-rls-check'},
        method='POST')
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read() or b'[]')
    except urllib.error.HTTPError as e:
        return {'error': e.read().decode()[:300]}


SETUP = f"""
insert into auth.users (id, instance_id, aud, role, email) values
  ('{FAKE_MANAGER}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-test-manager@example.invalid'),
  ('{FAKE_NOCLUB}',  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rls-test-noclub@example.invalid');
update public.profiles set club = 'TUR' where id = '{FAKE_MANAGER}';
insert into public.team_sheets (club, formation) values ('TUR', '4-4-2'), ('LAU', '4-3-3') on conflict (club) do nothing;
"""


def as_user(who, body, pre=''):
    """Run body as a given user inside a rolled-back transaction; return the last statement's rows (or the error).
    pre runs first with full rights, to set up rows for the check."""
    if who == 'anon':
        claims, role = '{"role":"anon"}', 'anon'
    else:
        uid = {'manager': FAKE_MANAGER, 'noclub': FAKE_NOCLUB}.get(who) or \
            "' || (select id from auth.users where email = 'lukedanielgrogan@gmail.com') || '"
        claims, role = f'{{"sub":"{uid}","role":"authenticated"}}', 'authenticated'
    q = (f"begin; {SETUP} {pre} select set_config('request.jwt.claims', '{claims}', true); set local role {role}; "
         f"{body}")
    rows = sql(q + '')
    sql('rollback;')  # each API call is its own session, but be explicit
    return rows


def rows_of(r):
    return r if isinstance(r, list) else None


CHECKS = [
    # (who, description, sql returning one row with a boolean column "ok")
    ('anon', 'guest can read clubs', "select count(*) = 8 as ok from public.clubs;"),
    ('anon', 'guest cannot read team sheets', "select count(*) = 0 as ok from public.team_sheets;"),
    ('anon', 'guest cannot read profiles', "select count(*) = 0 as ok from public.profiles;"),
    ('anon', 'guest cannot change a club', "with u as (update public.clubs set name = 'X' where code = 'TUR' returning 1) select count(*) = 0 as ok from u;"),
    ('manager', 'manager reads only own team sheet', "select array_agg(club) = array['TUR'] as ok from public.team_sheets;"),
    ('manager', 'manager can edit own team sheet', "with u as (update public.team_sheets set formation = '4-3-3' where club = 'TUR' returning 1) select count(*) = 1 as ok from u;"),
    ('manager', 'manager cannot edit another club''s sheet', "with u as (update public.team_sheets set formation = '5-4-1' where club = 'LAU' returning 1) select count(*) = 0 as ok from u;"),
    ('manager', 'manager reads only own profile', "select count(*) = 1 as ok from public.profiles;"),
    ('manager', 'manager cannot make themselves office', f"with u as (update public.profiles set role = 'office' where id = '{FAKE_MANAGER}' returning 1) select count(*) = 0 as ok from u;"),
    ('manager', 'manager cannot change a club directly', "with u as (update public.clubs set motto = 'x' where code = 'TUR' returning 1) select count(*) = 0 as ok from u;"),
    ('noclub', 'account with no club sees no team sheets', "select count(*) = 0 as ok from public.team_sheets;"),
    ('office', 'office reads every team sheet', "select count(*) >= 2 as ok from public.team_sheets;"),
    ('office', 'office reads every profile', "select count(*) >= 3 as ok from public.profiles;"),
    ('office', 'office can change a club', "with u as (update public.clubs set motto = 'test' where code = 'TUR' returning 1) select count(*) = 1 as ok from u;"),
]


# 0.4: "Set up your club". pre sets up rows with full rights; then the check runs as the user. The last item is
# SQL returning "ok", or {'error': text} when the database must refuse with that message.
REQ = "insert into public.club_requests (club, kind, name, code, crest_path, status, office_note) values "
SETUP_CHECKS = [
    ('anon', 'guest can read news', '', "select count(*) >= 0 as ok from public.news;"),
    ('anon', 'guest cannot send a club request', '', {'error': 'permission denied'},
     """select public.submit_club_request('{"name":"X FC"}');"""),
    ('manager', 'manager changes own colours and motto instantly', '',
     """select public.update_club_style('{"colour":"#0CF6F3","accent":"#0cf6f3","motto":"  Slow and steady "}');
        select motto = 'Slow and steady' and colour = '#0cf6f3' as ok from public.clubs where code = 'TUR';"""),
    ('manager', 'manager cannot save a bad colour', '', {'error': 'Colours must look like'},
     """select public.update_club_style('{"accent":"red"}');"""),
    ('manager', 'first request is a setup and marks the wizard done', '',
     """select public.submit_club_request('{"name":"FC Turtle","short_name":"Turtle","code":"TRT","notes":"hi"}');
        select (select kind from public.club_requests where club = 'TUR' and status = 'pending') = 'setup'
           and (select setup_at is not null from public.clubs where code = 'TUR') as ok;"""),
    ('manager', 'a resend replaces the pending request', '',
     """select public.submit_club_request('{"name":"FC Turtle"}'); select public.submit_club_request('{"name":"Turtle FC"}');
        select count(*) = 1 and min(name) = 'Turtle FC' as ok from public.club_requests where club = 'TUR' and status = 'pending';"""),
    ('manager', 'a fixed send-back is still a setup', REQ + "('TUR', 'setup', 'Bad Name', null, null, 'returned', 'fix');",
     """select public.submit_club_request('{"name":"FC Turtle"}');
        select kind = 'setup' as ok from public.club_requests where club = 'TUR' and status = 'pending';"""),
    ('manager', "manager cannot take another club's code", '', {'error': 'That code is taken'},
     """select public.submit_club_request('{"name":"FC Turtle","code":"SKS"}');"""),
    ('manager', 'manager cannot claim a code another club asked for', REQ + "('LAU', 'setup', 'Lads', 'ZZZ', null, 'pending', null);",
     {'error': 'That code is taken'}, """select public.submit_club_request('{"name":"FC Turtle","code":"ZZZ"}');"""),
    ('manager', "manager cannot use a crest from another club's folder", '', {'error': 'in your club'},
     """select public.submit_club_request('{"name":"FC Turtle","crest_path":"sks/crest.png"}');"""),
    ('manager', 'manager reads own request and the office note', REQ + "('TUR', 'setup', 'X FC', null, null, 'returned', 'Pick another name');",
     "select office_note = 'Pick another name' as ok from public.club_requests where club = 'TUR';"),
    ('manager', "manager cannot see another club's requests", REQ + "('LAU', 'setup', 'Lads', null, null, 'pending', null);",
     "select count(*) = 0 as ok from public.club_requests;"),
    ('manager', 'manager cannot write requests directly', '', {'error': 'row-level security'},
     REQ + "('TUR', 'setup', 'X FC', null, null, 'approved', null);"),
    ('manager', 'manager cannot approve a request', REQ + "('TUR', 'setup', 'X FC', null, null, 'pending', null);",
     {'error': 'Only the league office'}, "select public.review_club_request((select max(id) from public.club_requests), true);"),
    ('manager', 'manager cannot post news', '', {'error': 'row-level security'},
     "insert into public.news (kind, title) values ('post', 'x');"),
    ('manager', 'manager cannot list accounts', '', {'error': 'Only the league office'}, "select * from public.office_accounts();"),
    ('noclub', 'account with no club cannot send a request', '', {'error': 'linked to a club'},
     """select public.submit_club_request('{"name":"X FC"}');"""),
    ('office', 'office approval renames, recodes (cascading) and posts the crest reveal',
     REQ + "('TUR', 'setup', 'Turtle FC', 'TRT', 'tur/crest-1.png', 'pending', null);",
     f"""select public.review_club_request((select max(id) from public.club_requests), true);
        select (select name = 'Turtle FC' and crest_path = 'tur/crest-1.png' from public.clubs where code = 'TRT')
           and (select club = 'TRT' from public.profiles where id = '{FAKE_MANAGER}')
           and exists (select 1 from public.news where kind = 'crest_reveal' and club = 'TRT') as ok;"""),
    ('office', 'office must say why when sending back', REQ + "('TUR', 'setup', 'X FC', null, null, 'pending', null);",
     {'error': 'Say what needs changing'}, "select public.review_club_request((select max(id) from public.club_requests), false, '  ');"),
    ('office', 'office can list accounts', '', "select count(*) >= 3 as ok from public.office_accounts();"),
    ('manager', 'manager cannot switch the wizard back on', '', {'error': 'Only the league office'},
     "select public.reopen_club_setup('TUR');"),
    ('office', 'switching the wizard back on clears it and drops the pending request',
     "update public.clubs set setup_at = now() where code = 'TUR'; " + REQ + "('TUR', 'change', 'X FC', null, null, 'pending', null);",
     """select public.reopen_club_setup('TUR');
        select (select setup_at is null and setup_reset_at is not null from public.clubs where code = 'TUR')
           and not exists (select 1 from public.club_requests where club = 'TUR' and status = 'pending') as ok;"""),
    ('manager', 'manager can add a crest file in own folder', '',
     "with i as (insert into storage.objects (bucket_id, name) values ('crests', 'tur/crest-test.png') returning 1) select count(*) = 1 as ok from i;"),
    ('manager', "manager cannot add a crest file in another club's folder", '', {'error': 'row-level security'},
     "insert into storage.objects (bucket_id, name) values ('crests', 'sks/crest-test.png');"),
    ('manager', 'manager cannot overwrite the live crest', '',
     "with u as (update storage.objects set metadata = '{}'::jsonb where bucket_id = 'crests' and name = 'tur/crest.png' returning 1) select count(*) = 0 as ok from u;"),
    ('manager', 'after a reopen the next request is a setup again',
     "update public.clubs set setup_at = null, setup_reset_at = now() + interval '1 second' where code = 'TUR'; "
     + REQ.replace('values ', '') .rstrip() + " select 'TUR', 'setup', 'Old', null, null, 'approved', null;",
     """select public.submit_club_request('{"name":"FC Turtle"}');
        select kind = 'setup' as ok from public.club_requests where club = 'TUR' and status = 'pending';"""),
]


def main():
    failed = 0
    for who, desc, body in CHECKS:
        r = as_user(who, body)
        rows = rows_of(r)
        # "permission denied" is an even stronger "cannot": guests have no grant on private tables at all.
        denied = isinstance(r, dict) and 'permission denied' in r.get('error', '') and 'cannot' in desc
        ok = denied or bool(rows and rows[-1].get('ok'))
        failed += not ok
        print(f"{'PASS' if ok else 'FAIL'}  [{who:7}] {desc}" + ('' if ok else f'  -> {r}'))
    for who, desc, pre, *rest in SETUP_CHECKS:
        expect, body = (rest[0], rest[1]) if len(rest) == 2 else (None, rest[0])
        r = as_user(who, body, pre)
        if expect:
            ok = isinstance(r, dict) and expect['error'].lower() in r.get('error', '').lower()
        else:
            ok = bool(rows_of(r) and r[-1].get('ok'))
        failed += not ok
        print(f"{'PASS' if ok else 'FAIL'}  [{who:7}] {desc}" + ('' if ok else f'  -> {r}'))
    # Make sure nothing leaked out of the rolled-back transactions.
    left = sql(f"select count(*) as n from auth.users where id in ('{FAKE_MANAGER}', '{FAKE_NOCLUB}');")
    clean = rows_of(left) and left[0]['n'] == 0
    print('PASS  test accounts cleaned up' if clean else f'FAIL  test accounts left behind: {left}')
    failed += not clean
    total = len(CHECKS) + len(SETUP_CHECKS) + 1
    print(f'\n{total - failed}/{total} passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
