"""Fits the goals model behind the Stakes result prices to the real match engine (js/sim/hcl_sim).

  python stakes_model.py sim  <out.jsonl> [games_per_pairing=12] [workers=22]   play the engine for every ordered pairing of active clubs (about 23 s a game, one core each)
  python stakes_model.py fit  <out.jsonl>                                       fit  goals ~ Poisson(exp(mu + home_edge + attack(team) - defence(opponent)))  and print the SQL

Why a fitted model and not the engine for every price: one engine game takes about 23 seconds, so the chances for a whole season cannot be simulated one by one.
Instead the engine plays a batch once, a goals model is fitted to what it did, and the database turns that model into the chances of a home win, a draw and an away
win (db 0077). Run it again when squads change (the draft, transfers) or the engine changes. It needs the Supabase token at ~/.vleague/supabase-token.txt (squads are read
with a select only) and nothing outside the standard library.
"""
import json, math, sys, time, urllib.request
from multiprocessing import Pool
from pathlib import Path

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[2] / 'js' / 'sim'))
PROJECT = 'ywkhjpfzqtfssbxbvnbl'


def q(sql):
    token = (Path.home() / '.vleague' / 'supabase-token.txt').read_text().strip()
    r = urllib.request.Request(f'https://api.supabase.com/v1/projects/{PROJECT}/database/query', data=json.dumps({'query': sql}).encode(),
                               headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'User-Agent': 'vl/1'})
    return json.load(urllib.request.urlopen(r, timeout=150))


def load_league():
    clubs = q("select code, name, colour from clubs where status = 'active' order by code")
    players = q('select id, name, position, offense, defense, club from players where club is not null')
    scale = lambda v: min(10, max(1, round(float(v) * 100) / 100))   # as js/simulate.js does
    codes = {c['code'] for c in clubs}
    return {
        'teams': {c['code']: {'code': c['code'], 'name': c['name'], 'manager': '', 'colour': c['colour'] or '#888888'} for c in clubs},
        'players': {p['id']: {'id': p['id'], 'name': p['name'], 'team': p['club'], 'position': p['position'], 'offense': scale(p['offense']), 'defense': scale(p['defense'])}
                    for p in players if p['club'] in codes},
        'attributes': {}, 'tactics': {c['code']: {} for c in clubs}, 'schedule': [],
    }


_league = None


def _init(league):
    global _league
    _league = league


def _play(job):
    from hcl_sim.run import simulate, match_seed
    home, away, i = job
    d = simulate(_league, home, away, seed=match_seed('stakes-model', home, away, i), include_frames=False)
    return {'home': home, 'away': away, 'i': i, 'hg': d['result']['home'], 'ag': d['result']['away']}


def sim(out, games=12, workers=22):
    league = load_league()
    codes = sorted(league['teams'])
    done = set()
    if Path(out).exists():
        for line in open(out):
            r = json.loads(line); done.add((r['home'], r['away'], r['i']))
    jobs = [(h, a, i) for i in range(games) for h in codes for a in codes if h != a and (h, a, i) not in done]
    print(f'{len(jobs)} games to play on {workers} cores', flush=True)
    t = time.time()
    with Pool(workers, _init, (league,)) as pool, open(out, 'a') as f:
        for n, r in enumerate(pool.imap_unordered(_play, jobs), 1):
            f.write(json.dumps(r) + '\n'); f.flush()
            if n % 25 == 0: print(f'{n}/{len(jobs)}  {time.time() - t:.0f}s', flush=True)


def poisson_pmf(lam, kmax=12):
    p = [math.exp(-lam)]
    for k in range(1, kmax + 1): p.append(p[-1] * lam / k)
    return p


def chances(lh, la):
    a, b = poisson_pmf(lh), poisson_pmf(la)
    ph = sum(a[i] * b[j] for i in range(13) for j in range(13) if i > j)
    pd = sum(a[i] * b[i] for i in range(13))
    pa = sum(a[i] * b[j] for i in range(13) for j in range(13) if i < j)
    t = ph + pd + pa
    return ph / t, pd / t, pa / t


