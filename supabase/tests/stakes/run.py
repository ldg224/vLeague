import json,sys,urllib.request,urllib.error
from pathlib import Path
T=(Path.home()/'.vleague'/'supabase-token.txt').read_text().strip()
def q(sql):
    r=urllib.request.Request('https://api.supabase.com/v1/projects/ywkhjpfzqtfssbxbvnbl/database/query',data=json.dumps({'query':sql}).encode(),headers={'Authorization':'Bearer '+T,'Content-Type':'application/json','User-Agent':'vl/1'})
    try: return json.load(urllib.request.urlopen(r,timeout=150))
    except urllib.error.HTTPError as e: return e.read().decode()
mig=''.join(open(p,encoding='utf-8').read() for p in sorted((Path(__file__).parents[2]/'migrations').glob('006[134]_stakes*.sql')))
test=open(sys.argv[1] if len(sys.argv)>1 else Path(__file__).with_name('01_flow.sql'),encoding='utf-8').read()
print(json.dumps(q('begin;\n'+mig+'\n'+test+'\nrollback;'),indent=1)[:6000])
