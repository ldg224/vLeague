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
    'shot_error_base': 5.5,
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
    # B-21: free kicks. Within the range the taker's shot utility is multiplied and given a bonus, so a free kick in range is usually a shot; below the xG floor it is not offered.
    'free_kick_shoot_range': 30.0,
    'free_kick_appetite': 3.0,
    'free_kick_bonus': 0.02,
    'free_kick_min_xg': 0.02,

    # Duels
    'tackle_rate': 0.075,          # tackle attempts per second when in range
    'tackle_base_success': 0.42,
    'foul_base': 0.10,
    'yellow_on_foul': 0.16,

    # Goalkeeping
    'gk_reaction': 0.30,          # seconds for a 100-rated keeper; up to +0.15 for poor ones
    'gk_save_base': 3.7,
    'gk_dive_speed': 4.2,         # m/s along the line once he has left his feet
    'gk_high_delay': 0.12,        # extra seconds before he moves for a ball going into the top corner (it takes a keeper about a second to get there)
    'gk_read_error': 0.35,        # metres, 1 sd, in where he reads a shot will cross the line (more for a poorer positioner and a harder-hit shot)
    'gk_reach_stand': 1.0,        # metres from his body he can get a hand to without moving: about half an arm span
    'gk_reach_dive': 1.7,         # and at full stretch

    # Control
    'first_touch_base': 3.0,
}