def fit(path):
    rows = [json.loads(l) for l in open(path)]
    codes = sorted({r['home'] for r in rows})
    n = len(rows)
    # Poisson counts: goals by a side = mu * (home edge if at home) * attack(side) * weakness(opponent); each parameter in turn is scaled so that its expected goals match
    # the goals seen (alternating multiplicative updates; they converge for this form). The database uses defence = 1 / weakness.
    mu, hadv = 1.5, 1.0
    att = {c: 1.0 for c in codes}; weak = {c: 1.0 for c in codes}
    obs = [(r['home'], r['away'], r['hg'], True) for r in rows] + [(r['away'], r['home'], r['ag'], False) for r in rows]   # (scorer, opponent, goals, scorer at home)
    lam = lambda s, o, home: mu * (hadv if home else 1.0) * att[s] * weak[o]
    for _ in range(800):
        mu *= sum(g for _, _, g, _ in obs) / sum(lam(s, o, h) for s, o, _, h in obs)
        hg = sum(g for _, _, g, h in obs if h); hexp = sum(lam(s, o, h) for s, o, _, h in obs if h)
        hadv *= hg / hexp
        for c in codes:
            att[c] *= sum(g for s, _, g, _ in obs if s == c) / sum(lam(s, o, h) for s, o, _, h in obs if s == c)
        for c in codes:
            weak[c] *= sum(g for _, o, g, _ in obs if o == c) / sum(lam(s, o, h) for s, o, _, h in obs if o == c)
        ga = math.exp(sum(math.log(att[c]) for c in codes) / len(codes)); att = {c: att[c] / ga for c in codes}
        gw = math.exp(sum(math.log(weak[c]) for c in codes) / len(codes)); weak = {c: weak[c] / gw for c in codes}
    dfn = {c: 1 / weak[c] for c in codes}
    # (mu is per away side; 'hadv' scales home sides)
    # how well does the model predict what the engine did?  (log score against a flat 1/3 guess, and the calibration of the chances)
    ll = ll0 = 0.0; buckets = {}
    for r in rows:
        lh = mu * hadv * att[r['home']] / dfn[r['away']]; la = mu * att[r['away']] / dfn[r['home']]
        ph, pd, pa = chances(lh, la)
        out = 'h' if r['hg'] > r['ag'] else 'a' if r['hg'] < r['ag'] else 'd'
        ll += math.log({'h': ph, 'd': pd, 'a': pa}[out]); ll0 += math.log(1 / 3)
        for k, p in (('h', ph), ('d', pd), ('a', pa)):
            b = buckets.setdefault(min(int(p * 10), 9), [0, 0.0, 0]); b[0] += 1; b[1] += p; b[2] += (out == k)
    print(f'-- {n} engine games, home goals {sum(r["hg"] for r in rows) / n:.2f}, away goals {sum(r["ag"] for r in rows) / n:.2f}')
    print(f'-- mean log score: model {ll / n:.3f}, flat guess {ll0 / n:.3f}')
    for k in sorted(buckets):
        c, p, w = buckets[k]
        print(f'-- chance {k * 10}-{k * 10 + 10}%: said {p / c * 100:.1f}%, happened {w / c * 100:.1f}%  ({c})')
    print(f"\nupdate public.stakes_settings set model_mu = {mu:.4f}, model_home = {hadv:.4f} where id = 1;")
    print('insert into public.stakes_model (club, attack, defence) values')
    print(',\n'.join(f"  ('{c}', {att[c]:.4f}, {dfn[c]:.4f})" for c in codes))
    print('on conflict (club) do update set attack = excluded.attack, defence = excluded.defence, fitted_at = now();')


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd == 'sim': sim(sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 12, int(sys.argv[4]) if len(sys.argv) > 4 else 22)
    elif cmd == 'fit': fit(sys.argv[2])
    else: print(__doc__)
