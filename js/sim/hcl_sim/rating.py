"""Match ratings, FotMob style (B-48, 27 Nov 2026).

FotMob's formula is not public, so this follows how its ratings behave: everyone starts at 6.0; goals and assists count most; the
chances a player makes and takes (xG, xA, key passes, shots on target), his dribbles, tackles, interceptions, blocks and clearances, and
a keeper's saves and the goals he prevents (xG on target faced minus goals let in) add to it; errors that give the other side a shot
or a goal, being dribbled past, cards, own goals, missed penalties and, for keepers and defenders, goals conceded take away. A clean
sheet helps keepers and defenders. Volume is measured against what a typical player in that position does over the same time
(NORM), so an average game is about 6.6-6.8, a good one 7.5-8.3, a brace about 8.5 and a hat-trick 9 or more. Ratings run 3.0-10.0.

It works from the match file itself (players, teams, periods, events), so js/live-rating.js runs the same steps on the events up
to any moment of the match and gets the same numbers at full time. KEEP THE TWO IN STEP.
"""

import math

from .tactics import slot_want

BASE = 6.0
LOW, HIGH = 3.0, 10.0
# What a typical player in that position adds over a full match (measured on 30 real-squad matches, 27 Nov 2026), so the average
# lands at about 6.7 whatever the position.
NORM = {'GK': -0.76, 'DEF': -0.48, 'MID': 0.00, 'FWD': 1.05}
GOAL = {'GK': 1.5, 'DEF': 1.5, 'MID': 1.35, 'FWD': 1.25}   # a goal from deeper is rarer, so it counts a little more (as FotMob)
# S-25: taken off for playing out of position (keep js/pitch.js positionPenalty in step).
OUT_OF_POSITION = {
    'GK': {'DEF': 4.0, 'MID': 4.0, 'FWD': 4.0},
    'DEF': {'GK': 3.5, 'MID': 0.5, 'FWD': 3.0},
    'MID': {'GK': 3.5, 'DEF': 0.5, 'FWD': 0.5},
    'FWD': {'GK': 4.0, 'DEF': 3.0, 'MID': 0.5},
}
ERROR_WINDOW = 10.0
VOLUME = 0.7   # how much the volume actions (everything but goals, assists, cards and own goals) count: FotMob's spread is narrow   # seconds: a loss in his own half that the other side turns into a shot within this time is an error


def shape(r):
    """Diminishing returns above 6.8 (a good game is 7.5-8.3, a brace about 8.5); past 8.4 it stretches again so a hat-trick reaches
    9+ and a freak game 10 (B-20). Below 6.8 the raw score is kept."""
    if r <= 6.8:
        return r
    v = 6.8 + 2.2 * (1 - math.exp(-(r - 6.8) / 1.5))
    return v if v <= 8.4 else min(HIGH, 8.4 + (v - 8.4) * 3.5)


def _blank():
    return {'goals': 0, 'own': 0, 'assists': 0, 'key': 0, 'xa': 0.0, 'xg': 0.0, 'sot': 0, 'passes': 0, 'done': 0, 'tackles': 0,
            'inter': 0, 'clear': 0, 'blocks': 0, 'dribbles': 0, 'beaten': 0, 'aerials': 0, 'miscontrols': 0, 'fouls': 0, 'offsides': 0,
            'yellow': 0, 'red': 0, 'saves': 0, 'conceded': 0, 'xgot_faced': 0.0, 'pen_missed': 0, 'pen_won': 0, 'pen_conceded': 0,
            'err_shot': 0, 'err_goal': 0}


