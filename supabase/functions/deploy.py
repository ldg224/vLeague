"""Deploy a Supabase Edge Function from this folder with the Management API (no Supabase CLI or Node needed).

    python supabase/functions/deploy.py invite-manager

Needs the Management API token in C:\\Users\\offic\\.vleague\\supabase-token.txt (never commit it). The function gets
SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from Supabase itself; no secrets live in this repo.
"""
import json
import sys
import urllib.request
import uuid
from pathlib import Path

REF = 'ywkhjpfzqtfssbxbvnbl'
TOKEN = (Path.home() / '.vleague' / 'supabase-token.txt').read_text().strip()
# These check their own secret or signed link (pg_cron and email links carry no session), so Supabase must not
# require a signed-in caller. Every other function does.
OPEN = {'send-reminders', 'email-unsubscribe'}


def deploy(slug):
    folder = Path(__file__).parent / slug
    files = sorted(p for p in folder.rglob('*') if p.is_file())
    boundary = uuid.uuid4().hex
    meta = {'name': slug, 'entrypoint_path': 'index.ts', 'verify_jwt': slug not in OPEN}
    parts = [f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n{json.dumps(meta)}\r\n'.encode()]
    for f in files:
        rel = f.relative_to(folder).as_posix()
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{rel}"\r\n'
                     f'Content-Type: application/typescript\r\n\r\n'.encode() + f.read_bytes() + b'\r\n')
    parts.append(f'--{boundary}--\r\n'.encode())
    req = urllib.request.Request(
        f'https://api.supabase.com/v1/projects/{REF}/functions/deploy?slug={slug}',
        data=b''.join(parts), method='POST',
        headers={'Authorization': f'Bearer {TOKEN}', 'Content-Type': f'multipart/form-data; boundary={boundary}',
                 'User-Agent': 'vleague-deploy'})
    try:
        with urllib.request.urlopen(req) as r:
            out = json.loads(r.read())
            print(f"Deployed {out.get('slug')} version {out.get('version')} ({out.get('status')})")
    except urllib.error.HTTPError as e:
        sys.exit(f'Deploy failed ({e.code}): {e.read().decode()[:500]}')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    deploy(sys.argv[1])
