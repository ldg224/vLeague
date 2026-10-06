"""Ball physics and trajectory planning.

The same integrator moves the real ball and builds the lookup tables players use to plan
passes, so a perfectly struck pass arrives exactly where it was aimed; every miss comes
from the execution error added when the ball is kicked.
"""

import math
from functools import lru_cache

from .config import TICK

GRAVITY = 9.81
AIR_DRAG = 0.010        # deceleration = AIR_DRAG * v^2 (m/s^2)
ROLL_FRICTION = 1.5     # rolling resistance on grass (m/s^2)
ROLL_DRAG = 0.012       # extra speed-dependent resistance while rolling
BOUNCE_RESTITUTION = 0.5
BOUNCE_FRICTION = 0.75


def step(b, dt=TICK):
    """Advance a ball-like object (x, y, z, vx, vy, vz attributes) by dt."""
    if b.z > 0.01 or b.vz > 0.05:
        v = math.sqrt(b.vx * b.vx + b.vy * b.vy + b.vz * b.vz)
        k = AIR_DRAG * v * dt
        b.vx -= b.vx * k
        b.vy -= b.vy * k
        b.vz -= b.vz * k + GRAVITY * dt
        b.x += b.vx * dt
        b.y += b.vy * dt
        b.z += b.vz * dt
        if b.z <= 0.0:
            b.z = 0.0
            if b.vz < -1.2:
                b.vz = -b.vz * BOUNCE_RESTITUTION
                b.vx *= BOUNCE_FRICTION
                b.vy *= BOUNCE_FRICTION
            else:
                b.vz = 0.0
    else:
        b.z = 0.0
        b.vz = 0.0
        v = math.hypot(b.vx, b.vy)
        if v < 0.08:
            b.vx = b.vy = 0.0
            return
        dec = (ROLL_FRICTION + ROLL_DRAG * v * v) * dt
        f = max(0.0, v - dec) / v
        b.vx *= f
        b.vy *= f
        b.x += b.vx * dt
        b.y += b.vy * dt


class _P:
    __slots__ = ('x', 'y', 'z', 'vx', 'vy', 'vz')

    def __init__(self, x, y, z, vx, vy, vz):
        self.x, self.y, self.z, self.vx, self.vy, self.vz = x, y, z, vx, vy, vz


def predict(x, y, z, vx, vy, vz, seconds, every=0.2):
    """Future ball positions [(t, x, y, z, speed)] sampled every `every` seconds."""
    p = _P(x, y, z, vx, vy, vz)
    out = []
    steps_per = max(1, round(every / TICK))
    n = int(seconds / TICK)
    for i in range(1, n + 1):
        step(p)
        if i % steps_per == 0:
            out.append((i * TICK, p.x, p.y, p.z, math.sqrt(p.vx * p.vx + p.vy * p.vy + p.vz * p.vz)))
            if p.vx == 0 and p.vy == 0 and p.z == 0:
                break
    return out


# ---------- Ground passes ----------

@lru_cache(maxsize=None)
def _roll_profile(v0_key):
    """(distances, speeds) per tick for a ball rolled at v0 = v0_key / 4 m/s."""
    p = _P(0.0, 0.0, 0.0, v0_key / 4.0, 0.0, 0.0)
    dists, speeds = [0.0], [p.vx]
    while p.vx > 0.1 and len(dists) < 600:
        step(p)
        dists.append(p.x)
        speeds.append(p.vx)
    return tuple(dists), tuple(speeds)


def ground_speed_for(distance, arrival_speed, max_speed=34.0):
    """Initial speed so a rolled ball is still moving at `arrival_speed` after `distance` metres."""
    lo, hi = 4, int(max_speed * 4)
    if _dist_at_speed(hi, arrival_speed) < distance:
        return None
    while lo < hi:
        mid = (lo + hi) // 2
        if _dist_at_speed(mid, arrival_speed) >= distance:
            hi = mid
        else:
            lo = mid + 1
    return lo / 4.0


def _dist_at_speed(v0_key, speed):
    dists, speeds = _roll_profile(v0_key)
    for d, s in zip(dists, speeds):
        if s <= speed:
            return d
    return dists[-1]


def ground_time_to(v0, distance):
    """Seconds for a ball rolled at v0 to cover `distance` (inf if it stops first)."""
    dists, _ = _roll_profile(max(4, int(round(v0 * 4))))
    if distance > dists[-1]:
        return math.inf
    for i, d in enumerate(dists):
        if d >= distance:
            prev = dists[i - 1] if i else 0.0
            frac = (distance - prev) / (d - prev) if d > prev else 0.0
            return (i - 1 + frac) * TICK if i else 0.0
    return math.inf


# ---------- Lofted balls ----------

@lru_cache(maxsize=None)
def _loft_profile(v0_key, angle_deg, z0_key):
    """(distances, heights, times) until first bounce, for speed v0_key/4 at angle, launched from z0_key/10 m."""
    a = math.radians(angle_deg)
    v0 = v0_key / 4.0
    p = _P(0.0, 0.0, z0_key / 10.0, v0 * math.cos(a), 0.0, v0 * math.sin(a))
    dists, heights = [0.0], [p.z]
    while len(dists) < 400:
        step(p)
        dists.append(p.x)
        heights.append(p.z)
        if p.z <= 0.0:
            break
    return tuple(dists), tuple(heights)


def loft_speed_for(distance, angle_deg, z0=0.0, max_speed=34.0):
    """Initial speed so a ball launched at angle lands (first bounce) `distance` metres away."""
    zk = int(round(z0 * 10))
    lo, hi = 8, int(max_speed * 4)
    if _loft_profile(hi, angle_deg, zk)[0][-1] < distance:
        return None
    while lo < hi:
        mid = (lo + hi) // 2
        if _loft_profile(mid, angle_deg, zk)[0][-1] >= distance:
            hi = mid
        else:
            lo = mid + 1
    return lo / 4.0


def loft_path(v0, angle_deg, z0=0.0):
    """[(t, distance, height)] per tick until the first bounce."""
    dists, heights = _loft_profile(max(8, int(round(v0 * 4))), angle_deg, int(round(z0 * 10)))
    return [(i * TICK, d, h) for i, (d, h) in enumerate(zip(dists, heights))]


def launch_velocity(dx, dy, speed, angle_deg):
    """Velocity vector for a kick toward (dx, dy) at `speed` and elevation angle."""
    d = math.hypot(dx, dy) or 1.0
    a = math.radians(angle_deg)
    h = speed * math.cos(a)
    return dx / d * h, dy / d * h, speed * math.sin(a)