def tallies(data, t=None):
    """Each player's counts from the events up to match second t (all of them if t is None)."""
    t = float('inf') if t is None else t
    home = data['teams']['home']['code']
    S = {p['id']: _blank() for p in data['players']}
    team = {p['id']: p['team'] for p in data['players']}
    gk = {p['id']: p['slot'] == 'GK' for p in data['players']}
    left, came = {}, {}
    for e in data['events']:
        if e['type'] == 'card' and e.get('card') != 'yellow':
            left[e['player']] = e['t']
        if e['type'] == 'substitution':
            left[e['off']] = e['t']
            came[e['player']] = e['t']

    def on_pitch(pid, at):
        return came.get(pid, 0.0) <= at <= left.get(pid, float('inf'))

    def attacks_right(code, at):   # which way `code` attacks at match second `at`
        per = [p for p in data['periods'] if p['start_t'] <= at + 1e-6] or data['periods'][:1]
        right = not per or per[-1]['home_attacks'] == 'right'
        return right if code == home else not right

    losses = []   # events where a ball was lost in the loser's own half: miscontrols and intercepted passes
    err_by_shot = {}   # shot id -> the player whose error gave it
    score = [0, 0]
    for e in data['events']:
        if e['t'] > t:
            break
        pid, typ = e.get('player'), e['type']
        s = S.get(pid)
        if typ == 'pass' and s:
            s['passes'] += 1
            if e.get('outcome') == 'complete':
                s['done'] += 1
            elif e.get('outcome') == 'intercepted':
                losses.append(e)
        elif typ == 'shot':
            pen = e.get('subtype') == 'penalty'
            if s:
                if e.get('outcome') in ('goal', 'saved'):
                    s['sot'] += 1
                if not pen:
                    s['xg'] += e.get('xg') or 0.0
                if pen and e.get('outcome') not in ('goal', None):
                    s['pen_missed'] += 1
            a = S.get(e.get('assist_candidate'))
            if a:
                a['key'] += 1
                a['xa'] += e.get('xg') or 0.0
            if e.get('outcome') in ('goal', 'saved'):
                for q in S:
                    if gk[q] and team[q] != e.get('team') and on_pitch(q, e['t']):
                        S[q]['xgot_faced'] += e.get('xg') or 0.0
            # An error: the shot came within ERROR_WINDOW s of a ball the other side lost in its own half, with the ball not lost again.
            for L in reversed(losses):
                if e['t'] - L['t'] > ERROR_WINDOW:
                    break
                if L.get('team') != e.get('team') and e.get('poss', 0) - L.get('poss', 0) <= 1 and S.get(L['player']) is not None:
                    S[L['player']]['err_shot'] += 1
                    err_by_shot[e['id']] = L['player']
                    losses.remove(L)
                    break
        elif typ == 'goal':
            if e.get('own_goal'):
                if S.get(e.get('scorer')):
                    S[e['scorer']]['own'] += 1
            elif S.get(e.get('scorer')):
                S[e['scorer']]['goals'] += 1
            if S.get(e.get('assist')):
                S[e['assist']]['assists'] += 1
            score[0 if e['team'] == home else 1] += 1
            for q in S:
                if team[q] != e['team'] and on_pitch(q, e['t']):
                    S[q]['conceded'] += 1
            if e.get('shot') in err_by_shot:
                S[err_by_shot[e['shot']]]['err_goal'] += 1
        elif typ == 'control' and s and e.get('how') == 'interception':
            s['inter'] += 1
        elif typ == 'tackle' and s and e.get('won'):
            s['tackles'] += 1
        elif typ == 'take_on' and s:
            s['dribbles'] += 1
            if S.get(e.get('opponent')):
                S[e['opponent']]['beaten'] += 1
        elif typ == 'clearance' and s:
            s['clear'] += 1
        elif typ == 'block' and s:
            s['blocks'] += 1
        elif typ == 'aerial_duel' and s:
            s['aerials'] += 1
        elif typ == 'foul' and s:
            s['fouls'] += 1
            if e.get('penalty'):
                s['pen_conceded'] += 1
                if S.get(e.get('on')):
                    S[e['on']]['pen_won'] += 1
        elif typ == 'card' and s:
            s['yellow' if e.get('card') == 'yellow' else 'red'] += 1
        elif typ == 'offside' and s:
            s['offsides'] += 1
        elif typ == 'miscontrol' and s:
            s['miscontrols'] += 1
            losses.append(e)
        elif typ == 'save' and s:
            s['saves'] += 1
        # keep only losses in the loser's own half
        if losses and losses[-1] is e and e.get('x') is not None:
            right = attacks_right(e.get('team'), e['t'])
            if (e['x'] > 52.5) == right:
                losses.pop()
    return S, score


def raw(s, pos, is_gk, is_def, frac, mine, theirs, clean):
    """The rating before shape(), clamping and the out-of-position penalty. clean: 0..1, how much of a clean sheet he has kept."""
    r = BASE + GOAL.get(pos, 1.0) * s['goals'] + 0.75 * s['assists']
    v = 0.5 * s['xg'] + 0.6 * s['xa'] + 0.12 * s['key'] + 0.08 * s['sot']
    v += 0.008 * s['done'] - 0.025 * (s['passes'] - s['done'])
    v += 0.12 * s['dribbles'] + 0.12 * s['tackles'] + 0.08 * s['inter'] + 0.06 * s['blocks'] + 0.03 * s['clear'] + 0.04 * s['aerials']
    v -= 0.10 * s['beaten'] + 0.04 * s['miscontrols'] + 0.05 * s['fouls'] + 0.03 * s['offsides']
    v += 0.3 * s['pen_won'] - 0.6 * s['pen_conceded'] - 0.5 * s['pen_missed']
    v -= 0.35 * s['err_shot'] + 0.65 * s['err_goal']   # an error leading to a goal: 1.0 in all
    if is_gk:
        v += 0.25 * s['saves'] + 0.5 * (s['xgot_faced'] - s['conceded']) - 0.15 * s['conceded'] + 0.4 * clean
    elif is_def:
        v += -0.12 * s['conceded'] + 0.3 * clean
    r += VOLUME * v - NORM.get(pos, NORM['MID']) * frac
    r -= 0.3 * s['yellow'] + 1.2 * s['red'] + 0.8 * s['own']
    r += 0.15 if mine > theirs else -0.15 if mine < theirs else 0.0
    return r


def match_end(data):
    return max([p.get('end_t') or 0.0 for p in data['periods']] + [e['t'] for e in data['events'][-1:]])


def ratings(data, t=None, end=None, penalty=True):
    """{player id: rating} at match second t (full time if None). end: the match's length in seconds when it isn't over yet (the engine's
    Boosted Captain check); penalty=False leaves out the out-of-position penalty."""
    S, score = tallies(data, t)
    end = end or match_end(data)
    at = end if t is None else min(t, end)
    frac = min(1.0, at / (end + 1e-9)) * (4 / 3 if len(data['periods']) > 2 else 1.0)   # 120 minutes after extra time (S-52)
    home = data['teams']['home']
    out = {}
    for p in data['players']:
        side = 0 if p['team'] == home['code'] else 1
        formation = (home if side == 0 else data['teams']['away'])['formation']
        want = slot_want(formation, p['slot'])
        is_gk = p['slot'] == 'GK'
        is_def = want == 'DEF'
        s = S[p['id']]
        clean = frac if s['conceded'] == 0 and (is_gk or is_def) else 0.0
        r = raw(s, p['position'], is_gk, is_def, frac, score[side], score[1 - side], clean)
        pen = 0.0 if not penalty else OUT_OF_POSITION.get(want, {}).get(p['position'], 0.0) if want and want != p['position'] else 0.0
        out[p['id']] = round(min(HIGH, max(LOW, shape(r) - pen)), 1)
    return out
