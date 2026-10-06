"""Checks a match file for physical and logical consistency.

These are the problems that make a match replay look fake, e.g. a pass from A to B,
then C suddenly has the ball on the other side of the pitch. Every match the simulator
writes should pass every check.
"""

import math

from .config import MAX_PLAYER_SPEED, MAX_BALL_SPEED, CONTROL_DISTANCE, PITCH_LENGTH, PITCH_WIDTH


def validate(match):
    problems = []
    fr = match['frames']
    scale = fr['scale']
    data = fr['data']
    n_players = len(match['players'])
    period_starts = {round(p['start_t'] * 10) for p in match['periods']}

    def add(kind, detail):
        problems.append((kind, detail))

    # 1. Player speed / teleport check, 2. ball speed, 3. held ball stays with holder
    worst_player = worst_ball = 0.0
    for i in range(1, len(data)):
        a, b = data[i - 1], data[i]
        dt = (b[0] - a[0]) / 10
        if dt <= 0:
            add('time', f'frame {i}: time does not advance')
            continue
        if b[0] in period_starts:
            continue    # half-time: teams reset for the second-half kick-off
        for k in range(n_players):
            ax, ay = a[6 + 2 * k] / scale, a[7 + 2 * k] / scale
            bx, by = b[6 + 2 * k] / scale, b[7 + 2 * k] / scale
            v = math.hypot(bx - ax, by - ay) / dt
            worst_player = max(worst_player, v)
            if v > MAX_PLAYER_SPEED + 0.5:
                add('player_speed', f't={b[0] / 10:.1f}s player idx {k} moved at {v:.1f} m/s')
        if a[5] and b[5]:
            v = math.hypot(b[1] - a[1], b[2] - a[2]) / scale / dt
            worst_ball = max(worst_ball, v)
            if v > MAX_BALL_SPEED + 1:
                add('ball_speed', f't={b[0] / 10:.1f}s ball moved at {v:.1f} m/s')
        h = b[4]
        if h >= 0:
            px, py = b[6 + 2 * h] / scale, b[7 + 2 * h] / scale
            d = math.hypot(px - b[1] / scale, py - b[2] / scale)
            if d > CONTROL_DISTANCE:
                add('holder_distance', f't={b[0] / 10:.1f}s holder idx {h} is {d:.1f} m from the ball')

    # 4. Every new holder must be explained by a control event at (about) that moment.
    idx_of = {p['id']: p['idx'] for p in match['players']}
    controls = {}
    for e in match['events']:
        if e['type'] == 'control':
            controls.setdefault(idx_of[e['player']], []).append(e['t'])
    prev = -1
    for row in data:
        h = row[4]
        if h >= 0 and h != prev:
            t = row[0] / 10
            ok = any(abs(ct - t) <= 0.25 + 1 / fr['fps'] for ct in controls.get(h, []))
            if not ok:
                add('unexplained_possession', f't={t:.1f}s player idx {h} has the ball with no control event')
        prev = h

    # 5. Positions stay near the pitch
    for row in data:
        for k in range(n_players):
            x, y = row[6 + 2 * k] / scale, row[7 + 2 * k] / scale
            if not (-5 <= x <= PITCH_LENGTH + 5 and -5 <= y <= PITCH_WIDTH + 5):
                add('off_pitch', f't={row[0] / 10:.1f}s player idx {k} at ({x:.1f}, {y:.1f})')
                break

    # 6. Score matches goal events; every pass has an outcome
    goals = [e for e in match['events'] if e['type'] == 'goal']
    home = match['teams']['home']['code']
    h_goals = sum(1 for g in goals if g['team'] == home)
    if (h_goals, len(goals) - h_goals) != (match['result']['home'], match['result']['away']):
        add('score', 'result does not match goal events')
    unresolved = [e['id'] for e in match['events'] if e['type'] == 'pass' and e.get('outcome') is None]
    if unresolved:
        add('pass_outcome', f'{len(unresolved)} passes without an outcome (first event id {unresolved[0]})')

    return {
        'ok': not problems,
        'problems': problems,
        'max_player_speed': round(worst_player, 2),
        'max_ball_speed': round(worst_ball, 2),
        'frames': len(data),
        'events': len(match['events']),
    }


def summarise(report, limit=12):
    lines = [f"{'PASS' if report['ok'] else 'FAIL'}  frames={report['frames']}  events={report['events']}  "
             f"max player speed={report['max_player_speed']} m/s  max ball speed={report['max_ball_speed']} m/s"]
    kinds = {}
    for k, d in report['problems']:
        kinds.setdefault(k, []).append(d)
    for k, ds in kinds.items():
        lines.append(f'  {k}: {len(ds)}')
        for d in ds[:limit]:
            lines.append(f'    - {d}')
    return '\n'.join(lines)
