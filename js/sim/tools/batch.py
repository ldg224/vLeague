"""S-40 shot check: simulate N offline matches (no frames) and print shooting stats.

Run from js/sim:  python tools/batch.py [matches=12] [workers=6]
Uses the synthetic league from the tests (two sides of different strength), seeds 1..N.
Real top-league reference per match (both teams): about 25 shots, 8.5 on target, 2.8 goals, ~62% of shots
from inside the box, average shot distance ~17 m.
"""
import math
import os
import sys
from multiprocessing import Pool

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), 'tests'))


def one(seed):
    from test_engine import synthetic_league
    from hcl_sim.run import simulate
    d = simulate(synthetic_league(), 'AAA', 'BBB', seed=seed, include_frames=False)
    shots = []
    for e in d['events']:
        if e['type'] != 'shot' or e.get('subtype') == 'penalty':
            continue
        ax = e['x'] if e['team'] == 'AAA' else 105 - e['x']
        ay = e['y'] if e['team'] == 'AAA' else 68 - e['y']
        shots.append({'d': math.hypot(105 - ax, ay - 34), 'box': ax >= 88.5 and 13.84 <= ay <= 54.16, 'wide': abs(ay - 34) > 16,
                      'xg': e.get('xg') or 0, 'on': e.get('on_target'), 'head': e.get('body') == 'head', 'out': e.get('outcome')})
    goals = sum(1 for e in d['events'] if e['type'] == 'goal')
    return goals, shots, d['result']


if __name__ == '__main__':
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 12
    w = int(sys.argv[2]) if len(sys.argv) > 2 else 6
    with Pool(w) as pool:
        res = pool.map(one, range(1, n + 1))
    goals = sum(r[0] for r in res)
    shots = [s for r in res for s in r[1]]
    home_wins = sum(1 for r in res if r[2]['home'] > r[2]['away']) if isinstance(res[0][2], dict) and 'home' in res[0][2] else None
    k = len(res)
    avg = lambda f: sum(f(s) for s in shots) / max(len(shots), 1)
    print(f'matches {k}  goals/match {goals / k:.2f}  shots/match {len(shots) / k:.1f}  on target/match {sum(1 for s in shots if s["on"]) / k:.1f}')
    print(f'avg distance {avg(lambda s: s["d"]):.1f} m  in box {avg(lambda s: s["box"]):.0%}  inside 12 m {avg(lambda s: s["d"] < 12):.0%}  '
          f'over 25 m {avg(lambda s: s["d"] > 25):.0%}  wide angle {avg(lambda s: s["wide"]):.0%}  xG/shot {avg(lambda s: s["xg"]):.3f}  headers {avg(lambda s: s["head"]):.0%}  blocked {avg(lambda s: s["out"] == "blocked"):.0%}')
    if home_wins is not None:
        print(f'stronger side (AAA) wins {home_wins}/{k}')
