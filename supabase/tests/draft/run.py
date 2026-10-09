"""Run the draft test suite against the live Supabase project. Everything happens inside one transaction that is ALWAYS rolled
back, so nothing is left behind: scratch drafts are made and thrown away, and players "drafted" in the tests go back to free agents.

    python supabase/tests/draft/run.py                  # every batch, one transaction each
    python supabase/tests/draft/run.py 02 03            # only those batches (by number)
    python supabase/tests/draft/run.py --pre path.sql   # apply a migration inside the test transaction first (try it before applying it for real)

Needs the Management API token in ~/.vleague/supabase-token.txt (see CLAUDE.md in the workspace). Read-only for real data.
Batches: 01 control and picks, 02 the clock, 03 office tools and holes (taking a pick back), 04 queues and permissions,
05 active times (random property tests, DST), 06 the 0041 hardening. Each prints PASS or FAIL per check.
"""
import json, os, sys, urllib.error, urllib.request
from pathlib import Path

HERE = Path(__file__).parent
TOKEN = (Path.home() / '.vleague' / 'supabase-token.txt').read_text().strip()
REF = 'ywkhjpfzqtfssbxbvnbl'
TAIL = 'select name, ok, detail from t_log order by n;\nrollback;\n'


def query(sql):
    req = urllib.request.Request(f'https://api.supabase.com/v1/projects/{REF}/database/query', data=json.dumps({'query': sql}).encode(),
                                 headers={'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json', 'User-Agent': 'vleague-draft-tests/1'})
    try:
        return json.load(urllib.request.urlopen(req, timeout=170))
    except urllib.error.HTTPError as e:
        return {'ERROR': e.read().decode()}


def run(files, pre=''):
    res = query((HERE / '_harness.sql').read_text(encoding='utf-8') + pre + ''.join(f.read_text(encoding='utf-8').replace(TAIL, '') for f in files) + TAIL)
    if isinstance(res, dict):
        print(res)
        return 1
    bad = 0
    for r in res:
        print(('PASS ' if r['ok'] else 'FAIL ') + r['name'] + ('' if r['ok'] else '   <-- ' + str(r['detail'])))
        bad += not r['ok']
    print(f'{len(res)} checks, {bad} failed')
    return bad


if __name__ == '__main__':
    args = sys.argv[1:]
    pre = ''
    if '--pre' in args:
        i = args.index('--pre')
        pre = Path(args[i + 1]).read_text(encoding='utf-8') + '\n'
        del args[i:i + 2]
    files = sorted(f for f in HERE.glob('[0-9][0-9]_*.sql') if not args or f.name[:2] in args)
    failed = 0
    for f in files:   # one transaction per batch keeps them independent of each other
        print(f'===== {f.name}')
        failed += run([f], pre)
    sys.exit(1 if failed else 0)
