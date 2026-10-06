"""On-ball decision making.

The player on the ball scores every option: a pass to each teammate (on the ground or in
the air), dribbling in several directions, shooting, crossing, clearing, or holding. Each
score is  P(success) x value(if it works)  -  P(failure) x danger(if it fails), where value
and danger come from a threat model of the pitch. Pass success accounts for whether any
defender can reach the ball's path before the ball does.

Options are then picked with a softmax: good decision-makers usually pick the best option,
poor ones (or anyone under heavy pressure with low composure) make more mistakes.
"""

import math

from . import physics
from .config import PITCH_LENGTH, PITCH_WIDTH, GOAL_Y1, GOAL_Y2, BOX_DEPTH, TUNING
from .geometry import clamp, dist, unit, sigmoid, rotate, seg_point_dist


# ---------- Pitch value models (attacking coordinates) ----------

def threat(ax, ay):
    """Rough chance that possession at this spot leads to a goal soon (0.01 .. ~0.3)."""
    d = math.hypot(PITCH_LENGTH - ax, ay - 34)
    progress = clamp(ax / PITCH_LENGTH, 0.0, 1.0)
    return 0.008 + 0.075 * progress ** 2.6 + 0.28 * math.exp(-d / 8.5) * _angle_factor(ax, ay)


def _angle_factor(ax, ay):
    return clamp(goal_angle(ax, ay) / 1.2, 0.15, 1.0)


def goal_angle(ax, ay):
    """Angle (radians) of the goal mouth as seen from (ax, ay)."""
    dx = PITCH_LENGTH - ax
    y1, y2 = GOAL_Y1 - ay, GOAL_Y2 - ay
    if dx <= 0.05:
        return math.pi if y1 < 0 < y2 else 0.0
    a = math.atan2(y2, dx) - math.atan2(y1, dx)
    return abs(a)


def expected_goals(ax, ay, header=False, pressure=0.0, blockers=0, penalty=False):
    if penalty:
        return 0.76
    d = math.hypot(PITCH_LENGTH - ax, ay - 34)
    logit = -0.35 - 0.11 * d + 1.4 * goal_angle(ax, ay) - 0.55 * pressure - 0.45 * blockers
    if header:
        logit -= 0.9
    return sigmoid(logit)


# ---------- Helpers ----------

def _reach_time(ox, oy, vmax, px, py, react=0.3, vx=0.0, vy=0.0):
    """Seconds for a player to reach a point: reaction + acceleration + running time.
    A player already moving that way skips most of the reaction and acceleration."""
    d = math.hypot(px - ox, py - oy)
    if d < 1e-6:
        return 0.0
    v_toward = ((px - ox) * vx + (py - oy) * vy) / d
    momentum = clamp(v_toward / vmax, 0.0, 1.0)
    return (react + 0.25) * (1.0 - 0.8 * momentum) + d / vmax


def pressure_on(ax, ay, opps):
    return sum(max(0.0, 1.0 - math.hypot(ox - ax, oy - ay) / 4.5) for ox, oy, _, _ in opps)


def _nearest(ax, ay, opps):
    return min((math.hypot(ox - ax, oy - ay) for ox, oy, _, _ in opps), default=50.0)


def blockers_in_cone(ax, ay, opps):
    n = 0
    for ox, oy, _, p in opps:
        if p.is_gk or ox <= ax:
            continue
        # Inside the triangle ball -> posts?
        t = (ox - ax) / max(PITCH_LENGTH - ax, 0.1)
        if t > 1:
            continue
        lo = ay + (GOAL_Y1 - ay) * t - 0.4
        hi = ay + (GOAL_Y2 - ay) * t + 0.4
        if lo <= oy <= hi:
            n += 1
    return n


class Ctx:
    """Everything a decision needs, precomputed once in the carrier's attacking coords."""

    def __init__(self, m, p):
        self.m = m
        self.p = p
        self.team = m.team_of(p)
        self.opp_team = m.other(self.team)
        T = self.team
        self.ax, self.ay = T.to_att(p.x, p.y)
        self.opps = [(*T.to_att(o.x, o.y), o.vmax(), o) for o in self.opp_team.active()]
        self.mates = [q for q in T.active() if q is not p]
        self.pressure = pressure_on(self.ax, self.ay, self.opps)
        self.restart = m.restart_kind
        self.in_hands = m.ball.in_hands
        self.off_line = m.offside_x(T)

    def to_pitch(self, ax, ay):
        return self.team.from_att(ax, ay)


