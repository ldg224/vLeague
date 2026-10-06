"""Small 2D geometry helpers (plain floats; no numpy dependency)."""

import math


def dist(ax, ay, bx, by):
    return math.hypot(bx - ax, by - ay)


def clamp(v, lo, hi):
    return lo if v < lo else hi if v > hi else v


def unit(dx, dy):
    """Returns (ux, uy, length). A zero vector gives (0, 0, 0)."""
    d = math.hypot(dx, dy)
    if d < 1e-9:
        return 0.0, 0.0, 0.0
    return dx / d, dy / d, d


def rotate(dx, dy, angle):
    c, s = math.cos(angle), math.sin(angle)
    return dx * c - dy * s, dx * s + dy * c


def seg_point_dist(ax, ay, bx, by, px, py):
    """Distance from point P to segment AB, and the parameter t (0..1) of the closest point."""
    abx, aby = bx - ax, by - ay
    denom = abx * abx + aby * aby
    if denom < 1e-12:
        return math.hypot(px - ax, py - ay), 0.0
    t = clamp(((px - ax) * abx + (py - ay) * aby) / denom, 0.0, 1.0)
    cx, cy = ax + abx * t, ay + aby * t
    return math.hypot(px - cx, py - cy), t


def sigmoid(x):
    if x < -30:
        return 0.0
    if x > 30:
        return 1.0
    return 1.0 / (1.0 + math.exp(-x))


def lerp(a, b, t):
    return a + (b - a) * t
