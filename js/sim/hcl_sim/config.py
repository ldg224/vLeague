"""Pitch geometry, engine constants and tuning knobs.

Coordinates are metres. Origin is the top-left corner of the pitch as drawn on a screen:
x runs 0 -> 105 left to right, y runs 0 -> 68 top to bottom, z is height above the grass.
"""

PITCH_LENGTH = 105.0
PITCH_WIDTH = 68.0
CENTRE = (PITCH_LENGTH / 2, PITCH_WIDTH / 2)

GOAL_WIDTH = 7.32
GOAL_HEIGHT = 2.44
GOAL_Y1 = (PITCH_WIDTH - GOAL_WIDTH) / 2
GOAL_Y2 = (PITCH_WIDTH + GOAL_WIDTH) / 2
POST_RADIUS = 0.06

BOX_DEPTH = 16.5
BOX_Y1 = (PITCH_WIDTH - 40.32) / 2
BOX_Y2 = (PITCH_WIDTH + 40.32) / 2
SIX_DEPTH = 5.5
SIX_Y1 = (PITCH_WIDTH - 18.32) / 2
SIX_Y2 = (PITCH_WIDTH + 18.32) / 2
PENALTY_SPOT = 11.0
CENTRE_CIRCLE = 9.15

TICK = 0.1                 # simulation step, seconds
HALF_SECONDS = 45 * 60
DEFAULT_FPS = 5            # frames written to the output file per second

# Physical limits, used by the engine and checked by the validator.
MAX_PLAYER_SPEED = 10.5    # m/s, a little above the fastest real sprints
MAX_BALL_SPEED = 42.0      # m/s, hardest real shots are ~35
CONTROL_DISTANCE = 1.5     # a held ball is never further than this from its holder


