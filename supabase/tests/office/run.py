"""Office (S-35) database tests. Each test file runs after migrations 0091 and 0092 and _setup.sql inside one transaction that is rolled back,
so nothing is left on the live project. Needs the Management API token in ~/.vleague/supabase-token.txt (never commit it).

    python supabase/tests/office/run.py              # every test file
    python supabase/tests/office/run.py 02_trades.sql
"""
import json, sys, urllib.request, urllib.error
from pathlib import Path

HERE = Path(__file__).parent
T = (Path.home() / '.vleague' / 'supabase-token.txt').read_text().strip()


def q(sql):
    r = urllib.request.Request('https://api.supabase.com/v1/projects/ywkhjpfzqtfssbxbvnbl/database/query', data=json.dumps({'query': sql}).encode(),
                               headers={'Authorization': 'Bearer ' + T, 'Content-Type': 'application/json', 'User-Agent': 'vl/1'})
    try:
        return json.load(urllib.request.urlopen(r, timeout=150))
    except urllib.error.HTTPError as e:
        return {'error': e.read().decode()[:2000]}


mig = '\n'.join((HERE.parents[1] / 'migrations' / m).read_text(encoding='utf-8') for m in ('0091_office.sql', '0092_cap_penalties.sql'))
setup = (HERE / '_setup.sql').read_text(encoding='utf-8')
files = [HERE / a for a in sys.argv[1:]] or sorted(p for p in HERE.glob('[0-9]*.sql'))
passed = failed = 0
for f in files:
    rows = q('begin;\n' + mig + '\n' + setup + '\n' + f.read_text(encoding='utf-8') + '\nrollback;')
    print(f'== {f.name}')
    if not isinstance(rows, list):
        print('FAIL  the file did not run:', rows)
        failed += 1
        continue
    for r in rows:
        print(f"{'PASS' if r['ok'] else 'FAIL'}  {r['name']}" + ('' if r['ok'] else f"  -> {r['detail']}"))
        passed += bool(r['ok'])
        failed += not r['ok']
left = q("select count(*) as n from auth.users where email like 'office-test-%@example.invalid';")
clean = isinstance(left, list) and left[0]['n'] == 0
print('PASS  test accounts cleaned up' if clean else f'FAIL  test accounts left behind: {left}')
passed += clean
failed += not clean
print(f'\n{passed}/{passed + failed} passed')
sys.exit(1 if failed else 0)
