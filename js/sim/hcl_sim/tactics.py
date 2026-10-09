"""Formations, team shape and set-piece positioning.

All positions here are in a team's *attacking coordinates*: own goal at x=0, attacking
toward x=105, y=0 is the team's left touchline. The engine converts to pitch coordinates.
"""

import math

from .config import PITCH_LENGTH, PITCH_WIDTH, BOX_DEPTH, CENTRE_CIRCLE
from .geometry import clamp, dist, unit

# slot: (line, y_base, x_adjust, wanted player position)
FORMATIONS = {
    '4-3-3': {
        'GK': ('GK', 34, 0, 'GK'),
        'LB': ('DEF', 7, 0, 'DEF'), 'LCB': ('DEF', 25, -1, 'DEF'), 'RCB': ('DEF', 43, -1, 'DEF'), 'RB': ('DEF', 61, 0, 'DEF'),
        'LCM': ('MID', 21, 3, 'MID'), 'CDM': ('MID', 34, -5, 'MID'), 'RCM': ('MID', 47, 3, 'MID'),
        'LW': ('FWD', 8, -3, 'FWD'), 'ST': ('FWD', 34, 1, 'FWD'), 'RW': ('FWD', 60, -3, 'FWD'),
    },
    '4-4-2': {
        'GK': ('GK', 34, 0, 'GK'),
        'LB': ('DEF', 7, 0, 'DEF'), 'LCB': ('DEF', 25, -1, 'DEF'), 'RCB': ('DEF', 43, -1, 'DEF'), 'RB': ('DEF', 61, 0, 'DEF'),
        'LM': ('MID', 8, 1, 'MID'), 'LCM': ('MID', 26, -1, 'MID'), 'RCM': ('MID', 42, -1, 'MID'), 'RM': ('MID', 60, 1, 'MID'),
        'LST': ('FWD', 28, 0, 'FWD'), 'RST': ('FWD', 40, 0, 'FWD'),
    },
    '4-2-3-1': {
        'GK': ('GK', 34, 0, 'GK'),
        'LB': ('DEF', 7, 0, 'DEF'), 'LCB': ('DEF', 25, -1, 'DEF'), 'RCB': ('DEF', 43, -1, 'DEF'), 'RB': ('DEF', 61, 0, 'DEF'),
        'LDM': ('MID', 27, -3, 'MID'), 'RDM': ('MID', 41, -3, 'MID'),
        'LW': ('AM', 9, 0, 'FWD'), 'CAM': ('AM', 34, 0, 'MID'), 'RW': ('AM', 59, 0, 'FWD'),
        'ST': ('FWD', 34, 2, 'FWD'),
    },
    '3-5-2': {
        'GK': ('GK', 34, 0, 'GK'),
        'LCB': ('DEF', 20, 0, 'DEF'), 'CB': ('DEF', 34, -2, 'DEF'), 'RCB': ('DEF', 48, 0, 'DEF'),
        'LWB': ('MID', 6, -2, 'DEF'), 'LCM': ('MID', 24, 1, 'MID'), 'CDM': ('MID', 34, -4, 'MID'), 'RCM': ('MID', 44, 1, 'MID'), 'RWB': ('MID', 62, -2, 'DEF'),
        'LST': ('FWD', 28, 0, 'FWD'), 'RST': ('FWD', 40, 0, 'FWD'),
    },
}

WIDE_SLOTS = {'LB', 'RB', 'LWB', 'RWB'}


def _slot_score(p, slot):
    a = p.attrs
    if slot == 'GK':
        return a['reflexes'] + a['handling']
    if slot in WIDE_SLOTS:
        return a['pace'] + a['crossing'] * 0.5 + a['tackling']
    if slot.endswith('CB') or slot == 'CB':
        return a['heading'] + a['strength'] + a['marking'] + a['tackling']
    if slot in ('CDM', 'LDM', 'RDM'):
        return a['tackling'] + a['marking'] + a['passing']
    if slot in ('ST', 'LST', 'RST'):
        return a['finishing'] * 1.5 + a['heading'] * 0.5 + a['strength'] * 0.3
    if slot in ('LW', 'RW', 'LM', 'RM'):
        return a['pace'] + a['dribbling'] + a['crossing']
    return a['passing'] + a['vision'] + a['stamina'] * 0.5


def assign_lineup(players, formation, chosen=None):
    """Assign each player a formation slot. Returns list of (player, slot).

    `chosen` ({slot: player id}, optional) is the manager's pick: those players go in those
    slots, and any slot left empty (unknown slot, missing or repeated player) is filled
    automatically from the rest of the squad."""
    slots = FORMATIONS.get(formation) or FORMATIONS['4-3-3']
    remaining = list(players)
    assigned = []
    by_id = {str(p.id): p for p in players}
    for slot, pid in (chosen or {}).items():
        p = by_id.get(str(pid))
        if slot in slots and p in remaining and all(s != slot for _, s in assigned):
            remaining.remove(p)
            assigned.append((p, slot))
    slots = {s: v for s, v in slots.items() if all(s != a for _, a in assigned)}
    # Fill slots in order of specificity: GK, then centre-backs, full-backs, CDM, strikers, rest.
    order = sorted(slots, key=lambda s: ('GK', 'CB', 'LCB', 'RCB', 'CDM', 'LDM', 'RDM', 'ST', 'LST', 'RST').index(s)
                   if s in ('GK', 'CB', 'LCB', 'RCB', 'CDM', 'LDM', 'RDM', 'ST', 'LST', 'RST') else 20)
    for slot in order:
        want = slots[slot][3]
        pool = [p for p in remaining if p.position == want] or [p for p in remaining if p.position != 'GK'] or remaining
        if not pool:
            break
        best = max(pool, key=lambda p: (_slot_score(p, slot), p.id))
        remaining.remove(best)
        assigned.append((best, slot))
    return assigned


