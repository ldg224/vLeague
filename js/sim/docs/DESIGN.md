# How the simulator works

## The problem it solves

A match replay looks fake the moment the ball does something physically impossible:
a pass goes from A to B, then C suddenly has it on the other side of the pitch. That
happens when a simulator *decides outcomes first* ("the pass succeeds", "C wins the ball")
and then writes coordinates to match. The positions and the story drift apart.

This engine works the other way round. **There is one physical world, and every outcome
is something that happens in it.** Possession can only change when a player physically
reaches the ball. A misplaced pass is an inaccurate kick that really lands somewhere
else. An interception is a defender who really got to the ball's path first.

## The world

* **Clock:** the match advances in 0.1 s ticks: about 58,000 per match.
* **Pitch:** 105 x 68 m, origin top-left, x to the right, y down, z up.
* **Players** have position, velocity, facing and energy. They accelerate toward a target
  with limited acceleration (2.6-5.0 m/s^2) and top speed (6.6-9.4 m/s from pace, reduced
  by fatigue). Nobody can teleport; the validator checks this on every frame.
* **The ball** has a 3D position and velocity. It rolls with friction, flies with gravity
  and air drag, and bounces. The same integrator is used to *plan* kicks, so a perfectly
  struck pass arrives exactly where it was aimed.

The ball is always in exactly one state:

| State | Meaning | Leaves the state when |
|---|---|---|
| Held | at the holder's feet (or in a keeper's/thrower's hands) | the holder kicks it, or loses it in a tackle |
| Free | moving under physics | a player reaches it (control, deflection, header, save) or it crosses a line |
| Dead | out of play | the restart is taken |

Every change of holder writes a `control` event saying how (`reception`, `interception`,
`recovery`, `tackle`, `catch`, `restart`).

## Decisions: the player on the ball

Several times a second, the player on the ball scores every option:

* a pass to each teammate, along the ground or in the air (and through balls into a
  runner's path, and over the top)
* dribbling in five directions
* shooting, crossing, clearing, or holding the ball

Each option's score is

    P(success) x value(if it works)  -  P(failure) x danger(if it fails)

**Value** comes from a threat model of the pitch: how likely possession at that spot
leads to a goal. **P(success)** for a pass asks, for points along the ball's path: can any
defender get there before the ball *and* before the receiver? It accounts for players'
momentum, the passer's accuracy and pressure, and the receiver's first touch. Passers also
check whether the receiver will be offside when the ball is struck.

The option is chosen with a softmax: good decision-makers usually pick the best one;
poor ones, especially under pressure with low composure, pick worse ones more often.

## Human error

Error comes from *execution*, not from dice rolls on outcomes:

| Error | Depends on |
|---|---|
| Pass direction and power | passing, pressure, distance |
| Lofted ball landing spot | passing/crossing, distance, pressure |
| Shot direction and height | finishing (heading for headers), pressure, distance |
| First touch (control or spill) | first touch, ball speed, height, pressure, a challenging opponent |
| Keeper: reading the shot, reaction time, save, catch or parry | reflexes, positioning, diving, handling |
| Offside-line judgement | positioning (players sometimes drift offside) |
| Decision quality | decisions, composure, pressure |
| Tiredness | stamina; slows players late in the game |

The result of an error then plays out physically: a heavy touch rolls loose and players
chase it, a mis-hit pass lands in space or out of play, a parried shot drops for a
rebound or goes behind for a corner.

## Off the ball

Positioning is where a lot of simulators look robotic. Here, every player off the ball
has a job, re-evaluated about three times a second (after a realistic reaction delay when
possession changes):

* **Team shape:** the formation slots shift with the ball. In possession the team spreads
  wide and pushes up; out of possession it compresses toward the ball side, and the back
  line sits deeper (about 13 m from goal with the ball 25 m out, about 40 m with it at halfway).
* **Pressing:** the nearest defender (by time) closes the ball down; a second one covers the
  nearest pass when the ball is near goal or the team presses high.
* **Marking:** defenders and midfielders pick up the most dangerous nearby opponent and
  stay goal-side.
* **Support:** attackers near the ball move into open space with a clear passing lane.
* **Runs:** forwards and wide players time runs in behind the defensive line.
* **Goalkeeper:** positions on the line between ball and goal, coming off the line to
  narrow the angle; claims loose balls and crosses in the box.
* **Chasing:** when the ball is free, the players who can reach it first go for it; players
  let a ball roll out when the restart would be theirs anyway.

## Duels, fouls and set pieces

* **Tackles:** defenders mostly jockey and commit now and then. Success depends on tackling
  vs dribbling/strength/agility; tackles from behind succeed less and are fouls more often.
* **Fouls:** from tackles, from a beaten defender tripping an attacker, and from pushes in
  aerial duels. Cards depend on aggression, tackles from behind, and denying an obvious
  goal-scoring opportunity (a straight red). Second yellows send players off, and
  a sent-off keeper is replaced by a defender (the league has no substitutes).
* **Aerial duels:** heading, strength and agility decide who wins the header; attackers
  head at goal, defenders clear (sometimes behind for a corner).
* **Restarts:** throw-ins, goal kicks, corners, free kicks (with a wall when in range),
  penalties and kick-offs. Players walk to set-piece positions, opponents keep 9.15 m, and
  restarts take realistic amounts of time. The ball stays where play stopped (in the net
  during a goal celebration) and is placed when the restart is taken.
* **Offside** is judged when the ball is played, and called when an offside player becomes
  involved. Throw-ins, goal kicks and corners are exempt.

## Ratings

Players are rated offense/defense 1-10 in `data/season.json`. The engine needs more detail, so each player
gets 25 attributes (1-100): pace, acceleration, stamina, strength, agility, passing, vision,
first touch, dribbling, crossing, finishing, long shots, heading, tackling, marking,
positioning, composure, decisions, work rate, aggression, and for keepers reflexes,
handling, positioning, diving and kicking.

Attributes are derived from the two ratings and position, with a small fixed
variation per player so they have character. Any attribute can be overridden through
the league's `attributes` map (player id -> {attribute: value}); nothing fills it yet. The 1-10 scale
is deliberately compressed (1 -> 45, 10 -> 90): small attribute gaps compound over hundreds of
actions, and a wider scale made strong teams unrealistically dominant.

## Randomness and reproducibility

All randomness comes from one seeded generator. The same teams, ratings and seed always
produce the identical match, frame for frame. `week` derives each fixture's seed from the
week, teams and date, so re-running a week reproduces it.

## Performance

About 25-35 s per match on one core; `calibrate` runs matches in parallel.
