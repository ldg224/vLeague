"""Builds the match file: metadata, line-ups, events, statistics and position frames."""

import math
from datetime import datetime, timezone

from . import __version__
from .config import PITCH_LENGTH, PITCH_WIDTH, GOAL_WIDTH, GOAL_HEIGHT, TICK, HALF_SECONDS
from .tactics import slot_want


def _player_stats(m):
    # Who was on the pitch when (a goal is conceded only by those on it): off at a red card or a substitution, on at a substitution.
    left = {e['player']: e['t'] for e in m.events if e['type'] == 'card' and e['card'] in ('red', 'second_yellow')}
    left.update({e['off']: e['t'] for e in m.events if e['type'] == 'substitution'})
    came = {e['player']: e['t'] for e in m.events if e['type'] == 'substitution'}

    def on_pitch(pid, t):
        return came.get(pid, 0.0) <= t <= left.get(pid, float('inf'))

    stats = {}
    for p in m.players:
        stats[p.id] = {
            'minutes': 0, 'goals': 0, 'own_goals': 0, 'assists': 0, 'shots': 0, 'shots_on_target': 0, 'xg': 0.0,
            'passes': 0, 'passes_completed': 0, 'key_passes': 0, 'crosses': 0, 'touches': 0,
            'take_ons': 0, 'tackles': 0, 'tackles_won': 0, 'interceptions': 0, 'clearances': 0, 'blocks': 0,
            'aerials_won': 0, 'fouls': 0, 'fouled': 0, 'yellow': 0, 'red': 0, 'offsides': 0, 'miscontrols': 0,
            'saves': 0, 'goals_conceded': 0, 'distance_km': round(p.distance / 1000, 2),
        }
    for e in m.events:
        pid = e.get('player')
        s = stats.get(pid)
        t = e['type']
        if t == 'pass' and s:
            s['passes'] += 1
            s['touches'] += 1
            if e.get('outcome') == 'complete':
                s['passes_completed'] += 1
            if e.get('subtype') == 'cross':
                s['crosses'] += 1
        elif t == 'shot' and s:
            s['shots'] += 1
            s['touches'] += 1
            s['xg'] += e['xg']
            if e.get('outcome') in ('goal', 'saved'):
                s['shots_on_target'] += 1
            if e.get('assist_candidate') in stats:
                stats[e['assist_candidate']]['key_passes'] += 1
        elif t == 'goal':
            if e.get('own_goal'):
                stats[e['scorer']]['own_goals'] += 1
            elif e.get('scorer') in stats:
                stats[e['scorer']]['goals'] += 1
            if e.get('assist') in stats:
                stats[e['assist']]['assists'] += 1
            for p in m.players:
                if p.team != e['team'] and (p.is_gk or p.line == 'DEF') and on_pitch(p.id, e['t']):
                    stats[p.id]['goals_conceded'] += 1
        elif t == 'control' and s:
            s['touches'] += 1
            if e['how'] == 'interception':
                s['interceptions'] += 1
        elif t == 'tackle' and s:
            s['tackles'] += 1
            s['tackles_won'] += 1 if e.get('won') else 0
        elif t == 'take_on' and s:
            s['take_ons'] += 1
        elif t == 'clearance' and s:
            s['clearances'] += 1
        elif t == 'block' and s:
            s['blocks'] += 1
        elif t == 'aerial_duel' and s:
            s['aerials_won'] += 1
        elif t == 'foul' and s:
            s['fouls'] += 1
            if e.get('on') in stats:
                stats[e['on']]['fouled'] += 1
        elif t == 'card' and s:
            s['yellow' if e['card'] == 'yellow' else 'red'] += 1
        elif t == 'offside' and s:
            s['offsides'] += 1
        elif t == 'miscontrol' and s:
            s['miscontrols'] += 1
        elif t == 'save' and s:
            s['saves'] += 1

    total = m.t
    sent_off_at = {e['player']: e['t'] for e in m.events if e['type'] == 'card' and e['card'] in ('red', 'second_yellow')}
    for e in m.events:
        if e['type'] == 'substitution':
            sent_off_at[e['off']] = e['t']
    on_at = {e['player']: e['t'] for e in m.events if e['type'] == 'substitution'}
    for p in m.players:
        s = stats[p.id]
        played = sent_off_at.get(p.id, total) - on_at.get(p.id, 0.0)
        s['minutes'] = min(90, round(played / total * 90)) if total else 0
        s['xg'] = round(s['xg'], 2)
    return stats


# Ratings are worked out in rating.py from the finished match file (B-48, FotMob style), the same way js/live-rating.js does.
from .rating import OUT_OF_POSITION, ratings as _ratings   # noqa: E402  (OUT_OF_POSITION kept here for older callers)


