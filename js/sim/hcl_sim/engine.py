"""The match engine: one physical world advanced in 0.1 s ticks.

Continuity rules the engine never breaks (and `validate.py` checks):
* Players move with limited speed and acceleration. Nobody teleports during play.
* The ball is either held (at the holder's feet), free (moving under physics), or dead
  (out of play). It only becomes held when a player physically reaches it.
* Every change of holder produces a `control` event saying how it happened.
"""

import math
import random

from . import physics, tactics, decisions
from .config import (PITCH_LENGTH, PITCH_WIDTH, GOAL_Y1, GOAL_Y2, GOAL_HEIGHT, BOX_DEPTH, BOX_Y1, BOX_Y2,
                     TICK, HALF_SECONDS, DEFAULT_FPS, MAX_PLAYER_SPEED, TUNING, PENALTY_SPOT, SIX_DEPTH)
from .geometry import clamp, dist, unit, seg_point_dist, sigmoid, rotate
from .models import Ball

KICK_TYPES = ('pass', 'shoot', 'cross', 'clear')
OFFSIDE_EXEMPT = ('throw', 'goal_kick', 'corner')
SPEEDS = (1.3, 2.5, 5.0)  # walk, jog, run; sprint = vmax


class Match:
    def __init__(self, home, away, seed=1, fps=DEFAULT_FPS, info=None):
        self.home, self.away = home, away
        home.side, away.side = 0, 1
        self.players = home.players + away.players
        for i, p in enumerate(self.players):
            p.idx = i
            p.side = 0 if p in home.players else 1
            p.setup_physical()
        self.rng = random.Random(seed)
        self.seed = seed
        self.fps = fps
        self.info = info or {}

        self.ball = Ball()
        self.tick = 0
        self.t = 0.0
        self.period = 0
        self.period_start = 0.0
        self.added = None
        self.phase = 'dead'
        self.restart = None
        self.restart_kind = None
        self.restart_targets = {}
        self.possession = None
        self.poss_id = 0
        self.score = [0, 0]
        self.events = []
        self.frames = []
        self.periods = []
        self.next_frame = 0.0
        self.pending_pass = None
        self.pending_shot = None
        self.offside_flags = set()
        self.last_pass_to = {}          # player id -> (passer, poss_id) of the last completed pass they received
        self.next_chaser_update = 0.0
        self.stoppages = 0.0            # seconds of stoppage accumulated this half
        self.poss_time = [0.0, 0.0]
        self.in_play_time = 0.0
        self.gk_dive = {}               # gk idx -> dive plan

    # ---------- helpers ----------

    def team_of(self, p):
        return self.home if p.side == 0 else self.away

    def other(self, team):
        return self.away if team is self.home else self.home

    def offside_x(self, team):
        return tactics.offside_line(team, self.other(team).players)

    def clock(self):
        el = self.t - self.period_start
        base = 0 if self.period == 1 else HALF_SECONDS
        if el <= HALF_SECONDS:
            secs = base + el
            minute = str(int(secs // 60) + 1)
        else:
            secs = base + el
            minute = f'{(45 if self.period == 1 else 90)}+{int((el - HALF_SECONDS) // 60) + 1}'
        return f'{int(secs // 60):02d}:{int(secs % 60):02d}', minute

    def ev(self, kind, p=None, team=None, x=None, y=None, **fields):
        clock, minute = self.clock()
        e = {'id': len(self.events), 't': round(self.t, 2), 'period': self.period, 'clock': clock,
             'minute': minute, 'type': kind}
        if p is not None:
            e['team'] = p.team
            e['player'] = p.id
        elif team is not None:
            e['team'] = team.code
        e['x'] = round(p.x if x is None and p is not None else (x if x is not None else self.ball.x), 1)
        e['y'] = round(p.y if y is None and p is not None else (y if y is not None else self.ball.y), 1)
        e['poss'] = self.poss_id
        e.update(fields)
        self.events.append(e)
        return e

    def in_own_box(self, p, x=None, y=None):
        ax, ay = self.team_of(p).to_att(p.x if x is None else x, p.y if y is None else y)
        return ax <= BOX_DEPTH and BOX_Y1 <= ay <= BOX_Y2

    # ---------- main loop ----------

    def run(self, on_progress=None):
        """Play the match. `on_progress(fraction)` is called now and then with 0..1."""
        first_home_dir = self.rng.choice((1, -1))
        first_kick = self.rng.choice((self.home, self.away))
        for period in (1, 2):
            self.home.direction = first_home_dir if period == 1 else -first_home_dir
            self.away.direction = -self.home.direction
            kicker = first_kick if period == 1 else self.other(first_kick)
            self._start_period(period, kicker)
            while not self._period_over():
                self._tick()
                if on_progress and self.tick % 500 == 0:
                    el = self.t - self.period_start
                    on_progress(min(0.99, (period - 1) * 0.5 + 0.5 * el / (HALF_SECONDS + 180)))
            self._resolve_pass('end_of_period')
            self._record_frame(force=True)
            self.ev('period_end', team=None, x=self.ball.x, y=self.ball.y)
            self.periods[-1]['end_t'] = round(self.t, 2)
            self.periods[-1]['added_minutes'] = self.added
        return self

    def _start_period(self, period, kicker):
        self.period = period
        self.period_start = self.t
        self.added = None
        self.stoppages = 0.0
        self.periods.append({'period': period, 'start_t': round(self.t, 2),
                             'home_attacks': 'right' if self.home.direction == 1 else 'left'})
        for p in self.players:
            if period == 2:
                p.energy = min(1.0, p.energy + 0.3 * (1 - p.energy))
            p.vx = p.vy = 0.0
            p.action = None
            p.run_until = 0
        taker = self._kickoff_taker(kicker)
        targets = tactics.setpiece_targets('kickoff', kicker, self.other(kicker), (52.5, 34), taker, 52.5)
        for p, (x, y) in targets.items():
            p.x, p.y = x, y
            p.fx = 1.0 if self.team_of(p).direction == 1 else -1.0
            p.fy = 0.0
        for p in self.players:
            if p.sent_off:
                p.x, p.y = 30 + p.idx * 2, -3
        self.ev('period_start', team=kicker, x=52.5, y=34)
        self._start_restart('kickoff', kicker, (52.5, 34), (1.0, 3.0), taker=taker)
        self._record_frame(force=True)

    def _kickoff_taker(self, team):
        fw = [p for p in team.active() if p.line == 'FWD'] or [p for p in team.active() if not p.is_gk]
        return max(fw, key=lambda p: (p.slot in ('ST', 'LST', 'CAM'), p.attrs['passing']))

    def _period_over(self):
        el = self.t - self.period_start
        if el < HALF_SECONDS:
            return False
        if self.added is None:
            base = 1 if self.period == 1 else 2
            self.added = int(clamp(base + self.stoppages / 60 + self.rng.uniform(0, 1.5), base, 5 if self.period == 1 else 8))
            self.ev('added_time', team=None, minutes=self.added)
        limit = HALF_SECONDS + self.added * 60
        if el < limit:
            return False
        if self.phase == 'dead' and self.restart and self.restart['kind'] != 'penalty':
            return True
        if self.phase == 'play' and 35 < self.ball.x < 70:
            return True
        return el > limit + 25

    def _tick(self):
        self.tick += 1
        self.t = self.tick * TICK
        b = self.ball
        if self.phase == 'dead':
            self._dead_update()
        else:
            if b.holder is not None:
                self._carrier_update(b.holder)
            if b.holder is not None and not b.in_hands and self.phase == 'play':
                self._duel_update(b.holder)
            if b.holder is None and self.phase == 'play':
                prev = (b.x, b.y, b.z)
                physics.step(b)
                self._free_ball_contacts(prev)
                if b.holder is None and self.phase == 'play':
                    self._check_boundaries(prev)
            if self.phase == 'play':
                self.in_play_time += TICK
                if self.possession is not None:
                    self.poss_time[self.possession.side] += TICK
        self._update_targets()
        self._move_players()
        if b.holder is not None:
            self._attach_ball(b.holder)
        self._record_frame()

    # ---------- on-ball ----------

    def _attach_ball(self, p):
        b = self.ball
        if b.in_hands:
            b.x, b.y, b.z = p.x + p.fx * 0.3, p.y + p.fy * 0.3, 1.2 if p.is_gk else 2.0
        else:
            b.x, b.y, b.z = p.x + p.fx * 0.45, p.y + p.fy * 0.45, 0.0
        b.vx, b.vy, b.vz = p.vx, p.vy, 0.0

    def _carrier_update(self, p):
        t = self.t
        act = p.action
        if act and act['kind'] in KICK_TYPES:
            if t >= p.kick_at:
                p.action = None
                self._kick(p, act)
            return
        if act and act['kind'] == 'dribble':
            near = min((dist(p.x, p.y, o.x, o.y) for o in self.other(self.team_of(p)).active()), default=99)
            if dist(p.x, p.y, *act['target']) < 0.8 or t >= p.decide_at or (near < 1.4 and t - act['at'] > 0.35):
                p.action = None
                p.decide_at = t
            return
        if t < p.decide_at:
            return
        ctx, opt = decisions.choose(self, p, self.rng)
        if opt is None:
            p.decide_at = t + 0.4
            return
        opt['at'] = t
        if opt['kind'] == 'dribble':
            p.action = opt
            p.decide_at = t + self.rng.uniform(0.6, 1.1)
        elif opt['kind'] == 'hold':
            p.action = None
            p.decide_at = t + self.rng.uniform(0.3, 0.6)
        else:
            p.action = opt
            p.kick_at = t + opt['windup']

    def _kick(self, p, opt, header=False, z0=None):
        b = self.ball
        T = self.team_of(p)
        rng = self.rng
        kind = opt['kind']
        ctx_pressure = decisions.pressure_on(*T.to_att(p.x, p.y), [(*T.to_att(o.x, o.y), 0, o) for o in self.other(T).active()])
        z_start = opt.get('z0', 0.0) if z0 is None else z0
        b.x, b.y = (b.x, b.y) if b.holder is p or header else (p.x, p.y)
        restart = self.restart_kind
        subtype = opt.get('subtype') or kind
        if restart in ('corner', 'goal_kick', 'free_kick', 'kickoff') and kind != 'shoot':
            subtype = restart
        e = None

        if kind == 'shoot':
            e = self._shoot(p, opt, header=header, z0=z_start, pressure=min(ctx_pressure, 1.5))
        else:
            tx, ty = opt['target']
            dx, dy = tx - b.x, ty - b.y
            d = math.hypot(dx, dy)
            skill = p.a('crossing') if kind == 'cross' else (max(p.a('kicking'), p.a('passing')) if p.is_gk else p.a('passing'))
            if header:
                skill = p.a('heading') * 0.8
            if opt.get('loft'):
                angle = opt['loft']
                err = TUNING['loft_error'] * (1.4 - skill) * d * (1.6 if header else 1.0) * (1 + 0.5 * min(ctx_pressure, 1))
                tx2, ty2 = tx + rng.gauss(0, err), ty + rng.gauss(0, err * 0.8)
                d2 = max(3.0, math.hypot(tx2 - b.x, ty2 - b.y))
                speed = physics.loft_speed_for(d2, angle, z0=z_start) or opt['speed']
                vx, vy, vz = physics.launch_velocity(tx2 - b.x, ty2 - b.y, speed, angle)
            else:
                sigma = (TUNING['pass_error_base'] + TUNING['pass_error_skill'] * (1 - skill)
                         + TUNING['pass_error_pressure'] * min(ctx_pressure, 1.0)) * (1.8 if header else 1.0)
                ang = math.radians(rng.gauss(0, sigma))
                ux, uy = rotate(dx / (d or 1), dy / (d or 1), ang)
                speed = opt['speed'] * (1 + rng.gauss(0, TUNING['pass_power_error'] * (1.5 - skill)))
                vx, vy, vz = ux * speed, uy * speed, 0.0
                if header:
                    vz = speed * 0.25
            b.vx, b.vy, b.vz = vx, vy, vz
            b.z = z_start
            etype = 'clearance' if kind == 'clear' else 'pass'
            e = self.ev(etype, p, subtype=subtype, end_x=round(tx, 1), end_y=round(ty, 1),
                        receiver_intended=opt['receiver'].id if opt.get('receiver') else None,
                        height='high' if opt.get('loft') else 'ground', header=header or None,
                        expected_success=round(opt['p'], 2) if 'p' in opt else None)
            if etype == 'pass':
                e['outcome'] = None
                self.pending_pass = e
            # Snapshot who is offside at the moment the ball is played.
            self.offside_flags = set()
            if subtype not in OFFSIDE_EXEMPT:
                line = self.offside_x(T)
                bax, _ = T.to_att(b.x, b.y)
                for q in T.active():
                    qax, _ = T.to_att(q.x, q.y)
                    if q is not p and qax > line + 0.1 and qax > bax and qax > PITCH_LENGTH / 2:
                        self.offside_flags.add(q.id)
            self.offside_team = T

        if restart in ('throw_in', 'corner', 'goal_kick', 'free_kick', 'penalty', 'kickoff') and e is not None:
            e['restart'] = restart
        b.holder = None
        b.in_hands = False
        b.last_touch = p
        b.flight = {'kind': 'shot' if kind == 'shoot' else subtype, 'kicker': p, 'receiver': opt.get('receiver'),
                    'event': e, 't': self.t}
        p.touch_ready_at = self.t + 0.4
        self.restart_kind = None

    def _shoot(self, p, opt, header=False, z0=0.0, pressure=0.0):
        b = self.ball
        T = self.team_of(p)
        rng = self.rng
        gx = PITCH_LENGTH if T.direction == 1 else 0.0
        finishing = p.a('heading') if header else p.a('finishing')
        penalty = opt.get('subtype') == 'penalty'
        gk = next((q for q in self.other(T).active() if q.is_gk), None)

        # Aim: inside a post, usually away from the keeper; better finishers aim tighter.
        inset = 0.35 + 0.9 * (1 - finishing)
        if gk and rng.random() < 0.75:
            side = GOAL_Y1 if gk.y > 34 else GOAL_Y2
        else:
            side = rng.choice((GOAL_Y1, GOAL_Y2))
        aim_y = side + inset if side == GOAL_Y1 else side - inset
        if penalty and rng.random() < 0.12:
            aim_y = 34 + rng.uniform(-0.8, 0.8)
        aim_z = rng.choice((rng.uniform(0.15, 0.6), rng.uniform(0.3, 2.1)))
        power = 0.55 + 0.45 * rng.random() * (0.5 + 0.5 * finishing)
        speed = (11 + 5 * finishing) if header else (19 + 13 * power * (0.7 + 0.3 * finishing))

        dx, dy = gx - b.x, aim_y - b.y
        d = math.hypot(dx, dy)
        sigma = TUNING['shot_error_base'] + TUNING['shot_error_skill'] * (1 - finishing) + TUNING['shot_error_pressure'] * pressure
        if header:
            sigma += TUNING['header_error_extra']
        if penalty:
            sigma *= 0.55
        sigma *= 1 + max(0.0, d - 18) / 40
        ang = math.radians(rng.gauss(0, sigma))
        ux, uy = rotate(dx / d, dy / d, ang)
        t_flight = d / (speed * 0.93)
        vz = (aim_z - z0 + 0.5 * physics.GRAVITY * t_flight * t_flight) / t_flight
        vz += rng.gauss(0, speed * math.tan(math.radians(sigma)) * 0.7)
        h = math.sqrt(max(speed * speed - vz * vz, 1.0))
        b.vx, b.vy, b.vz = ux * h, uy * h, vz
        b.z = z0

        # Where will it cross the goal line (ignoring deflections)?
        cross = None
        for tt, x, y, z, _ in physics.predict(b.x, b.y, b.z, b.vx, b.vy, b.vz, 4.0, every=0.1):
            if (T.direction == 1 and x >= PITCH_LENGTH) or (T.direction == -1 and x <= 0):
                cross = (tt, y, z)
                break
        on_target = bool(cross and GOAL_Y1 < cross[1] < GOAL_Y2 and cross[2] < GOAL_HEIGHT)

        ax, ay = T.to_att(b.x, b.y)
        opps = [(*T.to_att(o.x, o.y), 0, o) for o in self.other(T).active()]
        xg = decisions.expected_goals(ax, ay, header=header, pressure=pressure,
                                      blockers=decisions.blockers_in_cone(ax, ay, opps), penalty=penalty)
        assist = None
        last = self.last_pass_to.get(p.id)
        if last and last[1] == self.poss_id:
            assist = last[0].id
        e = self.ev('shot', p, xg=round(xg, 3), on_target=on_target, body='head' if header else 'foot',
                    subtype=opt.get('subtype', 'open'), speed=round(speed, 1), assist_candidate=assist, outcome=None,
                    end_y=round(cross[1], 2) if cross else None, end_z=round(cross[2], 2) if cross else None)
        self.pending_shot = e
        if self.pending_pass is not None and self.pending_pass.get('outcome') is None:
            self.pending_pass = None

        if gk and cross:
            reaction = TUNING['gk_reaction'] + 0.15 * (1 - gk.a('reflexes'))
            if penalty:
                guess = rng.choice((GOAL_Y1 + 1.2, 34.0, GOAL_Y2 - 1.2)) if rng.random() < 0.85 else cross[1]
                self.gk_dive[gk.idx] = {'at': self.t, 'y': guess, 'until': self.t + 1.5}
            else:
                # Keeper reads the shot with an error that shrinks with positioning skill.
                read_y = cross[1] + rng.gauss(0, 0.6 * (1.2 - gk.a('gk_positioning')))
                self.gk_dive[gk.idx] = {'at': self.t + reaction, 'y': clamp(read_y, GOAL_Y1 - 0.5, GOAL_Y2 + 0.5),
                                        'until': self.t + reaction + 1.4}
        return e

    # ---------- free ball ----------

    def _reach(self, q, z, hands):
        if hands:
            dive = self.gk_dive.get(q.idx)
            ext = 1.9 if dive and self.t >= dive['at'] else 1.05
            return ext if z < 2.65 else 0.0
        if z < 0.6:
            # Harder to get a foot to a fast ball.
            sp = math.hypot(self.ball.vx, self.ball.vy)
            return 0.95 - clamp((sp - 10) * 0.03, 0.0, 0.35)
        if z < 1.7:
            return 0.6
        if z < 2.75:
            return 0.5 + 0.1 * q.a('heading')
        return 0.0

    def _gk_hands_allowed(self, q):
        if not q.is_gk or not self.in_own_box(q):
            return False
        f = self.ball.flight
        # Back-pass rule: no hands from a teammate's deliberate pass or throw.
        if f and f.get('kicker') is not None and f['kicker'].side == q.side and f['kind'] not in ('shot', 'deflection', 'loose'):
            return False
        return True

    def _free_ball_contacts(self, prev):
        b = self.ball
        f = b.flight or {}
        px, py, pz = prev
        cands = []
        for q in self.players:
            if q.sent_off or self.t < q.touch_ready_at:
                continue
            if f.get('kind') == 'shot' and q.side == f['kicker'].side:
                continue
            dh, tp = seg_point_dist(px, py, b.x, b.y, q.x, q.y)
            if dh > 2.0:
                continue
            z = pz + (b.z - pz) * tp
            hands = self._gk_hands_allowed(q)
            r = self._reach(q, z, hands)
            if dh <= r:
                cands.append((dh, q, z, hands, tp))
        if not cands:
            return

        # Aerial duel: players from both teams competing for a high ball.
        high = [c for c in cands if c[2] >= 1.5 and not c[3]]
        if len(high) >= 2 and len({c[1].side for c in high}) == 2 and not any(c[3] for c in cands):
            def power(c):
                q = c[1]
                return q.a('heading') * 0.6 + q.a('strength') * 0.3 + q.a('agility') * 0.1 + self.rng.gauss(0, 0.18)
            ranked = sorted(high, key=power, reverse=True)
            winner, loser = ranked[0], next(c for c in ranked if c[1].side != ranked[0][1].side)
            self._set_ball_at(px, py, pz, winner[4], winner[2])
            if self.rng.random() < 0.06 + 0.08 * loser[1].a('aggression'):
                # A push or a leading arm in the challenge.
                self._foul(loser[1], winner[1], False)
                return
            self.ev('aerial_duel', winner[1], won=True, opponent=loser[1].id)
            self._header(winner[1])
            return

        cands.sort(key=lambda c: (c[0], self.rng.random()))
        dh, q, z, hands, tp = cands[0]
        self._set_ball_at(px, py, pz, tp, z)
        self._contact(q, z, hands, dh)

    def _set_ball_at(self, px, py, pz, tp, z):
        b = self.ball
        b.x, b.y = px + (b.x - px) * tp, py + (b.y - py) * tp
        b.z = max(0.0, z)

    def _contact(self, q, z, hands, dh):
        b = self.ball
        f = b.flight or {}
        rng = self.rng
        kicker = f.get('kicker')
        speed = b.speed()
        v_rel = math.sqrt((b.vx - q.vx) ** 2 + (b.vy - q.vy) ** 2 + b.vz ** 2)
        teammate = kicker is not None and kicker.side == q.side

        # A ball just struck past a defender standing next to the kicker: he may get a block
        # in, but mostly the kicker plays it around him. No clean control from point-blank range.
        if kicker is not None and not teammate and self.t - f.get('t', -9) < 0.3 and f.get('kind') != 'shot':
            if rng.random() < 0.08 + 0.15 * q.a('marking'):
                self.ev('block', q)
                self._resolve_pass('intercepted', q)
                # Blocked crosses keep going roughly the same way (often behind for a corner).
                self._deflect(q, 0.3, 0.6, 30 if f.get('kind') in ('cross', 'corner') else 60)
            else:
                q.touch_ready_at = self.t + 0.4
            return

        # Offside: a flagged attacker becomes involved.
        if teammate and q.id in self.offside_flags and f.get('kind') not in ('shot', 'deflection', 'loose') + OFFSIDE_EXEMPT:
            self.ev('offside', q)
            self._resolve_pass('offside')
            other = self.other(self.team_of(q))
            self._start_restart('free_kick', other, (clamp(q.x, 1, PITCH_LENGTH - 1), clamp(q.y, 1, PITCH_WIDTH - 1)), (12, 24), offside=True)
            return

        # Shots
        if f.get('kind') == 'shot':
            if hands:
                self._save_attempt(q, z, dh, speed)
            else:
                p_block = 0.55 + 0.3 * q.a('marking')
                if rng.random() < p_block:
                    self._resolve_shot('blocked')
                    self.ev('block', q)
                    # Blocked shots lose most of their pace and scatter off the defender's body.
                    self._deflect(q, 0.15, 0.45, 60)
                else:
                    q.touch_ready_at = self.t + 0.6
            return

        # Headers (outfield, no hands): redirect instead of controlling.
        if z >= 1.7 and not hands:
            self._header(q)
            return

        # First-time finish from a low cross in the box.
        T = self.team_of(q)
        ax, ay = T.to_att(q.x, q.y)
        if (f.get('kind') in ('cross', 'corner') and teammate and ax > PITCH_LENGTH - BOX_DEPTH
                and BOX_Y1 < ay < BOX_Y2 and z < 1.7):
            xg = decisions.expected_goals(ax, ay)
            if rng.random() < clamp(xg * 3.0, 0.15, 0.85):
                self._resolve_pass('complete', q)
                self._kick(q, {'kind': 'shoot', 'subtype': 'volley'}, header=False, z0=z)
                return

        # Control attempt
        pressure = decisions.pressure_on(ax, ay, [(*T.to_att(o.x, o.y), 0, o) for o in self.other(T).active()])
        if hands:
            logit = 3.4 + 2.2 * (q.a('handling') - 0.5) - 0.12 * max(0.0, v_rel - 12)
        else:
            logit = (TUNING['first_touch_base'] + 2.6 * (q.a('first_touch') - 0.5) - 0.2 * max(0.0, v_rel - 7)
                     - 0.8 * min(pressure, 1.5) - (1.2 if z > 0.6 else 0.0))
            if f.get('kind') in ('long', 'gk_kick', 'clearance', 'cross', 'corner', 'free_kick', 'goal_kick'):
                # Dropping balls are harder to kill, especially with an opponent challenging.
                contest = any(dist(o.x, o.y, q.x, q.y) < 1.8 for o in self.other(T).active())
                logit -= 0.5 + (0.9 if contest else 0.0)
            if not teammate and f.get('receiver') is not None and v_rel > 9:
                logit -= 0.7     # reading and cutting out a pass is harder than receiving it
        if rng.random() < sigmoid(logit):
            live_pass = f.get('kind') not in ('deflection', 'loose') and speed > 9.0
            how = 'catch' if hands else ('reception' if teammate and f.get('kind') not in ('deflection', 'loose') else
                                         'interception' if kicker is not None and not teammate and live_pass else 'recovery')
            self._gain(q, how, hands=hands)
        else:
            self.ev('miscontrol' if teammate else 'deflection', q)
            if teammate:
                self._resolve_pass('complete', q)
            else:
                self._resolve_pass('intercepted', q)
            self._deflect(q, 0.25, 0.55, 55)

    def _deflect(self, q, lo, hi, spread_deg):
        b = self.ball
        rng = self.rng
        k = rng.uniform(lo, hi)
        vx, vy = rotate(b.vx * k, b.vy * k, math.radians(rng.gauss(0, spread_deg)))
        b.vx, b.vy = vx, vy
        b.vz = abs(b.vz) * 0.3 + (rng.uniform(0, 2.5) if b.z > 0.3 else 0.0)
        b.last_touch = q
        b.flight = {'kind': 'deflection', 'kicker': q, 'receiver': None, 'event': None, 't': self.t}
        q.touch_ready_at = self.t + 0.5
        self._set_possession(self.team_of(q))

    def _header(self, q):
        b = self.ball
        T = self.team_of(q)
        f = b.flight or {}
        teammate = f.get('kicker') is not None and f['kicker'].side == q.side
        self._resolve_pass('complete' if teammate else 'intercepted', q)
        ax, ay = T.to_att(q.x, q.y)
        z = b.z
        if ax > PITCH_LENGTH - BOX_DEPTH and BOX_Y1 < ay < BOX_Y2 and f.get('kind') in ('cross', 'corner', 'long', 'free_kick', 'deflection', 'throw'):
            self._set_possession(T)
            self._kick(q, {'kind': 'shoot', 'subtype': 'header'}, header=True, z0=z)
            return
        if ax < BOX_DEPTH + 2 and BOX_Y1 - 4 < ay < BOX_Y2 + 4 and self.rng.random() < 0.3 + 0.2 * (1 - q.a('heading')):
            # Under a dropping ball in his own box: glanced or headed behind for safety.
            side = -1 if ay < 34 else 1
            tx, ty = -4.0, ay + side * self.rng.uniform(4, 12)
            opt = {'kind': 'clear', 'subtype': 'header', 'target': T.from_att(tx, ty), 'loft': 25, 'z0': z,
                   'speed': physics.loft_speed_for(max(5.0, dist(ax, ay, tx, ty)), 25, z0=z) or 10.0}
        elif ax < 40:
            tx, ty = ax + 22, (ay - 34) * 1.3 + 34
            opt = {'kind': 'clear', 'subtype': 'header', 'target': T.from_att(clamp(tx, 5, 100), clamp(ty, 3, 65)), 'loft': 32, 'z0': z}
            opt['speed'] = physics.loft_speed_for(max(8.0, dist(ax, ay, tx, ty)), 32, z0=z) or 13.0
        else:
            mates = [m for m in T.active() if m is not q and 5 < dist(q.x, q.y, m.x, m.y) < 22]
            if mates:
                m = max(mates, key=lambda m: T.to_att(m.x, m.y)[0] - 0.4 * dist(q.x, q.y, m.x, m.y))
                d = dist(q.x, q.y, m.x, m.y)
                opt = {'kind': 'pass', 'subtype': 'header', 'target': (m.x, m.y), 'receiver': m, 'loft': 12, 'z0': z,
                       'speed': physics.loft_speed_for(d, 12, z0=z) or 11.0}
            else:
                tx, ty = T.from_att(clamp(ax + 15, 3, 102), ay)
                opt = {'kind': 'clear', 'subtype': 'header', 'target': (tx, ty), 'loft': 25, 'z0': z,
                       'speed': physics.loft_speed_for(15, 25, z0=z) or 12.0}
        self._set_possession(T)
        self._kick(q, opt, header=True, z0=z)

    def _save_attempt(self, gk, z, dh, speed):
        b = self.ball
        rng = self.rng
        reach = self._reach(gk, z, True)
        # Shots near the keeper's body are routine; the save gets harder with stretch and pace.
        stretch = min(dh / max(reach, 0.1), 1.2)
        logit = (TUNING['gk_save_base'] + 2.0 * (gk.a('reflexes') - 0.5) + 1.0 * (gk.a('diving') - 0.5)
                 - 0.07 * max(0.0, speed - 20) - 3.2 * stretch ** 1.5)
        if rng.random() < sigmoid(logit):
            p_catch = clamp(0.25 + 0.6 * gk.a('handling') - 0.025 * max(0.0, speed - 14), 0.05, 0.85)
            if z < 2.3 and rng.random() < p_catch:
                self._resolve_shot('saved')
                self.ev('save', gk, result='caught')
                self._gain(gk, 'catch', hands=True)
            else:
                self._resolve_shot('saved')
                self.ev('save', gk, result='parried')
                T = self.team_of(gk)
                away = 1 if T.direction == 1 else -1
                if rng.random() < 0.62:
                    # Pushed wide / around the post / over the bar: usually ends up a corner.
                    side = 1 if b.y > 34 else -1
                    b.vx = -away * rng.uniform(3, 8)
                    b.vy = side * rng.uniform(6, 12)
                else:
                    # Parried back out: scattered sideways, rarely straight back to the shooter.
                    b.vx = abs(b.vx) * rng.uniform(0.1, 0.3) * away
                    b.vy = rng.choice((-1, 1)) * rng.uniform(5, 11)
                b.vz = rng.uniform(0.0, 3.5)
                b.last_touch = gk
                b.flight = {'kind': 'deflection', 'kicker': gk, 'receiver': None, 'event': None, 't': self.t}
                gk.touch_ready_at = self.t + 0.7
                self._set_possession(T)
        else:
            gk.touch_ready_at = self.t + 1.0
            if dh < reach * 0.8 and rng.random() < 0.4:
                # Fingertips: slows the ball a little without stopping it.
                b.vx *= 0.85
                b.vy *= 0.85

    # ---------- possession bookkeeping ----------

    def _set_possession(self, team):
        if team is not self.possession:
            self.possession = team
            self.poss_id += 1
            for p in self.players:
                p.react_at = self.t + 0.15 + self.rng.uniform(0, 0.5) * (1.2 - p.a('decisions'))
                p.run_until = 0

    def _gain(self, q, how, hands=False):
        b = self.ball
        self._resolve_pass('complete' if self.pending_pass and self.pending_pass['team'] == q.team else 'intercepted', q)
        if self.pending_shot and self.pending_shot.get('outcome') is None:
            self._resolve_shot('saved' if hands else 'blocked')
        self.pending_shot = None
        b.holder = q
        b.in_hands = hands
        b.flight = None
        b.last_touch = q
        q.action = None
        pressure = decisions.pressure_on(*self.team_of(q).to_att(q.x, q.y),
                                         [(*self.team_of(q).to_att(o.x, o.y), 0, o) for o in self.other(self.team_of(q)).active()])
        q.decide_at = self.t + (0.2 + 0.45 * (1 - q.a('first_touch')) + 0.15 * min(pressure, 1.5))
        if hands and how == 'catch':
            q.decide_at = self.t + self.rng.uniform(2.0, 5.0)
        self.offside_flags = set()
        self._set_possession(self.team_of(q))
        self._attach_ball(q)
        self.ev('control', q, how=how)

    def _resolve_pass(self, outcome, q=None):
        e = self.pending_pass
        if e is None:
            return
        if outcome in ('complete', 'intercepted') and q is not None:
            outcome = 'complete' if e['team'] == q.team else 'intercepted'
        e['outcome'] = outcome
        if q is not None:
            e['receiver' if outcome == 'complete' else 'intercepted_by'] = q.id
            if outcome == 'complete':
                passer = next(p for p in self.players if p.id == e['player'])
                self.last_pass_to[q.id] = (passer, self.poss_id)
        self.pending_pass = None

    def _resolve_shot(self, outcome):
        e = self.pending_shot
        if e is not None and e.get('outcome') is None:
            e['outcome'] = outcome
        if outcome != 'woodwork':
            self.pending_shot = None

    # ---------- duels ----------

    def _duel_update(self, p):
        rng = self.rng
        t = self.t
        T = self.team_of(p)
        in_windup = p.action is not None and p.action['kind'] in KICK_TYPES
        for o in self.other(T).active():
            if t < o.stunned_until or t < o.tackle_ready_at or o.is_gk and not self.in_own_box(o):
                continue
            d = dist(p.x, p.y, o.x, o.y)
            if d > 1.4:
                continue
            # Defenders mostly jockey; they commit to a tackle only now and then, more often
            # when aggressive, when the carrier is winding up a kick, or when right on top of him.
            rate = TUNING['tackle_rate'] * (0.6 + 0.8 * o.a('aggression')) * (1.5 if in_windup else 1.0) * (1.4 if d < 0.9 else 1.0)
            if self.in_own_box(o):
                rate *= 0.6
            ux, uy, _ = unit(o.x - p.x, o.y - p.y)
            if ux * p.fx + uy * p.fy < -0.5:
                rate *= 0.5   # sensible defenders rarely tackle from behind
            if rng.random() >= rate * TICK:
                continue
            self._tackle(o, p)
            return

    def _tackle(self, o, p):
        rng = self.rng
        t = self.t
        # Is the tackle coming from behind the carrier?
        ux, uy, _ = unit(o.x - p.x, o.y - p.y)
        behind = (ux * p.fx + uy * p.fy) < -0.5
        skill = o.a('tackling') - (0.6 * p.a('dribbling') + 0.2 * p.a('strength') + 0.2 * p.a('agility'))
        p_win = clamp(TUNING['tackle_base_success'] + 0.9 * skill - (0.18 if behind else 0.0), 0.08, 0.85)
        p_foul = clamp(TUNING['foul_base'] + 0.12 * o.a('aggression') + (0.1 if behind else 0.0) - 0.08 * o.a('tackling'), 0.02, 0.4)
        if self.in_own_box(o):
            p_foul *= 0.5     # defenders are more careful in their own box
        o.tackle_ready_at = t + 1.0
        r = rng.random()
        if r < p_foul:
            self._foul(o, p, behind)
        elif r < p_foul + p_win * (1 - p_foul):
            if rng.random() < 0.5:
                self.ev('tackle', o, won=True, opponent=p.id)
                p.action = None
                p.stunned_until = t + 0.5
                self._gain(o, 'tackle')
            else:
                self.ev('tackle', o, won=True, opponent=p.id, loose=True)
                b = self.ball
                b.holder = None
                p.action = None
                ang = math.atan2(p.fy, p.fx) + rng.gauss(0, 1.2)
                sp = rng.uniform(3, 8)
                b.vx, b.vy, b.vz = math.cos(ang) * sp, math.sin(ang) * sp, 0.0
                b.last_touch = o
                b.flight = {'kind': 'loose', 'kicker': o, 'receiver': None, 'event': None, 't': t}
                o.touch_ready_at = t + 0.3
                p.touch_ready_at = t + 0.4
                self._set_possession(self.team_of(o))
        else:
            # Beaten. Sometimes the defender brings the attacker down rather than let him go.
            if rng.random() < 0.10 + 0.15 * o.a('aggression'):
                self._foul(o, p, behind)
                return
            o.stunned_until = t + rng.uniform(0.7, 1.2)
            self.ev('tackle', o, won=False, opponent=p.id)
            if p.action and p.action['kind'] == 'dribble':
                self.ev('take_on', p, won=True, opponent=o.id)

    def _foul(self, o, p, behind):
        rng = self.rng
        victim_team = self.team_of(p)
        e = self.ev('foul', o, on=p.id, x=p.x, y=p.y)
        self.stoppages += 4
        vax, vay = victim_team.to_att(p.x, p.y)
        # Denying an obvious goal-scoring opportunity?
        covering = [d for d in self.team_of(o).active() if d is not o and not d.is_gk and victim_team.to_att(d.x, d.y)[0] > vax]
        dogso = vax > 80 and abs(vay - 34) < 16 and not covering
        card = None
        if o.yellow == 0 and dogso and rng.random() < 0.7:
            card = 'red'
        elif rng.random() < 0.012:
            card = 'red'
        elif rng.random() < TUNING['yellow_on_foul'] * (0.6 + 0.8 * o.a('aggression')) + (0.12 if behind else 0) + (0.2 if dogso else 0):
            card = 'yellow' if o.yellow == 0 else 'second_yellow'
        if card:
            self.stoppages += 12
            if card == 'yellow':
                o.yellow = 1
            self.ev('card', o, card=card, x=o.x, y=o.y)
            if card in ('red', 'second_yellow'):
                o.sent_off = True
                o.chasing = False
                if o.is_gk:
                    self._emergency_keeper(self.team_of(o))
        p.action = None
        in_box = vax > PITCH_LENGTH - BOX_DEPTH and BOX_Y1 < vay < BOX_Y2
        if in_box:
            spot = victim_team.from_att(PITCH_LENGTH - PENALTY_SPOT, 34)
            self._start_restart('penalty', victim_team, spot, (60, 100))
        else:
            self._start_restart('free_kick', victim_team, (clamp(p.x, 0.5, PITCH_LENGTH - 0.5), clamp(p.y, 0.5, PITCH_WIDTH - 0.5)), (18, 40))

    def _emergency_keeper(self, team):
        """No substitutes: when the keeper is sent off, a defender goes in goal."""
        cands = [p for p in team.active() if not p.is_gk]
        if not cands:
            return
        k = max(cands, key=lambda p: (p.line == 'DEF', p.attrs['strength'] + p.attrs['composure']))
        old_slot = k.slot
        k.slot, k.line = 'GK', 'GK'
        for a in ('reflexes', 'handling', 'gk_positioning', 'diving'):
            k.attrs[a] = max(k.attrs[a], 25.0)
        self.ev('position_change', k, new_slot='GK', old_slot=old_slot)

    # ---------- boundaries, goals, restarts ----------

    def _check_boundaries(self, prev):
        b = self.ball
        px, py, pz = prev
        if 0 <= b.x <= PITCH_LENGTH and 0 <= b.y <= PITCH_WIDTH:
            return
        rng = self.rng
        if b.x < 0 or b.x > PITCH_LENGTH:
            line_x = 0.0 if b.x < 0 else PITCH_LENGTH
            k = (line_x - px) / (b.x - px) if b.x != px else 1.0
            yc, zc = py + (b.y - py) * k, pz + (b.z - pz) * k
            if 0 <= yc <= PITCH_WIDTH:
                near_post = min(abs(yc - GOAL_Y1), abs(yc - GOAL_Y2)) < 0.17 and zc < GOAL_HEIGHT + 0.1
                bar = GOAL_Y1 < yc < GOAL_Y2 and abs(zc - GOAL_HEIGHT) < 0.15
                if near_post or bar:
                    b.x = line_x + (0.2 if line_x == 0 else -0.2)
                    b.y = yc
                    if near_post:
                        b.vx = -b.vx * 0.55
                        b.vy += rng.uniform(-3, 3)
                    else:
                        b.vz = -abs(b.vz) * 0.5
                        b.vx = -b.vx * 0.4
                    self._resolve_shot('woodwork')
                    self.ev('woodwork', team=None, x=b.x, y=b.y, part='post' if near_post else 'bar')
                    b.flight = {'kind': 'deflection', 'kicker': b.last_touch, 'receiver': None, 'event': None, 't': self.t}
                    return
                if GOAL_Y1 < yc < GOAL_Y2 and zc < GOAL_HEIGHT:
                    self._goal(line_x, yc)
                    return
            # Out over the goal line
            defending = self.home if (self.home.direction == 1) == (line_x == 0) else self.away
            self._resolve_pass('out')
            self._resolve_shot('off_target')
            self.ev('out', team=None, x=line_x, y=clamp(yc, 0, PITCH_WIDTH), last_touch=b.last_touch.id if b.last_touch else None)
            if b.last_touch is not None and b.last_touch.side == defending.side:
                attacking = self.other(defending)
                spot = (0.3 if line_x == 0 else PITCH_LENGTH - 0.3, 0.3 if yc < 34 else PITCH_WIDTH - 0.3)
                self._start_restart('corner', attacking, spot, (24, 40))
            else:
                spot = (SIX_DEPTH if line_x == 0 else PITCH_LENGTH - SIX_DEPTH, 34 + (-4 if yc < 34 else 4))
                self._start_restart('goal_kick', defending, spot, (14, 28))
            return
        # Touchline: throw-in to the other team.
        line_y = 0.0 if b.y < 0 else PITCH_WIDTH
        k = (line_y - py) / (b.y - py) if b.y != py else 1.0
        xc = clamp(px + (b.x - px) * k, 0.5, PITCH_LENGTH - 0.5)
        self._resolve_pass('out')
        self._resolve_shot('off_target')
        self.ev('out', team=None, x=xc, y=line_y, last_touch=b.last_touch.id if b.last_touch else None)
        taker_team = self.away if (b.last_touch is None or b.last_touch.side == 0) else self.home
        self._start_restart('throw_in', taker_team, (xc, line_y), (8, 17))

    def _goal(self, line_x, yc):
        b = self.ball
        scoring = self.home if (self.home.direction == 1) == (line_x == PITCH_LENGTH) else self.away
        scorer = b.last_touch
        own_goal = scorer is not None and scorer.side != scoring.side
        shot = self.pending_shot
        self._resolve_shot('goal')
        if shot:
            shot['outcome'] = 'goal'     # also covers a shot that went in off the post
        assist = None
        if shot and not own_goal and shot.get('player') == (scorer.id if scorer else None):
            assist = shot.get('assist_candidate')
        self.score[scoring.side] += 1
        self.stoppages += 30
        # The ball finishes in the net and stays there during the celebration.
        b.x = line_x + (-1.2 if line_x == 0 else 1.2)
        b.y = clamp(yc, GOAL_Y1 + 0.3, GOAL_Y2 - 0.3)
        b.z = min(b.z, 1.5)
        self.ev('goal', team=scoring, x=line_x, y=yc, scorer=scorer.id if scorer else None, own_goal=own_goal,
                assist=assist, score=list(self.score), shot=shot['id'] if shot else None)
        conceding = self.other(scoring)
        self._start_restart('kickoff', conceding, (52.5, 34), (50, 80), taker=self._kickoff_taker(conceding))

    def _choose_taker(self, kind, team, spot):
        act = [p for p in team.active()]
        if kind == 'goal_kick':
            return next((p for p in act if p.is_gk), act[0])
        outfield = [p for p in act if not p.is_gk] or act
        near = sorted(outfield, key=lambda p: dist(p.x, p.y, *spot))
        # The manager's chosen taker, if on the pitch (free kicks only within shooting/crossing range).
        pick = next((p for p in outfield if str(p.id) == team.takers.get(kind)), None)
        if pick and (kind != 'free_kick' or team.to_att(*spot)[0] >= 40):
            return pick
        if kind == 'throw_in':
            return near[0]
        if kind == 'corner':
            return max(near[:6], key=lambda p: p.attrs['crossing'])
        if kind == 'penalty':
            return max(outfield, key=lambda p: p.attrs['finishing'] + p.attrs['composure'])
        if kind == 'free_kick':
            if team.to_att(*spot)[0] < 40:
                return near[0]
            return max(near[:4], key=lambda p: p.attrs['passing'] + p.attrs['long_shots'])
        return near[0]

    def _start_restart(self, kind, team, spot, delay, taker=None, **extra):
        b = self.ball
        self._resolve_pass('out')
        if self.pending_shot and self.pending_shot.get('outcome') is None:
            self._resolve_shot('off_target')
        self.pending_shot = None
        self.phase = 'dead'
        b.holder = None
        b.in_hands = False
        b.in_play = False
        b.flight = None
        b.stop()
        # The ball stays where play stopped (in the net, behind the goal line, by the foul)
        # and is only placed on the restart spot when the restart is taken.
        b.x = clamp(b.x, -3.0, PITCH_LENGTH + 3.0)
        b.y = clamp(b.y, -3.0, PITCH_WIDTH + 3.0)
        b.z = 0.0 if kind != 'kickoff' else b.z
        self.offside_flags = set()
        self.gk_dive = {}
        taker = taker or self._choose_taker(kind, team, spot)
        ready = self.t + self.rng.uniform(delay[0], delay[1])
        self.restart = {'kind': kind, 'team': team, 'spot': spot, 'taker': taker,
                        'ready_at': ready, 'max_at': ready + 12}
        self.restart_targets = tactics.setpiece_targets(kind, team, self.other(team), spot, taker, self.offside_x(team))
        for p in self.players:
            p.action = None
            p.chasing = False
            p.run_until = 0
            p.retarget_at = self.t
        self._set_possession(team)
        if kind != 'kickoff':
            self.stoppages += {'throw_in': 0.5, 'goal_kick': 2, 'corner': 4, 'free_kick': 3, 'penalty': 30}.get(kind, 0)

    def _dead_update(self):
        r = self.restart
        taker = r['taker']
        if taker.sent_off:
            r['taker'] = taker = self._choose_taker(r['kind'], r['team'], r['spot'])
        if self.t < r['ready_at'] or dist(taker.x, taker.y, *r['spot']) > 0.8:
            return
        if self.t < r['max_at']:
            for p, (x, y) in self.restart_targets.items():
                if not p.sent_off and dist(p.x, p.y, x, y) > 3.0:
                    return
        # Take the restart.
        self.phase = 'play'
        b = self.ball
        b.in_play = True
        b.x, b.y = r['spot']
        taker.x, taker.y = taker.x, taker.y
        self.restart_kind = r['kind']
        hands = r['kind'] == 'throw_in'
        b.holder = taker
        b.in_hands = hands
        b.last_touch = taker
        taker.action = None
        taker.decide_at = self.t + (0.4 if r['kind'] != 'penalty' else 1.0)
        self.ev(r['kind'], taker, x=r['spot'][0], y=r['spot'][1])
        self.ev('control', taker, how='restart')
        self._set_possession(r['team'])
        if r['kind'] == 'penalty':
            gk = next((q for q in self.other(r['team']).active() if q.is_gk), None)
            if gk:
                gk.stunned_until = 0

    # ---------- off-ball movement ----------

    def _update_targets(self):
        t = self.t
        b = self.ball
        if self.phase == 'dead':
            for p in self.players:
                if p.sent_off:
                    continue
                if p is self.restart['taker']:
                    p.tx, p.ty = self.restart['spot']
                    p.tx -= 0.3 * (1 if self.team_of(p).direction == 1 else -1)
                    p.urgency = 2
                else:
                    p.tx, p.ty = self.restart_targets.get(p, (p.x, p.y))
                    p.urgency = 2 if dist(p.x, p.y, p.tx, p.ty) > 20 else 1
            return

        holder = b.holder
        if holder is None and t >= self.next_chaser_update:
            self._update_chasers()
            self.next_chaser_update = t + 0.2

        poss = self.team_of(holder) if holder else self.possession
        for team in (self.home, self.away):
            in_poss = team is poss
            bx, by = team.to_att(b.x, b.y)
            off_line = self.offside_x(team)
            presser = second = None
            if holder is not None and not in_poss and not b.in_hands:
                ranked = sorted((p for p in team.active() if not p.is_gk),
                                key=lambda p: dist(p.x, p.y, holder.x, holder.y) / p.vmax())
                presser = ranked[0] if ranked else None
                hx, _ = team.to_att(holder.x, holder.y)
                if len(ranked) > 1 and (hx < 38 or team.tactic('pressing') > 0.65):
                    second = ranked[1]
            for p in team.active():
                if p is holder:
                    self._carrier_target(p)
                    continue
                if holder is None and p.chasing:
                    continue
                if t < p.retarget_at:
                    continue
                p.retarget_at = t + 0.3
                if t < p.react_at:
                    continue
                if p.is_gk and p.idx in self.gk_dive:
                    continue
                if p is presser:
                    lead = 0.25
                    p.tx, p.ty = holder.x + holder.vx * lead, holder.y + holder.vy * lead
                    p.urgency = 3
                    continue
                if p is second:
                    mates = [m for m in self.other(team).active() if m is not holder]
                    if mates:
                        m = min(mates, key=lambda m: dist(m.x, m.y, holder.x, holder.y))
                        p.tx, p.ty = (holder.x + m.x) / 2, (holder.y + m.y) / 2
                        p.urgency = 2
                        continue
                self._shape_target(p, team, bx, by, in_poss, off_line, holder)

    def _carrier_target(self, p):
        act = p.action
        if self.ball.in_hands:
            p.tx, p.ty = p.x, p.y
            p.urgency = 0
        elif act and act['kind'] == 'dribble':
            p.tx, p.ty = act['target']
            p.urgency = 3
        else:
            p.tx, p.ty = p.x + p.vx * 0.3, p.y + p.vy * 0.3
            p.urgency = 1

    def _shape_target(self, p, team, bx, by, in_poss, off_line, holder):
        t = self.t
        rng = self.rng
        # Offside awareness: most players hold the line; less aware ones drift offside sometimes.
        # The misjudgement persists for a few seconds, like a player who has lost track of the line.
        if t >= p.oe_until:
            p.oe = rng.gauss(1.0, 1.4 * (1.15 - p.a('positioning')))
            p.oe_until = t + rng.uniform(4, 8)
        line = off_line - p.oe
        ax, ay = tactics.shape_target(p, team, bx, by, in_poss, line)
        urgency = 1
        pax, pay = team.to_att(p.x, p.y)

        if in_poss and holder is not None and not p.is_gk:
            hax, hay = team.to_att(holder.x, holder.y)
            # Attacking the final third: fill the box instead of leaving the striker alone.
            # Wide forwards cut inside into the channels; the far-side central midfielder arrives
            # late at the edge of the area.
            if hax > 66 and p.run_until <= t:
                y_base = tactics.FORMATIONS.get(team.formation, tactics.FORMATIONS['4-3-3'])[p.slot][1]
                if p.line in ('FWD', 'AM') and p.slot not in ('ST', 'LST', 'RST', 'CAM'):
                    side = -1 if y_base < 34 else 1
                    ax = max(ax, min(line - 0.5, 97.0))
                    ay = ay + ((34 + side * 8) - ay) * 0.7
                elif p.slot in ('LCM', 'RCM', 'CAM', 'LM', 'RM', 'LDM', 'RDM'):
                    far_side = (y_base - 34) * (hay - 34) < 0
                    ax = max(ax, 85.0 if far_side else 79.0)
                    ay = ay + (34 - ay) * (0.55 if far_side else 0.3)
            # Forward runs in behind.
            if p.run_until > t:
                ax, ay = p.tx_att_run
                urgency = 3
            elif (p.line in ('FWD', 'AM') or (p.slot in tactics.WIDE_SLOTS and hax > 55)) and hax > 28 \
                    and pax < off_line - 0.5 and abs(pax - off_line) < 10 and t > p.run_until + 2.5 \
                    and rng.random() < 0.2 * (0.5 + p.a('positioning')) * (0.6 + p.a('work_rate')):
                # Run in behind. Timing is imperfect: some runs start slightly offside.
                p.run_until = t + rng.uniform(2.0, 3.2)
                p.tx_att_run = (clamp(off_line + 14, 0, PITCH_LENGTH - 4), clamp(pay + (34 - pay) * 0.35, 4, 64))
                ax, ay = p.tx_att_run
                urgency = 3
            elif dist(pax, pay, hax, hay) < 30 and t >= p.support_at:
                ax, ay = self._support_point(p, team, ax, ay, hax, hay)
                p.support_ax = (ax, ay)
                p.support_at = t + 0.6
                urgency = 2 if dist(pax, pay, ax, ay) > 8 else 1
            elif dist(pax, pay, hax, hay) < 30 and p.support_ax:
                ax, ay = p.support_ax
                urgency = 2 if dist(pax, pay, ax, ay) > 8 else 1
        elif not in_poss and not p.is_gk:
            # Mark the nearest dangerous opponent near our zone, staying goal-side.
            opp = self.other(team)
            best = None
            for o in opp.active():
                if o.is_gk:
                    continue
                oax, oay = team.to_att(o.x, o.y)
                d = dist(oax, oay, ax, ay)
                if d < 11 and (best is None or d < best[0]):
                    best = (d, oax, oay)
            if best:
                w = 0.65 * p.a('marking') + 0.2
                gx, gy, _ = unit(0 - best[1], 34 - best[2])
                mx, my = best[1] + gx * 1.6, best[2] + gy * 1.6
                ax, ay = ax + (mx - ax) * w, ay + (my - ay) * w
            if pax > bx + 4 and p.line != 'FWD':
                urgency = 3          # caught upfield: recover goal-side at full speed
            elif dist(pax, pay, ax, ay) > 6:
                urgency = 2
        if dist(pax, pay, ax, ay) > 12 and urgency < 2:
            urgency = 2
        p.tx, p.ty = team.from_att(ax, ay)
        p.urgency = urgency

    def _support_point(self, p, team, ax, ay, hax, hay):
        opps = [team.to_att(o.x, o.y) for o in self.other(team).active()]
        best, best_score = (ax, ay), -1e9
        for dx, dy in ((0, 0), (5, 0), (-5, 0), (0, 5), (0, -5), (4, 4), (4, -4), (-4, 4), (-4, -4)):
            cx, cy = clamp(ax + dx, 2, PITCH_LENGTH - 2), clamp(ay + dy, 2, PITCH_WIDTH - 2)
            open_d = min((dist(cx, cy, ox, oy) for ox, oy in opps), default=10)
            lane = min((seg_point_dist(hax, hay, cx, cy, ox, oy)[0] for ox, oy in opps), default=5)
            dh = dist(cx, cy, hax, hay)
            score = min(open_d, 8) + 1.2 * min(lane, 4) - 0.15 * math.hypot(dx, dy) - (4 if dh < 7 else 0) - (2 if dh > 32 else 0)
            if score > best_score:
                best, best_score = (cx, cy), score
        return best

    def _update_chasers(self):
        b = self.ball
        f = b.flight or {}
        pred = [(0.0, b.x, b.y, b.z, b.speed())] + physics.predict(b.x, b.y, b.z, b.vx, b.vy, b.vz, 4.0, every=0.2)
        for p in self.players:
            p.chasing = False
        if f.get('kind') == 'shot':
            return
        # Is the ball going out of play, and who would get the restart?
        exit_t = next((ts for ts, x, y, z, _ in pred if not (0 <= x <= PITCH_LENGTH and 0 <= y <= PITCH_WIDTH)), None)
        last = b.last_touch
        for team in (self.home, self.away):
            if exit_t is not None and last is not None and last.side != team.side:
                # The restart would be ours: let it run out unless it's close to our own goal line.
                ex = next((x for ts, x, y, z, _ in pred if ts >= exit_t), b.x)
                own_goal_x = 0 if team.direction == 1 else PITCH_LENGTH
                if abs(ex - own_goal_x) > 3:
                    continue
            options = []
            for p in team.active():
                if self.t < p.touch_ready_at - 0.3:
                    continue
                hands = p.is_gk and self.in_own_box(p)
                zmax = 2.5 if hands else 2.3
                if p.is_gk and not hands:
                    continue
                best = None
                for ts, x, y, z, _ in pred:
                    if not (0 <= x <= PITCH_LENGTH and 0 <= y <= PITCH_WIDTH):
                        break
                    if z > zmax:
                        continue
                    if p.is_gk and not self.in_own_box(p, x, y):
                        continue
                    need = decisions._reach_time(p.x, p.y, p.vmax(), x, y, react=0.1 if p.chasing else 0.2) - 0.8 / p.vmax()
                    if need <= ts:
                        best = (ts, x, y)
                        break
                if best is None:
                    ts, x, y, _, _ = pred[-1]
                    if not (0 <= x <= PITCH_LENGTH and 0 <= y <= PITCH_WIDTH):
                        continue
                    best = (decisions._reach_time(p.x, p.y, p.vmax(), x, y) + 1.0, x, y)
                options.append((best[0], p, best[1], best[2]))
            if not options:
                continue
            options.sort(key=lambda o: o[0])
            chosen = [options[0]]
            recv = f.get('receiver')
            for o in options[1:3]:
                if o[1] is recv and o[0] < options[0][0] + 1.2:
                    chosen.append(o)
            for ts, p, x, y in chosen:
                if self.t < p.react_at and p is not recv:
                    continue
                p.chasing = True
                p.tx, p.ty = x, y
                p.urgency = 3

    def _move_players(self):
        t = self.t
        b = self.ball
        for p in self.players:
            if p.sent_off:
                p.tx, p.ty = p.x, (-3.0 if p.y < 34 else PITCH_WIDTH + 3.0)
                p.urgency = 0

            dive = self.gk_dive.get(p.idx) if p.is_gk else None
            if dive and t >= dive['at'] and t <= dive['until']:
                # Keeper moves (dives) across the goal line toward where they read the shot.
                gx = p.x
                dy = dive['y'] - p.y
                step = clamp(dy, -TUNING['gk_dive_speed'] * TICK, TUNING['gk_dive_speed'] * TICK)
                p.vx, p.vy = 0.0, step / TICK
                p.y += step
                p.distance += abs(step)
                continue
            if dive and t > dive['until']:
                del self.gk_dive[p.idx]

            dx, dy = p.tx - p.x, p.ty - p.y
            ux, uy, d = unit(dx, dy)
            # Close enough to a positional target: stroll or stand rather than constantly adjusting.
            if p.urgency <= 1 and d < 2.0 and b.holder is not p:
                d = 0.0 if d < 1.0 else d
                p.urgency = 0
            vmax = min(p.vmax(), MAX_PLAYER_SPEED)
            if b.holder is p:
                vmax *= 0.62 + 0.25 * p.a('dribbling')
            if t < p.stunned_until:
                vmax *= 0.45
            mode = vmax if p.urgency >= 3 else min(vmax, SPEEDS[p.urgency])
            want = min(mode, math.sqrt(2 * 4.0 * max(0.0, d - 0.25)))
            dvx, dvy = ux * want - p.vx, uy * want - p.vy
            cur = math.hypot(p.vx, p.vy)
            limit = (p.accel if want >= cur else p.accel * 1.8) * TICK
            dv = math.hypot(dvx, dvy)
            if dv > limit:
                dvx, dvy = dvx / dv * limit, dvy / dv * limit
            p.vx += dvx
            p.vy += dvy
            sp = math.hypot(p.vx, p.vy)
            if sp > vmax:
                p.vx, p.vy = p.vx / sp * vmax, p.vy / sp * vmax
                sp = vmax
            p.x = clamp(p.x + p.vx * TICK, -4.0, PITCH_LENGTH + 4.0)
            p.y = clamp(p.y + p.vy * TICK, -4.0, PITCH_WIDTH + 4.0)
            p.distance += sp * TICK
            if sp > 0.6:
                p.fx, p.fy = p.vx / sp, p.vy / sp
            else:
                fx, fy, fd = unit(b.x - p.x, b.y - p.y)
                if fd > 0.5:
                    p.fx, p.fy = fx, fy
            r = sp / max(p.vmax_base, 1)
            p.energy -= TICK * (0.00003 + 0.00026 * r * r * r) * (1.35 - p.a('stamina'))
            if r < 0.25:
                p.energy += TICK * 0.00004
            p.energy = clamp(p.energy, 0.0, 1.0)

        # Keep players from standing inside each other.
        act = [p for p in self.players if not p.sent_off]
        for i in range(len(act)):
            a = act[i]
            for j in range(i + 1, len(act)):
                c = act[j]
                dx, dy = c.x - a.x, c.y - a.y
                d2 = dx * dx + dy * dy
                if d2 < 0.64 and d2 > 1e-9:
                    d = math.sqrt(d2)
                    push = (0.8 - d) * 0.25
                    a.x -= dx / d * push
                    a.y -= dy / d * push
                    c.x += dx / d * push
                    c.y += dy / d * push

    # ---------- output ----------

    def _record_frame(self, force=False):
        if not force and self.t + 1e-9 < self.next_frame:
            return
        b = self.ball
        row = [int(round(self.t * 10)), int(round(b.x * 10)), int(round(b.y * 10)), int(round(b.z * 10)),
               b.holder.idx if b.holder is not None else -1, 1 if (self.phase == 'play') else 0]
        for p in self.players:
            row.append(int(round(p.x * 10)))
            row.append(int(round(p.y * 10)))
        if self.frames and self.frames[-1][0] == row[0]:
            self.frames[-1] = row
        else:
            self.frames.append(row)
        if not force:
            self.next_frame += 1.0 / self.fps
