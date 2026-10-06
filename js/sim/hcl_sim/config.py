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
    'shot_error_base': 5.0,
    'shot_error_skill': 12.0,
    'shot_error_pressure': 7.0,
    'header_error_extra': 4.0,

    # Decisions
    'decision_temperature': 0.006,   # softmax temperature for a 100-rated decision maker
    'decision_temperature_poor': 0.020,
    'risk_aversion': 1.0,
    'shot_appetite': 0.68,

    # Duels
    'tackle_rate': 0.09,          # tackle attempts per second when in range
    'tackle_base_success': 0.42,
    'foul_base': 0.10,
    'yellow_on_foul': 0.16,

    # Goalkeeping
    'gk_reaction': 0.22,          # seconds for a 100-rated keeper; up to +0.15 for poor ones
    'gk_save_base': 3.7,
    'gk_dive_speed': 6.0,

    # Control
    'first_touch_base': 3.0,
}
