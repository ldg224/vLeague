"""Builds engine teams from the league data (see js/simulate.js toLeague, or season.py)."""

from . import ratings, tactics
from .models import Player, Team

# Skill attributes scaled by a team's per-match form (the press effect, docs/PRESS_EFFECT.md in the site).
# Physical ones (pace, acceleration, stamina, strength, agility, aggression) are left alone so
# movement physics stays realistic; kicking (goalkeeper distribution) is also left alone.
FORM_ATTRS = ('composure', 'decisions', 'passing', 'first_touch', 'finishing', 'long_shots', 'tackling',
              'marking', 'positioning', 'work_rate', 'crossing', 'dribbling', 'vision', 'heading',
              'reflexes', 'handling', 'gk_positioning', 'diving')
FORM_CAP = 0.03   # form is clamped to +/- 3% (docs/PRESS_EFFECT.md)


def _form(value):
    """The tactics 'form' value as a clamped fraction (0 when missing or not a number)."""
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value != value:
        return 0.0
    return max(-FORM_CAP, min(FORM_CAP, float(value)))


def apply_form(players, form):
    """Scales each player's FORM_ATTRS by (1 + form), clamped to 1..99 and rounded to 0.1 like ratings.derive. Does nothing when form is 0."""
    if not form:
        return
    for p in players:
        for k in FORM_ATTRS:
            if k in p.attrs:
                p.attrs[k] = round(max(1.0, min(99.0, p.attrs[k] * (1 + form))), 1)


def build_team(league, code):
    info = league['teams'][code]
    tac = dict(league['tactics'].get(code, {}))
    form = _form(tac.pop('form', 0))
    formation = tac.pop('formation', None) or '4-3-3'
    if formation not in tactics.FORMATIONS:
        print(f'warning: unknown formation {formation!r} for {code}, using 4-3-3')
        formation = '4-3-3'
    squad = [p for p in league['players'].values() if p['team'] == code]
    if len(squad) < 7:
        raise ValueError(f'{code} has only {len(squad)} players on the roster (need at least 7)')

    players = []
    for sp in squad:
        attrs = ratings.derive(sp, league['attributes'].get(sp['id']))
        players.append(Player(id=sp['id'], name=sp['name'], team=code, position=sp['position'] or 'MID', attrs=attrs))

    # Make sure somebody is in goal.
    if not any(p.position == 'GK' for p in players):
        worst = min(players, key=lambda p: p.attrs['finishing'] + p.attrs['passing'])
        worst.position = 'GK'
        print(f'warning: {code} has no goalkeeper; {worst.name} goes in goal')

    # Optional manager choices: XI by slot, set-piece takers and captain (player ids).
    chosen = tac.pop('lineup', None) or {}
    takers = {kind: str(tac.pop(key)) for kind, key in (('penalty', 'penalties'), ('free_kick', 'freekicks'), ('corner', 'corners')) if tac.get(key)}
    captain = str(tac.pop('captain', '') or '')
    lineup = tactics.assign_lineup(players, formation, chosen if isinstance(chosen, dict) else None)
    starters = []
    for p, slot in lineup:
        p.slot = slot
        p.line = tactics.FORMATIONS[formation][slot][0]
        starters.append(p)
    apply_form(starters, form)   # after picking the XI, so form never changes who plays
    tac_clean = {k: v / 100 if v > 1 else v for k, v in tac.items() if isinstance(v, (int, float))}
    return Team(code=code, name=info['name'], colour=info['colour'], players=starters, formation=formation, tactics=tac_clean,
                takers=takers, form=form, captain=captain if any(str(p.id) == captain for p in starters) else '')


def resolve_team(league, value):
    """Accepts a team code or full name."""
    v = (value or '').strip()
    if v.upper() in league['teams']:
        return v.upper()
    for code, t in league['teams'].items():
        if t['name'].upper() == v.upper():
            return code
    raise KeyError(f'Unknown team: {value}')
