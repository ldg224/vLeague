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
    'shot_appetite': 0.68,
    'long_shot_min_xg': 0.03,     # S-40: below this xG a shot from beyond 20 m is not considered (it was 0.03)
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
    'tackle_base_success': 0.42,
    'foul_base': 0.10,
    'yellow_on_foul': 0.16,
    'second_yellow_factor': 0.35,  # a booked player: a referee thinks twice before a second yellow (B-31)
    'booked_foul_factor': 0.6,     # and he goes in less hard, so he fouls less

    # Goalkeeping
    'gk_reaction': 0.30,          # seconds for a 100-rated keeper; up to +0.15 for poor ones
    'gk_save_base': 3.7,
    'gk_dive_speed': 4.8,         # m/s along the line once he has left his feet
    'gk_high_delay': 0.12,        # extra seconds before he moves for a ball going into the top corner (it takes a keeper about a second to get there)
    'gk_read_error': 0.30,        # metres, 1 sd, in where he reads a shot will cross the line (more for a poorer positioner and a harder-hit shot)
    'gk_reach_stand': 1.0,        # metres from his body he can get a hand to without moving: about half an arm span
    'gk_reach_dive': 1.9,         # and at full stretch

    # Control
    'first_touch_base': 3.8,
    'mood_from_min': 55,         # 0.4.0: from this minute the score starts to lean on a team's settings (Match._update_mood), fully by 90
    'mood_protect': 0.6,         # a team ahead leans this much (as a fraction of a full -1) toward protecting the lead
    'chase_shot': 0.5,           # shot appetite added at full chasing mood (x1.5)
}