# ---------- Option evaluation ----------

def _pass_option(c, r, loft_angle=0.0, subtype=None, z0=0.0, max_speed=None):
    p = c.p
    T = c.team
    rx, ry = T.to_att(r.x, r.y)
    rvx, rvy = (r.vx, r.vy) if T.direction == 1 else (-r.vx, -r.vy)

    d0 = math.hypot(rx - c.ax, ry - c.ay)
    if d0 < 3.0:
        return None
    est_t = 0.25 + d0 / (13.0 if not loft_angle else 16.0)
    lead = 0.75
    tx, ty = rx + rvx * est_t * lead, ry + rvy * est_t * lead
    subtype = subtype or ('long' if loft_angle else 'short')
    if r.run_until > c.m.t and subtype in ('short', 'long'):
        # Through ball: play it into the runner's path, along the ground or over the top.
        ux, uy, sp = unit(rvx, rvy)
        if sp > 3:
            tx, ty = rx + ux * sp * est_t * 1.0, ry + uy * sp * est_t * 1.0
            subtype = 'through'
    tx, ty = clamp(tx, 1.0, PITCH_LENGTH - 1.0), clamp(ty, 1.0, PITCH_WIDTH - 1.0)
    d = math.hypot(tx - c.ax, ty - c.ay)
    if d < 3.0:
        return None

    passing = p.a('passing') if not p.is_gk else max(p.a('kicking'), p.a('passing'))
    power = max_speed or (19.0 + 13.0 * passing)
    windup = 0.2 if d < 25 else 0.3

    sgn = 1 if T.direction == 1 else -1
    if not loft_angle:
        arrival = clamp(4.0 + 0.12 * d, 4.5, 10.0) + (3.0 if subtype == 'through' else 0.0)
        v0 = physics.ground_speed_for(d, arrival, max_speed=power)
        if v0 is None:
            return None
        # When could each opponent get to points along the path, compared with the ball
        # and with the receiver? Only the stretch before the receiver can meet the ball counts.
        p_clear = 1.0
        worst = None
        samples = [s for s in _frange(2.0, d, 2.5)] + [d]
        times = [windup + physics.ground_time_to(v0, s) for s in samples]
        ux, uy, _ = unit(tx - c.ax, ty - c.ay)
        pts = [(c.ax + ux * s, c.ay + uy * s) for s in samples]
        t_recv = [_reach_time(rx, ry, r.vmax(), px, py, react=0.15, vx=rvx, vy=rvy) - 0.9 / r.vmax() for px, py in pts]
        meet = next((i for i, (tr, tb) in enumerate(zip(t_recv, times)) if tr <= tb + 0.1), len(samples) - 1)
        for ox, oy, ovmax, o in c.opps:
            # A defender right next to the passer, in the way of the pass, can block it.
            odx, ody, od = unit(ox - c.ax, oy - c.ay)
            if od < 1.8 and odx * ux + ody * uy > 0.85:
                p_clear *= 0.65
            # Skip opponents far from the lane.
            lane_d, _ = seg_point_dist(c.ax, c.ay, tx, ty, ox, oy)
            if lane_d > 14:
                continue
            ovx, ovy = o.vx * sgn, o.vy * sgn
            best_margin = 99.0
            for i in range(meet + 1):
                px, py = pts[i]
                reach = 0.9 if not o.is_gk else 1.4
                to = _reach_time(ox, oy, ovmax, px, py, vx=ovx, vy=ovy) - reach / ovmax
                # Beat both the ball's arrival and the receiver to this point.
                best_margin = min(best_margin, to - max(times[i], min(t_recv[i], times[i] + 0.4)))
            pi = sigmoid((-best_margin - 0.05) / 0.15)
            if pi > 0.01:
                p_clear *= (1.0 - pi)
                if worst is None or pi > worst[0]:
                    worst = (pi, ox, oy)
        flight = times[-1]
        lat_err = d * math.radians(TUNING['pass_error_base'] + TUNING['pass_error_skill'] * (1 - passing)
                                   + TUNING['pass_error_pressure'] * min(c.pressure, 1.0))
    else:
        v0 = physics.loft_speed_for(d, loft_angle, z0=z0, max_speed=power)
        if v0 is None:
            return None
        path = physics.loft_path(v0, loft_angle, z0)
        flight = windup + path[-1][0]
        # Contest at the landing spot: can an opponent get there first (or as well)?
        t_r = _reach_time(rx, ry, r.vmax(), tx, ty, react=0.15, vx=rvx, vy=rvy)
        t_o = min((_reach_time(ox, oy, ov, tx, ty, vx=o.vx * sgn, vy=o.vy * sgn) for ox, oy, ov, o in c.opps), default=99)
        p_clear = sigmoid((min(t_o, flight + 0.6) - max(t_r, flight - 0.3)) / 0.35) * 0.75
        worst = (1 - p_clear, tx, ty)
        lat_err = d * (TUNING['loft_error'] * (1.4 - passing))

    # How far the receiver can adjust to a misplaced ball; a runner onto a ball in space adjusts more.
    reach = 1.1 + (0.7 if subtype == 'through' else 0.35) * min(flight, 3.0)
    p_exec = 1.0 - math.exp(-(reach * reach) / (2 * max(lat_err, 0.05) ** 2))
    press_target = pressure_on(tx, ty, c.opps)
    p_recv = clamp(0.985 - 0.22 * (1 - r.a('first_touch')) - 0.12 * min(press_target, 1.2) - (0.1 if loft_angle else 0.0), 0.3, 0.99)
    ps = p_exec * p_clear * p_recv

    # Will the receiver be offside when the ball is actually struck? Most passers see it and
    # hold the pass (or release it earlier); poor vision misses it.
    rx_kick = rx + max(rvx, 0.0) * (windup + 0.15)
    if subtype not in ('throw', 'goal_kick', 'corner') and rx_kick > c.off_line + 0.1 and rx_kick > c.ax and rx_kick > PITCH_LENGTH / 2:
        ps *= 0.05 + 0.5 * (1 - p.a('vision'))

    # A tightly marked receiver (usually the striker between two centre-backs) is worth less
    # than the pitch position alone suggests: he'll have little time to do anything with it.
    value = threat(tx, ty) * (1.0 - 0.45 * min(press_target, 1.2)) + 0.012 * min(_nearest(tx, ty, c.opps), 8) / 8
    if tx > 80 and not loft_angle:
        # A pass into a shooting position (cut-back, lay-off, square ball) is worth the chance
        # the receiver scores with it, which spreads shots across the team.
        xg_there = expected_goals(tx, ty, pressure=min(press_target, 1.5), blockers=blockers_in_cone(tx, ty, c.opps))
        value = max(value, 0.8 * xg_there * TUNING['shot_appetite'] * 1.15)
    directness = c.team.tactic('directness')
    if tx > c.ax + 10:
        value *= 1.0 + 0.25 * directness
    loss_x, loss_y = (worst[1], worst[2]) if worst else (tx, ty)
    danger = threat(PITCH_LENGTH - loss_x, PITCH_WIDTH - loss_y)
    utility = ps * value - (1 - ps) * danger * TUNING['risk_aversion']
    if r.is_gk:
        utility -= 0.004

    return {
        'kind': 'pass', 'subtype': subtype, 'receiver': r, 'target': c.to_pitch(tx, ty),
        'speed': v0, 'loft': loft_angle, 'z0': z0, 'p': ps, 'utility': utility, 'windup': windup,
        'parts': (round(p_exec, 2), round(p_clear, 2), round(p_recv, 2)),
    }


