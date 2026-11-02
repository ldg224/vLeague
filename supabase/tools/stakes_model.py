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


# ---------------------------------------------------------------- strength from the players (so prices follow the season's rating changes)
# A club's strength is read from its players' current ratings: the best 1 goalkeeper, 4 defenders, 3 midfielders and 3 forwards by value (the engine's 4-3-3), and
# six averages of them. db 0078 computes exactly these from the players table, so a rating change moves the prices with no re-run. KEEP THE TWO IN STEP.
FEATURES = ['off_fwd', 'off_mid', 'off_def', 'def_gk', 'def_def', 'def_mid']
SLOTS = {'GK': 1, 'DEF': 4, 'MID': 3, 'FWD': 3}
KEY = {'GK': (0.0, 1.0), 'DEF': (0.3, 0.7), 'MID': (0.5, 0.5), 'FWD': (0.7, 0.3)}   # the weights the database's player value uses


def club_features(league, code):
    squad = [p for p in league['players'].values() if p['team'] == code]

    def best(pos):
        o, d = KEY[pos]
        return sorted((p for p in squad if p['position'] == pos), key=lambda p: -(o * p['offense'] + d * p['defense']))[:SLOTS[pos]]
    avg = lambda ps, k: sum(p[k] for p in ps) / len(ps) if ps else 5.0
    return [avg(best('FWD'), 'offense'), avg(best('MID'), 'offense'), avg(best('DEF'), 'offense'), avg(best('GK'), 'defense'), avg(best('DEF'), 'defense'), avg(best('MID'), 'defense')]


def jitter(league, seed):
    """The league with every club's attack and defence shifted at random, and every player a little, so the engine games cover a wide range of squads."""
    import random, copy
    rnd = random.Random(seed)
    lg = copy.deepcopy(league)
    shift = {c: (rnd.uniform(-1.6, 1.6), rnd.uniform(-1.6, 1.6)) for c in lg['teams']}
    clamp = lambda v: round(min(10.0, max(1.0, v)), 2)
    for p in lg['players'].values():
        so, sd = shift[p['team']]
        p['offense'] = clamp(p['offense'] + so + rnd.uniform(-1.0, 1.0)); p['defense'] = clamp(p['defense'] + sd + rnd.uniform(-1.0, 1.0))
    return lg


def _play_var(job):
    from hcl_sim.run import simulate, match_seed
    home, away, i = job
    lg = jitter(_league, match_seed('stakes-var', home, away, i))
    d = simulate(lg, home, away, seed=match_seed('stakes-var-game', home, away, i), include_frames=False)
    return {'home': home, 'away': away, 'i': i, 'hg': d['result']['home'], 'ag': d['result']['away'], 'fh': club_features(lg, home), 'fa': club_features(lg, away)}


def simvar(out, games=600, workers=22):
    import random
    league = load_league()
    codes = sorted(league['teams'])
    done = set()
    if Path(out).exists():
        for line in open(out):
            done.add(json.loads(line)['i'])
    rnd = random.Random(2026)
    jobs = []
    for i in range(games):
        h, a = rnd.sample(codes, 2)
        if i not in done: jobs.append((h, a, i))
    print(f'{len(jobs)} varied-squad games on {workers} cores', flush=True)
    t = time.time()
    with Pool(workers, _init, (league,)) as pool, open(out, 'a') as f:
        for n, r in enumerate(pool.imap_unordered(_play_var, jobs), 1):
            f.write(json.dumps(r) + '\n'); f.flush()
            if n % 25 == 0: print(f'{n}/{len(jobs)}  {time.time() - t:.0f}s', flush=True)


def solve(A, b):
    n = len(b); M = [row[:] + [b[i]] for i, row in enumerate(A)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(M[r][c])); M[c], M[p] = M[p], M[c]
        for r in range(n):
            if r != c:
                f = M[r][c] / M[c][c]
                for k in range(c, n + 1): M[r][k] -= f * M[c][k]
    return [M[i][n] / M[i][i] for i in range(n)]


def fitfeat(varpath, basepath):
    """Poisson regression:  log(goals expected by a side) = c + home*[at home] + sum a_k*own_k + sum b_k*opp_k,  k over the six features (centred on 6)."""
    league = load_league()
    base = {c: club_features(league, c) for c in league['teams']}
    rows = [json.loads(l) for l in open(varpath)]
    nvar = len(rows)
    for l in open(basepath):
        r = json.loads(l); r['fh'] = base[r['home']]; r['fa'] = base[r['away']]; rows.append(r)
    obs = []
    for r in rows:
        fh = [v - 6 for v in r['fh']]; fa = [v - 6 for v in r['fa']]
        obs.append(([1.0, 1.0] + fh + fa, r['hg'])); obs.append(([1.0, 0.0] + fa + fh, r['ag']))
    k = len(obs[0][0]); beta = [0.0] * k; beta[0] = math.log(1.5)
    ridge = 0.5
    for _ in range(40):   # Newton steps
        g = [0.0] * k; H = [[0.0] * k for _ in range(k)]
        for x, y in obs:
            mu = math.exp(sum(b * v for b, v in zip(beta, x)))
            for i in range(k):
                g[i] += (y - mu) * x[i]
                for j in range(k): H[i][j] += mu * x[i] * x[j]
        for i in range(1, k): g[i] -= ridge * beta[i]; H[i][i] += ridge
        step = solve(H, g); beta = [b + s for b, s in zip(beta, step)]
        if max(abs(s) for s in step) < 1e-7: break
    ll = ll0 = 0.0; buckets = {}
    for r in rows:
        fh = [v - 6 for v in r['fh']]; fa = [v - 6 for v in r['fa']]
        lh = math.exp(sum(b * v for b, v in zip(beta, [1.0, 1.0] + fh + fa))); la = math.exp(sum(b * v for b, v in zip(beta, [1.0, 0.0] + fa + fh)))
        ph, pd, pa = chances(lh, la)
        out = 'h' if r['hg'] > r['ag'] else 'a' if r['hg'] < r['ag'] else 'd'
        ll += math.log({'h': ph, 'd': pd, 'a': pa}[out]); ll0 += math.log(1 / 3)
        for kk, p in (('h', ph), ('d', pd), ('a', pa)):
            b = buckets.setdefault(min(int(p * 10), 9), [0, 0.0, 0]); b[0] += 1; b[1] += p; b[2] += (out == kk)
    n = len(rows)
    print(f'-- fit: {n} engine games ({nvar} with varied squads); mean log score {ll / n:.3f} against {ll0 / n:.3f} for a flat guess')
    for kk in sorted(buckets):
        c, p, w = buckets[kk]; print(f'-- fit: chance {kk * 10}-{kk * 10 + 10}%: said {p / c * 100:.1f}%, happened {w / c * 100:.1f}%  ({c})')
    names = ['intercept', 'home'] + ['own_' + f for f in FEATURES] + ['opp_' + f for f in FEATURES]
    print('insert into public.stakes_coef (name, value) values')
    print(',\n'.join(f"  ('{nm}', {b:.5f})" for nm, b in zip(names, beta)))
    print('on conflict (name) do update set value = excluded.value;')


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
    elif cmd == 'simvar': simvar(sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 600, int(sys.argv[4]) if len(sys.argv) > 4 else 22)
    elif cmd == 'fitfeat': fitfeat(sys.argv[2], sys.argv[3])
    else: print(__doc__)