def offside_line(team, opponents):
    """x (in team's attacking coords) of the second-last opponent, or halfway if deeper."""
    xs = sorted((team.to_att(o.x, o.y)[0] for o in opponents if not o.sent_off), reverse=True)
    second_last = xs[1] if len(xs) > 1 else PITCH_LENGTH
    return max(second_last, PITCH_LENGTH / 2)


def shape_target(p, team, bx, by, in_possession, off_line):
    """Where this player wants to be in open play, given the ball at (bx, by) in attacking coords."""
    line, y_base, x_adj, _ = FORMATIONS.get(team.formation, FORMATIONS['4-3-3'])[p.slot]
    lh = team.tactic('line_height')
    width = team.tactic('width')

    if line == 'GK':
        return gk_target(bx, by, in_possession)

    if in_possession:
        d = clamp(bx - 31 + 10 * lh, 12, 58)
        lines = {'DEF': d, 'MID': d + 17, 'AM': d + 26, 'FWD': d + 33}
        wf, shift = 0.95 + 0.15 * width, 0.22
    else:
        # Defensive line: ~13 m from goal with the ball 25 m out, ~40 m with it at halfway.
        d = clamp(bx - 16 + 8 * lh, 9, 48)
        d = min(d, max(bx - 5, 6))
        lines = {'DEF': d, 'MID': d + 11, 'AM': d + 18, 'FWD': d + 24}
        wf, shift = 0.62, 0.42

    x = lines[line] + x_adj
    y = 34 + (y_base - 34) * wf + (by - 34) * shift

    if in_possession:
        if p.slot in WIDE_SLOTS and bx > 40:
            x += 6 + 8 * width
        if line in ('FWD', 'AM'):
            x = min(x, off_line)
    return clamp(x, 2.0, PITCH_LENGTH - 2.0), clamp(y, 1.5, PITCH_WIDTH - 1.5)


def gk_target(bx, by, in_possession):
    if in_possession:
        return clamp(4 + bx * 0.12, 4, 16), 34 + (by - 34) * 0.12
    # Come off the line to narrow the angle: further out as the ball approaches, up to ~5.5 m.
    ux, uy, d = unit(bx, by - 34)
    off = clamp(0.5 + d * 0.25, 1.0, 5.5) if d < 30 else clamp(5.5 - (d - 30) * 0.03, 3.5, 5.5)
    return clamp(ux * off, 0.5, BOX_DEPTH - 1), clamp(34 + uy * off, 29, 39)


# ---------- Set pieces ----------

def _keep_distance(x, y, sx, sy, d=CENTRE_CIRCLE + 0.5):
    ux, uy, cur = unit(x - sx, y - sy)
    if cur >= d:
        return x, y
    if cur < 1e-6:
        ux, uy = -1.0, 0.0
    return sx + ux * d, sy + uy * d


