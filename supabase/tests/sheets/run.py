"""Team sheet tests (S-49 shape, 0097) against the live Supabase project, inside one transaction that is ALWAYS rolled back.

    python supabase/tests/sheets/run.py                                         # after 0097 is applied
    python supabase/tests/sheets/run.py --pre supabase/migrations/0097_sheet_shape.sql   # try 0097 inside the test transaction first

Uses the draft suite's harness (draft/_harness.sql) and its runner. Needs the Management API token in ~/.supabase/token.txt.
"""
import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent / 'draft'))
import run as draft_run   # noqa: E402  (query/run and the harness live there)

if __name__ == '__main__':
    args = sys.argv[1:]
    pre = ''
    if '--pre' in args:
        i = args.index('--pre')
        pre = Path(args[i + 1]).read_text(encoding='utf-8') + '\n'
        del args[i:i + 2]
    draft_run.HERE = HERE.parent / 'draft'   # the harness file
    files = sorted(f for f in HERE.glob('[0-9][0-9]_*.sql') if not args or f.name[:2] in args)
    failed = 0
    for f in files:
        print(f'===== {f.name}')
        failed += draft_run.run([f], pre)
    sys.exit(1 if failed else 0)