def _frange(a, b, step):
    x = a
    while x < b:
        yield x
        x += step


def _shot_option(c, penalty=False, header=False):
    ax, ay = c.ax, c.ay
    d = math.hypot(PITCH_LENGTH - ax, ay - 34)
    if d > 36 and not penalty:
        return None
    blockers = blockers_in_cone(ax, ay, c.opps)
    xg = expected_goals(ax, ay, header=header, pressure=min(c.pressure, 1.5), blockers=blockers, penalty=penalty)
    long_shots = c.p.a('long_shots')
    if d > 20 and xg < 0.03 and not penalty:
        return None     # speculative efforts from distance are rare
    # Players with a good long shot back themselves from distance when they have a sight of goal.
    appetite = TUNING['shot_appetite'] * (0.7 + 0.7 * long_shots if d > 18 else 1.0)
    utility = xg * appetite * 1.15 - (1 - xg) * 0.004
    return {'kind': 'shoot', 'xg': xg, 'utility': utility, 'windup': 0.3 if not penalty else 1.0,
            'target': c.to_pitch(PITCH_LENGTH, 34), 'receiver': None, 'p': xg, 'subtype': 'penalty' if penalty else 'open'}


def _dribble_options(c):
    out = []
    gx, gy, _ = unit(PITCH_LENGTH - c.ax, 34 - c.ay)
    dribbling = c.p.a('dribbling')
    step = 5.0
    for ang in (0, 35, -35, 75, -75):
        ux, uy = rotate(gx, gy, math.radians(ang))
        ex, ey = c.ax + ux * step, c.ay + uy * step
        if not (1.5 < ex < PITCH_LENGTH - 1.5 and 1.5 < ey < PITCH_WIDTH - 1.5):
            continue
        t_drib = step / (c.p.vmax() * 0.75)
        space = min((math.hypot(ox - ex, oy - ey) - ov * t_drib * 0.7 for ox, oy, ov, _ in c.opps), default=20)
        p_keep = sigmoid((space + 1.2) / 1.1 + (dribbling - 0.5) * 2.2 - c.pressure * 0.7)
        value = threat(ex, ey)
        danger = threat(PITCH_LENGTH - c.ax, PITCH_WIDTH - c.ay)
        utility = p_keep * value - (1 - p_keep) * danger * TUNING['risk_aversion']
        utility -= 0.0015 * c.team.tactic('tempo')
        out.append({'kind': 'dribble', 'target': c.to_pitch(ex, ey), 'utility': utility, 'p': p_keep,
                    'receiver': None, 'windup': 0.0})
    return out


