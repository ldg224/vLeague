# Calibration

`python -m hcl_sim calibrate --matches 44` simulates a batch of matches between the league's
teams and compares the averages with typical top-flight 11-a-side figures. It is a
realism check, not a target every match must hit; individual matches vary a lot, like
real ones.

## Latest run (engine 0.1.0, 44 matches, all passed validation)

Per team per match unless noted.

| Statistic | Simulator | Real range | |
|---|---|---|---|
| Goals per match (both teams) | 3.16 | 2.2 - 3.3 | ok |
| Shots | 11.5 | 9 - 16 | ok |
| Shots on target | 5.5 | 3 - 6.5 | ok |
| Conversion % | 13.7 | 8 - 14 | ok |
| xG | 1.56 | 1.0 - 1.8 | ok |
| Passes | 398 | 300 - 600 | ok |
| Pass accuracy % | 72.6 | 72 - 88 | ok |
| Tackles | 24.0 | 12 - 24 | ok (upper edge) |
| Fouls | 9.9 | 8 - 14 | ok |
| Yellow cards | 2.1 | 1.0 - 2.5 | ok |
| Saves | 4.1 | 2 - 4.5 | ok |
| Ball in play (minutes per match) | 63.0 | 55 - 64 * | ok |
| Distance per outfield player (km) | 10.9 | 9 - 12 | ok |
| Offsides | 5.0 | 1 - 3 | high |
| Corners | 2.2 | 3.5 - 7 | low |
| Interceptions | 27 | 6 - 16 ** | high |

\* Real matches lose several minutes to substitutions and injuries; HCL has no
substitutes, so the target is a little higher than the real-world 52-62.

\** The simulator counts every time an opponent takes control of a moving pass. Data
providers count only clear "reads" of a pass, so this will always read higher.

Scorelines were varied and realistic (most common: 2-1, 0-1, 2-0, 1-1, 4-0, 0-0), and team
strength followed the player ratings (SKS and FC Turtle strongest; Lads United, who have
only 10 players on the roster, weakest).

## Engine 0.2.0: less waiting, no 20-second dribbles (vLeague 0.37)

Same four seeded matches (seeds 1 to 4, random 4 to 8 ratings), before and after. "Held" is one player's unbroken time on the ball.

| Measure (per match) | 0.1.0 | 0.2.0 |
|---|---|---|
| Ball in play | 61% | 74% |
| Average stoppage (ball dead) | 22 s | 12 s |
| Longest time one player kept the ball | 16 s | 9 s |
| Spells of more than 8 s on the ball | 27.5 | 2.5 |
| Offsides called | 9 | 5 |
| Passes | 677 | 960 |
| Shots | 23 | 27 |
| Tackles | 48 | 45 |

What changed:

* **Restarts are quicker.** Throw-ins 4 to 9 s (was 8 to 17), goal kicks 8 to 16 (14 to 28), corners 14 to 24 (24 to 40), free kicks 12 to 26 (18 to 40),
  offside free kicks 8 to 15 (12 to 24), penalties 30 to 50 (60 to 100), the kick-off after a goal 35 to 55 (50 to 80), and the wait for players to get into
  position is capped at 8 s (12). Real matches have the ball in play about 60 to 65% of the time; this is a little busier on purpose, so a watched or live
  match has fewer dull stretches.
* **Time on the ball counts.** After 2 s with the ball, holding it or dribbling loses a little utility every extra second (`carry_free_seconds`,
  `carry_urgency`), so a carrier looks for a pass or a shot instead of walking the ball around for 20 seconds.
* **Offsides.** A passer who sees his receiver is already offside as he is about to strike the ball holds it and looks again (vision decides how often he
  notices), and the players who misjudge the line do so less. Most offside calls were the intended receiver of a long or through ball.
* **Tackles** are attempted a little less often (0.09 to 0.075 a second in range) so the busier match doesn't pile up tackles.

All matches still pass the validator (no teleporting, speeds and ball speed within limits).

## Known gaps / next tuning targets

* **Offsides a little high, corners a little low.** Both are tuned by players' timing and
  by how deflections and clearances behave near the goal line.
* **Star players dominate shooting.** The best forward can take a large share of a
  team's shots; real teams spread chances more.

## Knobs

All tuning values are in `hcl_sim/config.py` (`TUNING`) with comments. The main ones:

| Knob | Affects |
|---|---|
| `pass_error_*`, `loft_error` | pass accuracy |
| `shot_error_*`, `gk_save_base`, `gk_reaction` | shots on target, conversion, saves |
| `shot_appetite` | how often players shoot |
| `decision_temperature*` | how often players make the "wrong" choice |
| `tackle_rate`, `tackle_base_success`, `foul_base`, `yellow_on_foul` | duels, fouls, cards |
| `first_touch_base` | how often players control the ball cleanly |
