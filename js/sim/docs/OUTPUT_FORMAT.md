# Match file format (`hcl-match`, version 1)

One JSON document per match, usually gzipped (`.json.gz`, about 2 MB). Everything a match
display needs: who played, what happened, the statistics, and where everyone was five
times a second.

## Coordinates

* Metres. Pitch 105 x 68. **Origin top-left** as drawn on screen: x 0->105 left to right,
  y 0->68 top to bottom, z is height (ball only).
* Teams swap ends at half-time. `periods[n].home_attacks` says which way the home team
  attacks (`"right"` = toward x = 105).
* Goals are centred on y = 34, 7.32 m wide (y 30.34-37.66), 2.44 m high.

## Top level

```jsonc
{
  "format": "hcl-match",
  "format_version": 1,
  "engine":  { "name": "hcl_sim", "version": "0.1.0", "seed": 42, "tick_seconds": 0.1, "generated_at": "..." },
  "pitch":   { "length": 105, "width": 68, "goal_width": 7.32, "goal_height": 2.44, "origin": "top-left", "units": "metres" },
  "match":   { "home": "TUR", "away": "SKS", "week": "1", "date": "15/9/2026", "time": "12:00 PM" },
  "teams":   { "home": Team, "away": Team },
  "players": [ Player, ... ],          // index = position in the frame arrays
  "periods": [ Period, Period ],
  "result":  { "home": 2, "away": 1, "goals": [ { "minute": "37", "team": "TUR", "scorer": "0002", "assist": "0000", "own_goal": false } ] },
  "stats":   { "teams": { "home": {...}, "away": {...} }, "players": { "<player id>": {...} }, "ball_in_play_minutes": 62.1 },
  "events":  [ Event, ... ],
  "frames":  Frames
}
```

### Team

```jsonc
{ "code": "TUR", "name": "FC Turtle", "colour": "#0cf6f3", "formation": "4-3-3", "tactics": {},
  "captain": "0001", "takers": { "penalty": "0010", "free_kick": "0009", "corner": "0007" },
  "lineup": [ { "idx": 0, "id": "0014", "name": "...", "position": "GK", "slot": "GK" }, ... ] }
```

Input: `league.tactics[code]` may hold `formation` (4-3-3, 4-4-2, 4-2-3-1, 3-5-2), the tactic
values `tempo`, `pressing`, `width`, `line_height`, `directness` (0..1, default 0.5), and the
manager's picks: `lineup` ({slot: player id}; empty or invalid slots are filled automatically),
`captain`, `penalties`, `freekicks`, `corners` (player ids). `captain` is `null` and `takers` is
`{}` when none were chosen.

It may also hold `form`, a per-match skill modifier as a fraction (the site's press effect, e.g.
`0.03` = +3%), clamped to ±0.05. It multiplies the starting XI's skill attributes (composure,
decisions, passing, first_touch, finishing, long_shots, tackling, marking, positioning, work_rate,
crossing, dribbling, vision, heading, reflexes, handling, gk_positioning, diving; not pace,
acceleration, stamina, strength, agility, aggression or kicking) by `1 + form`, clamped to 1..99,
after the XI is picked. The team block then carries `"form": 0.03` (the clamped value) next to
`takers`, and the players' `attributes` are the scaled match-day values. With no `form`, or 0, the
key is left out and the match is identical to one simulated without it (same seed).

### Player

```jsonc
{ "idx": 3, "id": "0001", "name": "Malakai Vance", "team": "TUR", "position": "DEF", "slot": "LCB",
  "attributes": { "pace": 71.2, "passing": 64.0, ... } }
```

`slot` is the formation position: GK, LB, LCB, RCB, RB, LCM, CDM, RCM, LW, ST, RW (4-3-3).

### Period

```jsonc
{ "period": 1, "start_t": 0.0, "end_t": 2893.4, "added_minutes": 3, "home_attacks": "right" }
```

`t` values are **seconds of simulated time since kick-off**, continuous across the match
(half-time is not included). Match clock = `t - start_t`, plus 45:00 in the second half.