def _team_stats(m, pstats):
    out = {}
    for team in (m.home, m.away):
        ids = [p.id for p in team.players]
        agg = lambda k: sum(pstats[i][k] for i in ids)
        ev = [e for e in m.events if e.get('team') == team.code]
        passes, done = agg('passes'), agg('passes_completed')
        shots = agg('shots')
        out['home' if team.side == 0 else 'away'] = {
            'goals': m.score[team.side],
            'xg': round(sum(pstats[i]['xg'] for i in ids), 2),
            'possession': round(100 * m.poss_time[team.side] / max(sum(m.poss_time), 1e-9), 1),
            'shots': shots,
            'shots_on_target': agg('shots_on_target'),
            'big_chances': sum(1 for e in ev if e['type'] == 'shot' and e['xg'] >= 0.3),
            'passes': passes,
            'passes_completed': done,
            'pass_accuracy': round(100 * done / passes, 1) if passes else 0.0,
            'crosses': agg('crosses'),
            'tackles': agg('tackles'),
            'tackles_won': agg('tackles_won'),
            'interceptions': agg('interceptions'),
            'clearances': agg('clearances'),
            'blocks': agg('blocks'),
            'saves': agg('saves'),
            'fouls': agg('fouls'),
            'yellow_cards': agg('yellow'),
            'red_cards': agg('red'),
            'corners': sum(1 for e in ev if e['type'] == 'corner'),
            'offsides': agg('offsides'),
            'distance_km': round(sum(pstats[i]['distance_km'] for i in ids), 1),
        }
    return out


def _team_block(team):
    block = {
        'code': team.code, 'name': team.name, 'colour': team.colour, 'formation': team.formation,
        'tactics': team.tactics, 'captain': team.captain or None, 'takers': team.takers,
    }
    if team.form:
        block['form'] = round(team.form, 4)
    if team.boost:
        block['captain_boost'] = True
        block['boost_low_minutes'] = team.boost['low_minutes']
    block['lineup'] = [{'idx': p.idx, 'id': p.id, 'name': p.name, 'position': p.position, 'slot': p.slot, **({'sub': True} if p.seat else {})}
                       for p in team.players]
    return block


def _renumber(m):
    """A substitute is added at the end of m.players when he comes on. Put him back with his team (home players first, then away, as
    the viewers expect) and give him a column in every frame: before he comes on he sits at his seat beside the pitch."""
    order = m.home.players + m.away.players
    if [p.idx for p in order] == list(range(len(order))):
        return
    new = {p.idx: i for i, p in enumerate(order)}
    rows = []
    for row in m.frames:
        out = row[:6]
        out[4] = new.get(row[4], -1) if row[4] >= 0 else -1
        for p in order:
            k = 6 + 2 * p.idx
            out += row[k:k + 2] if k + 1 < len(row) else [int(round(p.seat[0] * 10)), int(round(p.seat[1] * 10))]
        rows.append(out)
    m.frames = rows
    for p in order:
        p.idx = new[p.idx]
    m.players = order


def build(m, include_frames=True):
    _renumber(m)
    pstats = _player_stats(m)
    goals = [e for e in m.events if e['type'] == 'goal']
    out = {
        'format': 'hcl-match',
        'format_version': 1,
        'engine': {'name': 'hcl_sim', 'version': __version__, 'seed': m.seed, 'tick_seconds': TICK,
                   'generated_at': datetime.now(timezone.utc).isoformat(timespec='seconds')},
        'pitch': {'length': PITCH_LENGTH, 'width': PITCH_WIDTH, 'goal_width': GOAL_WIDTH, 'goal_height': GOAL_HEIGHT,
                  'origin': 'top-left', 'units': 'metres'},
        'match': m.info,
        'teams': {'home': _team_block(m.home), 'away': _team_block(m.away)},
        'players': [{'idx': p.idx, 'id': p.id, 'name': p.name, 'team': p.team, 'position': p.position, 'slot': p.slot,
                     'attributes': p.attrs} for p in m.players],
        'periods': m.periods,
        'result': {
            'home': m.score[0], 'away': m.score[1],
            'goals': [{'minute': g['minute'], 'team': g['team'], 'scorer': g['scorer'], 'assist': g.get('assist'),
                       'own_goal': g['own_goal']} for g in goals],
        },
        'stats': {'teams': _team_stats(m, pstats), 'players': pstats,
                  'ball_in_play_minutes': round(m.in_play_time / 60, 1)},
        'events': m.events,
    }
    for pid, r in _ratings(out).items():   # B-48
        out['stats']['players'][pid]['rating'] = r
    if include_frames:
        out['frames'] = {
            'fps': m.fps,
            'scale': 10,
            'fields': ['t', 'ball_x', 'ball_y', 'ball_z', 'holder', 'in_play'] + [f'p{p.idx}_{a}' for p in m.players for a in ('x', 'y')],
            'data': m.frames,
        }
    return out
