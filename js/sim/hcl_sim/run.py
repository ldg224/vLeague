"""High-level entry points: simulate a match or a week of fixtures."""

import gzip
import hashlib
import json
import os
import time

from . import output, teams
from .engine import Match
from .validate import validate


def match_seed(*parts):
    return int(hashlib.sha256('|'.join(str(p) for p in parts).encode()).hexdigest()[:8], 16)


def simulate(league, home_code, away_code, seed=None, fps=5, info=None, include_frames=True, on_progress=None):
    home = teams.build_team(league, home_code)
    away = teams.build_team(league, away_code)
    if seed is None:
        seed = match_seed(home_code, away_code, time.time())
    info = dict(info or {})
    info.update({'home': home_code, 'away': away_code})
    m = Match(home, away, seed=seed, fps=fps, info=info).run(on_progress=on_progress)
    return output.build(m, include_frames=include_frames)


def write_match(data, path):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    text = json.dumps(data, separators=(',', ':'))
    if path.endswith('.gz'):
        with gzip.open(path, 'wt', encoding='utf-8') as f:
            f.write(text)
    else:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(text)
    return os.path.getsize(path)


def read_match(path):
    if path.endswith('.gz'):
        with gzip.open(path, 'rt', encoding='utf-8') as f:
            return json.load(f)
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def simulate_week(league, week, out_dir, fps=5):
    """Simulates every fixture in a week of the season, writing <fixture id>.json.gz like the site's match files."""
    fixtures = [fx for fx in league['schedule'] if str(fx.get('week')) == str(week)]
    if not fixtures:
        raise ValueError(f'No fixtures with both teams set in week {week}')
    squad = lambda code: sum(p['team'] == code for p in league['players'].values())
    done = []
    for fx in fixtures:
        short = [c for c in (fx['home'], fx['away']) if squad(c) < 7]
        if short:
            print(f"  skipped {fx['home']} v {fx['away']}: {', '.join(short)} has fewer than 7 players")
            continue
        h, a = teams.resolve_team(league, fx['home']), teams.resolve_team(league, fx['away'])
        info = {'fixture_id': fx.get('id'), 'week': fx.get('week'), 'date': fx.get('date'), 'time': fx.get('time')}
        data = simulate(league, h, a, seed=match_seed(fx.get('id') or f'{h}-{a}'), fps=fps, info=info)
        path = os.path.join(out_dir, f"{fx.get('id') or f'w{week}-{h}-{a}'.lower()}.json.gz")
        size = write_match(data, path)
        done.append((fx, data, path, size, validate(data)))
    return done