# Tuning knobs. Each is a real-world quantity or a weight; `calibrate` reports how the
# resulting match statistics compare with real football so these can be adjusted.
TUNING = {
    # S-40 round 2: tactics that reach the pitch (25 Nov 2026). Pressing sets how far up the pitch the nearest man closes the carrier down
    # (carrier's x in our attacking coords below press_zone_lo + (hi - lo) * pressing; beyond it he holds his place in the shape), and when a
    # second man joins in. Tempo scales how long a player takes on the ball; directness weights forward passes up and square/back ones down;
    # width spreads the shape. A setting of 0.5 plays as before for tempo and width.
    'press_zone_lo': 45.0,
    'press_zone_hi': 112.0,
    'press_second': 0.6,
    'tempo_time': 0.5,            # time on the ball x (1 + tempo_time * (0.5 - tempo))
    'tempo_hold': 0.012,          # holding the ball, utility per step of tempo above 0.5
    'direct_gain': 0.35,          # forward pass value x (1 +- direct_gain) for a 30 m forward / backward pass at directness 1 (and the reverse at 0)
    'width_in_lo': 0.875, 'width_in_span': 0.3,   # in possession: lateral spread 0.875 (narrow) to 1.175 (wide), 1.025 at 0.5 as before
    'width_out_lo': 0.55, 'width_out_span': 0.14, # out of possession: 0.55 to 0.69, 0.62 at 0.5 as before
    # Passing execution error (degrees of direction error, 1 standard deviation)
    'pass_error_base': 1.4,
    'pass_error_skill': 5.5,      # added for a 0-rated passer, scaled down by skill
    'pass_error_pressure': 3.5,   # added at full pressure
    'pass_power_error': 0.07,     # fraction of intended speed, 1 sd, for a 50-rated passer
    'loft_error': 0.11,           # landing error as a fraction of distance, 1 sd

    # Shooting execution error (degrees, 1 sd)
    'shot_error_base': 6.0,    # S-40 step 2c: was 5.5
    'shot_error_skill': 12.0,
    'shot_error_pressure': 7.0,
    'header_error_extra': 4.0,
    'shot_error_height': 0.3,     # vertical error of a shot, as a fraction of its sideways error (it was 0.7, which kept most shots on the ground or over the bar)
    'shot_error_height_long': 0.5, # added to that fraction for a long shot (ramps in from 12 m to full at 32 m): long shots balloon over the bar far more often than close ones
    'shot_high_base': 0.10,       # chance a footed shot is aimed high (top corner), for a 0-rated shooter
    'shot_high_skill': 0.30,      # added for a 100-rated finisher / long-shot taker
    'shot_high_error': 1.1,       # multiplier on the sideways (and vertical) error of a shot aimed at the top corner
    'shot_mid_share': 0.45,       # of the rest, the share driven at keeper height rather than along the ground

    # Time on the ball: after this many seconds a carrier starts to feel the need to release it, and holding or dribbling
    # scores lower by this much per extra second (threat values run 0.01 to 0.3).
    'carry_free_seconds': 2.0,
    'carry_urgency': 0.006,

    # Decisions
    'decision_temperature': 0.006,   # softmax temperature for a 100-rated decision maker
    'decision_temperature_poor': 0.020,
    'risk_aversion': 1.0,
    'choose_by_kind': True,          # B-45: pick what to do (best of each kind), then which; False = one softmax over every option (engine 0.3.2)
    'choose_by_kind_from': 60.0,     # only with the ball this far up (metres from his own goal line): the attacking half, where the back passes were
    'carry_penalty': 0.0,            # taken off holding and dribbling (tried in tuning B-45; 0 keeps them as in 0.3.2)
    'shot_appetite': 0.60,
    # S-40: more shots, from closer. Shots within shot_close_range metres get shot_close_appetite times the appetite; beyond
    # shot_tight_free metres no shot is taken when the goal mouth looks narrower than shot_min_angle radians (by the corner flag,
    # along the byline); and from beyond 20 m a shot needs at least shot_min_xg_far.
    'shot_close_range': 18.0,
    'shot_close_appetite': 2.1,
    'shot_tight_free': 6.0,
    'shot_min_angle': 0.25,
    'shot_min_xg_far': 0.03,
    'threat_close': 0.40,         # S-40: how much the spots near goal are worth in the pitch value model (higher: teams work the ball into the box more)
    'long_shot_appetite': 0.68,   # appetite multiplier beyond 18 m is this + long_shot_skill x long shots (step 2 had 0.62 + 0.6 x; original 0.7 + 0.7 x)
    'long_shot_skill': 0.7,       # S-40: and this x long shots on top
    'carry_in_value': 0.6,        # B-45: a drive toward goal with nobody in the way is worth this share of the shot from the end of it
    'xg_clear_bonus': 0.85,       # B-45: xG logit added for a clean sight of goal (no blockers, no pressure), full at 12 m, none from 20 m
    'shot_calm_range': 18.0,      # B-45: metres from goal within which an unpressured shot counts as calm (step 2: 16)
    'shot_calm_inset': 0.45,      # B-45: metres further inside the post a calm finisher aims (safer placement)
    'shot_clear_calm': 0.45,      # B-45: shot error cut for an unhurried shot close in (no pressure, under 16 m)
    # B-21: free kicks. Within the range the taker's shot utility is multiplied and given a bonus, so a free kick in range is usually a shot; below the xG floor it is not offered.
    'free_kick_shoot_range': 30.0,
    'free_kick_appetite': 3.0,
    'free_kick_bonus': 0.02,
    'free_kick_min_xg': 0.02,

    # Defending runs in behind (B-45)
    'track_run_range': 18.0,      # metres from his own spot within which a defender picks up a runner
    'track_run_weight': 0.8,      # how fully he goes with the runner (scaled by marking, plus positioning)
    'def_danger_range': 28.0,     # B-45: a carrier this close to our goal is closed down from the goal side, and a second man drops into the shooting lane
    'def_close_goalside': 1.2,    # metres goal-side of the carrier the presser aims for
    'def_lane_depth': 3.5,        # metres goal-side of the carrier the second man takes up, in the lane to goal
    'def_compact_range': 42.0,    # B-45: ball this close to our goal (metres along the pitch): the back line narrows
    'def_compact': 0.4,           # B-45: share of the way each defender moves toward a narrow line (full at 15 m nearer than the range)
    'shot_block_turn': 25.0,      # degrees a blocked shot is at least turned off its line
    'shot_block_reach': 0.2,      # metres added to an outfield player's reach for a shot (a block is a lunge, not a controlled touch)

    # Duels
    'tackle_rate': 0.075,          # tackle attempts per second when in range
    # S-40 tackles/blocks (25 Nov 2026; was success 0.42, foul 0.10, behind 0.18, beaten foul 0.10, all lines 1.0, pass block 0.08):
    # about 65% of clean challenges now win the ball (real ~60-65%, was ~32%), defenders win the most tackles, fouls ~10 a team.
    'tackle_base_success': 0.66,
    'foul_base': 0.22,
    'tackle_skill_weight': 0.9,    # how much tackling v dribbling moves the win chance
    'tackle_behind_penalty': 0.12, # win chance lost tackling from behind
    'beaten_foul_base': 0.08,      # beaten: chance he brings the carrier down instead (plus 0.15 x aggression)
    'tackle_rate_def': 1.45,       # tackle attempt rate by line (defenders do most of the tackling in real games)
    'tackle_rate_mid': 0.75,
    'tackle_rate_fwd': 0.4,
    'pass_block_base': 0.05,       # a pass struck past a man next to the kicker: chance he blocks it (plus 0.15 x marking)
    'pass_block_fwd': 0.35,        # that chance for forwards and attacking mids (pressers rarely get a body in the way)
    'pass_block_mid': 0.5,         # and for midfielders
    'yellow_on_foul': 0.16,
    'second_yellow_factor': 0.35,  # a booked player: a referee thinks twice before a second yellow (B-31)
    'booked_foul_factor': 0.6,     # and he goes in less hard, so he fouls less

    # Goalkeeping
    'gk_reaction': 0.30,          # seconds for a 100-rated keeper; up to +0.15 for poor ones
    # S-40 (25 Nov 2026; was save 3.7, dive 4.8, read 0.30): real clubs scored ~4.4 a match, keepers conceded 46% of shots on target.
    'gk_save_base': 4.3,
    'gk_dive_speed': 5.25,        # m/s along the line once he has left his feet
    'gk_high_delay': 0.12,        # extra seconds before he moves for a ball going into the top corner (it takes a keeper about a second to get there)
    'gk_read_error': 0.22,        # metres, 1 sd, in where he reads a shot will cross the line (more for a poorer positioner and a harder-hit shot)
    'gk_reach_stand': 1.0,        # metres from his body he can get a hand to without moving: about half an arm span
    'gk_reach_dive': 1.9,         # and at full stretch

    # Ratings (ratings._scale): sheet rating -> attribute baseline
    'rating_slope': 5.0,          # attribute points per rating point (0.3.x: 5)
    'rating_centre': 7.0,         # the league's average rating; a player here gets rating_centre_value whatever the slope
    'rating_centre_value': 75.0,  # = 40 + 5 x 7, as before

    # Control
    'first_touch_base': 3.8,
    'mood_from_min': 50,         # 0.4.0: from this minute the score starts to lean on a team's settings (Match._update_mood), fully by 90
    'mood_protect': 0.6,         # a team ahead leans this much (as a fraction of a full -1) toward protecting the lead
    'chase_shot': 1.0,
    'cross_overshoot': 4.5,      # 0.4.0: metres past the target zone a cross comes down, so it is at head height there
    'clear_min_pressure': 0.35,  # 0.4.0: below this pressure a defender does not choose to clear
    'behind_block': 0.7,        # 0.4.0: chance a blocked cross or shot near the defender's own goal goes behind (Match._maybe_behind)
    'behind_miscue': 0.55,       # and a defender's mis-hit of a cross, corner or shot there
}
