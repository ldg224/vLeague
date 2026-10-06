"""Player attribute model.

The league currently rates players with two numbers (offense and defense, 1-10). The engine
needs more detail, so each player gets a full attribute profile on a 1-100 scale:

* If the Attributes tab has a value for an attribute, it is used as-is.
* Otherwise it is derived from offense/defense and position, plus a small fixed variation
  per player (seeded by player ID, so it is the same every run) to give players character.

`python -m hcl_sim ratings-template` writes every player's full profile to a CSV that can be
pasted into an Attributes tab and then revised by hand.
"""

import hashlib

OUTFIELD = [
    # name, offense weight, defense weight, bonus by position {pos: +n}
    ('pace', 0.45, 0.25, {'FWD': 6, 'DEF': 0, 'MID': 2}),
    ('acceleration', 0.45, 0.2, {'FWD': 6, 'MID': 3}),
    ('stamina', 0.3, 0.3, {'MID': 10, 'DEF': 4}),
    ('strength', 0.15, 0.55, {'DEF': 6, 'FWD': 2}),
    ('agility', 0.55, 0.15, {'FWD': 5, 'MID': 3}),
    ('passing', 0.6, 0.2, {'MID': 8}),
    ('vision', 0.7, 0.1, {'MID': 8, 'FWD': 2}),
    ('first_touch', 0.7, 0.15, {'MID': 4, 'FWD': 4}),
    ('dribbling', 0.85, 0.0, {'FWD': 6, 'MID': 3}),
    ('crossing', 0.65, 0.1, {'DEF': 3, 'FWD': 3}),
    ('finishing', 0.95, 0.0, {'FWD': 8, 'DEF': -8}),
    ('long_shots', 0.8, 0.0, {'MID': 6, 'DEF': -6}),
    ('heading', 0.3, 0.45, {'DEF': 6, 'FWD': 4}),
    ('tackling', 0.0, 0.95, {'DEF': 6, 'FWD': -10}),
    ('marking', 0.0, 0.95, {'DEF': 6, 'FWD': -10}),
    ('positioning', 0.8, 0.1, {'FWD': 6}),        # attacking movement, staying onside
    ('composure', 0.5, 0.35, {}),
    ('decisions', 0.45, 0.45, {'MID': 4}),
    ('work_rate', 0.3, 0.45, {'MID': 8}),
    ('aggression', 0.1, 0.55, {'DEF': 6}),
]

GOALKEEPING = [
    ('reflexes', 0.0, 1.0, {}),
    ('handling', 0.0, 0.95, {}),
    ('gk_positioning', 0.0, 0.95, {}),
    ('diving', 0.0, 0.95, {}),
    ('kicking', 0.4, 0.4, {}),
]

ATTRIBUTES = [a[0] for a in OUTFIELD] + [a[0] for a in GOALKEEPING]


def _variation(player_id, attr, spread):
    """Stable pseudo-random offset in [-spread, +spread] for this player and attribute."""
    h = hashlib.sha256(f'{player_id}:{attr}'.encode()).digest()
    return (h[0] / 255 * 2 - 1) * spread


def _scale(rating):
    """Sheet rating 1-10 -> 1-100 attribute baseline (1 -> 45, 5 -> 65, 10 -> 90).

    Deliberately compressed: small attribute gaps compound over hundreds of actions per
    match, so a wider scale makes strong teams unrealistically dominant."""
    return 40 + 5 * (rating if rating is not None else 5)


def derive(player, overrides=None):
    """Full attribute dict (1-100) for a league player."""
    pos = player.get('position') or 'MID'
    off = _scale(player.get('offense'))
    dfn = _scale(player.get('defense'))
    attrs = {}

    table = OUTFIELD + GOALKEEPING
    for name, wo, wd, bonus in table:
        is_gk_attr = (name, wo, wd, bonus) in GOALKEEPING
        if pos == 'GK':
            if is_gk_attr:
                base = off * wo + dfn * wd + 50 * (1 - wo - wd) if wo + wd < 1 else (off * wo + dfn * wd) / (wo + wd)
            else:
                # Keepers are poor outfield players, except for composure/decisions/passing basics.
                base = 25 + 0.25 * dfn if name not in ('composure', 'decisions', 'passing', 'strength') else 0.6 * dfn + 10
        else:
            if is_gk_attr:
                base = 12
            else:
                w = wo + wd
                base = off * wo + dfn * wd + 50 * (1 - w) if w < 1 else (off * wo + dfn * wd) / w
                base += bonus.get(pos, 0)
        spread = 4 if name != 'aggression' else 12
        attrs[name] = base + _variation(player['id'], name, spread)

    for k, v in (overrides or {}).items():
        if k in attrs and v is not None:
            attrs[k] = float(v)

    return {k: round(max(1.0, min(99.0, v)), 1) for k, v in attrs.items()}