def _cross_options(c):
    if c.ax < 66 or 18 < c.ay < 50:
        return []
    near = 30.5 if c.ay < 34 else 37.5
    far = PITCH_WIDTH - near
    out = []
    crossing = c.p.a('crossing')
    for zx, zy in ((98.5, near), (93.0, 34.0), (99.0, far)):
        d = math.hypot(zx - c.ax, zy - c.ay)
        flight = 0.3 + d / 17.0
        att = sum(1 for q in c.mates if _reach_time(*c.team.to_att(q.x, q.y), q.vmax(), zx, zy, 0.2) < flight + 0.4)
        dfn = sum(1 for ox, oy, ov, o in c.opps if _reach_time(ox, oy, ov, zx, zy, 0.2) < flight + 0.2)
        gk_claim = 1.2 if zx > 99 - 1 and abs(zy - 34) < 5 else 0.0
        if att == 0:
            continue
        p_win = att / (att + dfn * 0.9 + gk_claim + 0.3)
        p_exec = 0.45 + 0.45 * crossing
        xg_h = expected_goals(zx, zy, header=True)
        # A cross that isn't won still often leads to a second ball, a corner or a throw.
        value = p_exec * p_win * (xg_h * 1.3 + 0.03) + 0.012
        danger = threat(PITCH_LENGTH - zx, PITCH_WIDTH - zy)
        utility = value - (1 - p_exec * p_win) * danger * 0.35
        angle = 22 if d < 28 else 26
        speed = physics.loft_speed_for(d, angle)
        if speed is None:
            continue
        out.append({'kind': 'cross', 'subtype': 'cross', 'target': c.to_pitch(zx, zy), 'speed': speed, 'loft': angle,
                    'z0': 0.0, 'utility': utility, 'p': p_exec * p_win, 'receiver': None, 'windup': 0.3})
    return out


def _clear_option(c):
    if c.ax > 35:
        return None
    tx = clamp(c.ax + 45, 40, 80)
    ty = 6.0 if c.ay < 34 else PITCH_WIDTH - 6.0
    r = c.m.rng.random()
    if c.pressure > 0.9 and r < 0.15:
        # Under real pressure: just put it out of play.
        tx = clamp(c.ax + 25, 20, 60)
        ty = -4.0 if c.ay < 34 else PITCH_WIDTH + 4.0
    elif c.pressure > 0.8 and c.ax < 12 and r < 0.6:
        # Pinned near his own goal line: shin it behind for a corner.
        tx, ty = -4.0, c.ay + (-8 if c.ay < 34 else 8)
    d = math.hypot(tx - c.ax, ty - c.ay)
    speed = physics.loft_speed_for(d, 38)
    if speed is None:
        return None
    danger_here = threat(PITCH_LENGTH - c.ax, PITCH_WIDTH - c.ay)
    utility = 0.3 * threat(tx, ty) - 0.55 * threat(PITCH_LENGTH - tx, PITCH_WIDTH - ty) - 0.3 * danger_here * (1 - min(c.pressure, 1)) - 0.004
    return {'kind': 'clear', 'subtype': 'clearance', 'target': c.to_pitch(tx, ty), 'speed': speed, 'loft': 38, 'z0': 0.0,
            'utility': utility, 'p': 0.5, 'receiver': None, 'windup': 0.2}