## Frames

```jsonc
"frames": {
  "fps": 5,
  "scale": 10,
  "fields": ["t", "ball_x", "ball_y", "ball_z", "holder", "in_play", "p0_x", "p0_y", "p1_x", ...],
  "data": [ [0, 525, 340, 0, 9, 0, 45, 340, ...], ... ]
}
```

Each row is one moment. All numbers are integers **x `scale`** (divide by 10): `t` in
tenths of a second, positions in decimetres.

* `holder`: index of the player with the ball, or -1 when it's free or dead.
* `in_play`: 1 in play, 0 dead (between the ball going out and the restart). While
  dead, the ball may be moved to the restart spot, so hide or fade it.
* At the start of the second half players reset to kick-off positions; that is the only
  place positions jump.

To animate smoothly, interpolate between frames. Players never move more than about
2 m between frames (5 fps).

## Events

Every event has:

```jsonc
{ "id": 812, "t": 2192.9, "period": 1, "clock": "36:32", "minute": "37", "type": "shot",
  "team": "TUR", "player": "0002", "x": 87.1, "y": 30.2, "poss": 214, ... }
```

`minute` is the football minute ("37", "45+2", "90+4"). `poss` is a possession-chain id:
it increases every time possession changes team, so events with the same `poss` are one attack.

| type | extra fields | meaning |
|---|---|---|
| `period_start`, `period_end` | | kick-off of a half / final whistle of a half |
| `added_time` | `minutes` | added time shown |
| `control` | `how`: reception / interception / recovery / tackle / catch / restart | a player gains the ball; every change of holder has one |
| `pass` | `subtype` (short, long, through, cross, throw, goal_kick, corner, free_kick, kickoff, header, gk_throw, gk_kick), `end_x`, `end_y` (target), `height` (ground/high), `receiver_intended`, `outcome` (complete, intercepted, out, offside, end_of_period), `receiver` or `intercepted_by`, `expected_success` | a pass; `outcome` is filled in when it resolves |
| `clearance` | `subtype`, `end_x`, `end_y` | a clearance |
| `shot` | `xg`, `on_target`, `body` (foot/head), `subtype` (open, volley, header, free_kick, penalty), `speed`, `end_y`, `end_z` (where it would cross the goal line), `outcome` (goal, saved, blocked, off_target, woodwork) | a shot |
| `save` | `result`: caught / parried | keeper save |
| `block` | | a shot or pass blocked |
| `goal` | `scorer`, `assist`, `own_goal`, `score` [home, away], `shot` (event id) | a goal |
| `woodwork` | `part`: post / bar | hit the frame |
| `tackle` | `won`, `opponent`, `loose` | tackle attempt |
| `take_on` | `won`, `opponent` | beat a defender |
| `miscontrol`, `deflection` | | ball bounced off a player |
| `aerial_duel` | `won`, `opponent` | header contest |
| `foul` | `on` (fouled player id) | foul |
| `card` | `card`: yellow / second_yellow / red | card |
| `position_change` | `new_slot`, `old_slot` | e.g. an outfield player going in goal |
| `offside` | | offside called against `player` |
| `out` | `last_touch` | ball out of play at `x`, `y` |
| `throw_in`, `corner`, `goal_kick`, `free_kick`, `penalty`, `kickoff` | | restart taken by `player` at `x`, `y` |

## Statistics

`stats.teams.home` / `away`: goals, xg, possession (%), shots, shots_on_target,
big_chances, passes, passes_completed, pass_accuracy, crosses, tackles, tackles_won,
interceptions, clearances, blocks, saves, fouls, yellow_cards, red_cards, corners,
offsides, distance_km.

`stats.players[id]`: minutes, goals, own_goals, assists, shots, shots_on_target, xg,
passes, passes_completed, key_passes, crosses, touches, take_ons, tackles, tackles_won,
interceptions, clearances, blocks, aerials_won, fouls, fouled, yellow, red, offsides,
miscontrols, saves, goals_conceded, distance_km, rating (FotMob-style 3.0-9.9; diminishing returns above 7).
