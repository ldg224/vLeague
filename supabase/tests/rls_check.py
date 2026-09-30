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


def as_user(who, body):
    """Run body as a given user inside a rolled-back transaction; return the last statement's rows (or the error)."""
    if who == 'anon':
        claims, role = '{"role":"anon"}', 'anon'
    else:
        uid = {'manager': FAKE_MANAGER, 'noclub': FAKE_NOCLUB}.get(who) or \
            "' || (select id from auth.users where email = 'lukedanielgrogan@gmail.com') || '"
        claims, role = f'{{"sub":"{uid}","role":"authenticated"}}', 'authenticated'
    q = (f"begin; {SETUP} select set_config('request.jwt.claims', '{claims}', true); set local role {role}; "
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
    # Make sure nothing leaked out of the rolled-back transactions.
    left = sql(f"select count(*) as n from auth.users where id in ('{FAKE_MANAGER}', '{FAKE_NOCLUB}');")
    clean = rows_of(left) and left[0]['n'] == 0
    print('PASS  test accounts cleaned up' if clean else f'FAIL  test accounts left behind: {left}')
    failed += not clean
    print(f'\n{len(CHECKS) + 1 - failed}/{len(CHECKS) + 1} passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