def setpiece_targets(kind, attacking, defending, spot, taker, off_line_att):
    """Targets {player: (x, y)} in pitch coords for every player, for a restart of `kind`
    taken by `attacking` at pitch spot (x, y)."""
    targets = {}
    sx_a, sy_a = attacking.to_att(*spot)

    def put(team, p, ax, ay):
        targets[p] = team.from_att(clamp(ax, 0.5, PITCH_LENGTH - 0.5), clamp(ay, 0.5, PITCH_WIDTH - 0.5))

    if kind == 'kickoff':
        for team, poss in ((attacking, True), (defending, False)):
            for p in team.active():
                ax, ay = shape_target(p, team, 52.5, 34, False, 52.5)
                ax = min(ax, 51.0)
                if not poss:
                    ax, ay = _keep_distance(ax, ay, 52.5, 34)
                    ax = min(ax, 51.0)
                put(team, p, ax, ay)
        support = min((p for p in attacking.active() if p is not taker and p.line in ('FWD', 'AM', 'MID')),
                      key=lambda p: dist(*attacking.to_att(p.x, p.y), 50, 34), default=None)
        if support:
            put(attacking, support, 50.5, 38)
        put(attacking, taker, 52.5, 34)
        return targets

    if kind == 'penalty':
        # Outside the box (it starts at x = 88.5) and outside the arc, 9.15 m round the spot (x = 94), so at least 10.5 m from it.
        spots = [(83.5, 22 + i * 3.2) for i in range(9)]
        i = 0
        for team in (attacking, defending):
            for p in team.active():
                if p is taker:
                    put(team, p, sx_a - 1.5, sy_a)
                elif team is defending and p.is_gk:
                    targets[p] = attacking.from_att(PITCH_LENGTH - 0.3, 34)
                else:
                    ax, ay = spots[i % len(spots)]
                    i += 1
                    put(attacking, p, ax - (i // len(spots)) * 3, ay)
        return targets

    if kind == 'corner':
        att_players = sorted((p for p in attacking.active() if p is not taker and not p.is_gk),
                             key=lambda p: -(p.attrs['heading'] + p.attrs['strength'] * 0.5))
        near = 30.0 if sy_a < 34 else 38.0
        far = 68 - near
        zones = [(99.5, near), (99.0, far), (94.5, 34), (100.5, 34.5), (88, 28), (88, 40), (92, near - 3)]
        for p, (zx, zy) in zip(att_players, zones):
            put(attacking, p, zx, zy)
        for p in att_players[len(zones):]:
            put(attacking, p, 60, 20 if p.y < 34 else 48)
        for p in attacking.active():
            if p.is_gk:
                put(attacking, p, 14, 34)
        put(attacking, taker, sx_a, sy_a)

        defs = sorted((p for p in defending.active() if not p.is_gk), key=lambda p: -(p.attrs['heading'] + p.attrs['marking']))
        zonal = [(100.5, 31), (100.5, 34), (100.5, 37)]
        markers = [p for p in att_players[:6]]
        for i, p in enumerate(defs):
            if i < 3:
                put(attacking, p, *zonal[i])
            elif i - 3 < len(markers):
                m = markers[i - 3]
                mx, my = targets[m]
                ax, ay = attacking.to_att(mx, my)
                put(attacking, p, ax + 1.2, ay + (0.6 if ay < 34 else -0.6))
            elif i == len(defs) - 1:
                put(attacking, p, 72, 34)
            else:
                put(attacking, p, 103.5, near + (-1.5 if near < 34 else 1.5))
        for p in defending.active():
            if p.is_gk:
                put(attacking, p, 104.3, 34 + (1.0 if near > 34 else -1.0))
        for p, (x, y) in list(targets.items()):
            if p.team == defending.code:
                ax, ay = attacking.to_att(x, y)
                ax, ay = _keep_distance(ax, ay, sx_a, sy_a)
                put(attacking, p, ax, ay)
        return targets

    if kind == 'goal_kick':
        for p in attacking.active():
            ax, ay = shape_target(p, attacking, 20, 34, True, off_line_att)
            if p.slot in ('LCB', 'CB'):
                ax, ay = 14, 18
            elif p.slot == 'RCB':
                ax, ay = 14, 50
            put(attacking, p, ax, ay)
        put(attacking, taker, sx_a, sy_a)
        for p in defending.active():
            bx_d, by_d = defending.to_att(*spot)
            ax, ay = shape_target(p, defending, bx_d, by_d, False, 52.5)
            # Opponents must stay outside the penalty area until the kick is taken.
            att_x, att_y = attacking.to_att(*defending.from_att(ax, ay))
            if att_x < BOX_DEPTH + 1.0 and 12 < att_y < 56:
                att_x = BOX_DEPTH + 1.5
            put(attacking, p, att_x, att_y)
        return targets

    # Free kicks and throw-ins: normal shape around the ball, opponents at 9.15 m for free kicks.
    direct = kind == 'free_kick' and dist(sx_a, sy_a, 105, 34) < 32
    for p in attacking.active():
        ax, ay = shape_target(p, attacking, sx_a, sy_a, True, off_line_att)
        if direct and p.line in ('DEF', 'MID', 'FWD', 'AM') and p.slot not in WIDE_SLOTS and not p.is_gk:
            ax = max(ax, min(off_line_att - 1, 92))
        put(attacking, p, ax, ay)
    for p in defending.active():
        bx_d, by_d = defending.to_att(*spot)
        ax, ay = shape_target(p, defending, bx_d, by_d, False, 52.5)
        att_x, att_y = attacking.to_att(*defending.from_att(ax, ay))
        if kind == 'free_kick':
            att_x, att_y = _keep_distance(att_x, att_y, sx_a, sy_a)
        put(attacking, p, att_x, att_y)
    if direct:
        # Build a wall on the line between ball and goal centre, 9.15 m from the ball.
        ux, uy, _ = unit(105 - sx_a, 34 - sy_a)
        n_wall = 4 if dist(sx_a, sy_a, 105, 34) < 24 else 3 if dist(sx_a, sy_a, 105, 34) < 28 else 2
        wall = sorted((p for p in defending.active() if not p.is_gk),
                      key=lambda p: dist(*attacking.to_att(p.x, p.y), sx_a, sy_a))[:n_wall]
        for i, p in enumerate(wall):
            off = (i - (n_wall - 1) / 2) * 0.7
            put(attacking, p, sx_a + ux * 9.4 - uy * off, sy_a + uy * 9.4 + ux * off)
    put(attacking, taker, sx_a, sy_a)
    return targets