def options_for(m, p):
    c = Ctx(m, p)
    opts = []
    kind = c.restart

    if kind == 'penalty':
        return c, [_shot_option(c, penalty=True)]

    if kind == 'throw_in':
        for r in c.mates:
            if not r.is_gk:
                o = _pass_option(c, r, loft_angle=18, subtype='throw', z0=2.0, max_speed=15.0)
                if o and dist(p.x, p.y, *o['target']) < 28:
                    o['windup'] = 0.6
                    opts.append(o)
        return c, opts

    if c.in_hands:
        for r in c.mates:
            o = _pass_option(c, r, loft_angle=14, subtype='gk_throw', z0=1.8, max_speed=20.0)
            if o:
                opts.append(o)
            o = _pass_option(c, r, loft_angle=34, subtype='gk_kick')
            if o and dist(p.x, p.y, *o['target']) > 30:
                opts.append(o)
        return c, opts

    for r in c.mates:
        o = _pass_option(c, r)
        if o:
            opts.append(o)
        d = dist(p.x, p.y, r.x, r.y)
        if r.run_until > m.t and d > 12:
            # Over the top for a runner.
            o3 = _pass_option(c, r, loft_angle=22)
            if o3:
                opts.append(o3)
        elif d > 22 or (o and o['p'] < 0.5):
            o2 = _pass_option(c, r, loft_angle=28 if d < 40 else 34)
            if o2:
                opts.append(o2)

    if kind == 'kickoff':
        return c, [o for o in opts if o['loft'] == 0 and dist(*c.team.to_att(*o['target']), 52.5, 34) < 25]

    if kind in (None, 'free_kick', 'corner'):
        opts += _cross_options(c)
    if kind in (None, 'free_kick'):
        s = _shot_option(c)
        if s and (kind is None or s['xg'] > 0.035):
            if kind == 'free_kick':
                s['subtype'] = 'free_kick'
            opts.append(s)
    if kind is None:
        opts += _dribble_options(c)
        cl = _clear_option(c)
        if cl:
            opts.append(cl)
        opts.append({'kind': 'hold', 'utility': threat(c.ax, c.ay) * 0.96 - 0.006 * c.pressure - 0.002 * c.team.tactic('tempo'),
                     'receiver': None, 'target': (p.x, p.y), 'p': 1.0, 'windup': 0.0})
    return c, [o for o in opts if o]


def _fallback_pass(c):
    """Restarts and keeper distribution must release the ball: simple pass to the nearest teammate."""
    mates = [r for r in c.mates if not r.is_gk] or c.mates
    if not mates:
        return None
    r = min(mates, key=lambda r: dist(c.p.x, c.p.y, r.x, r.y))
    d = max(3.0, dist(c.p.x, c.p.y, r.x, r.y))
    thrown = c.restart == 'throw_in' or c.in_hands
    angle = 18 if thrown else 0
    z0 = 2.0 if thrown else 0.0
    speed = (physics.loft_speed_for(d, angle, z0=z0) if angle else physics.ground_speed_for(d, 6.0)) or 18.0
    return {'kind': 'pass', 'subtype': 'throw' if c.restart == 'throw_in' else 'short', 'receiver': r,
            'target': (r.x, r.y), 'speed': speed, 'loft': angle, 'z0': z0, 'p': 0.5, 'utility': 0.0, 'windup': 0.5}


def choose(m, p, rng):
    c, opts = options_for(m, p)
    if not opts and (c.restart or c.in_hands):
        fb = _fallback_pass(c)
        opts = [fb] if fb else []
    if not opts:
        return c, None
    dec = p.a('decisions')
    comp = p.a('composure')
    tau = TUNING['decision_temperature_poor'] + (TUNING['decision_temperature'] - TUNING['decision_temperature_poor']) * dec
    tau *= 1.0 + min(c.pressure, 1.5) * (1.0 - comp)
    best = max(o['utility'] for o in opts)
    weights = [math.exp((o['utility'] - best) / tau) for o in opts]
    r = rng.random() * sum(weights)
    for o, w in zip(opts, weights):
        r -= w
        if r <= 0:
            return c, o
    return c, opts[-1]
