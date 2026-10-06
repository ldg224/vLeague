"""Players, teams and the ball: the physical state of a match."""

from dataclasses import dataclass, field

from .config import PITCH_LENGTH, PITCH_WIDTH


@dataclass(eq=False)
class Player:
    id: str
    name: str
    team: str
    position: str            # GK / DEF / MID / FWD
    attrs: dict
    slot: str = ''           # formation slot, e.g. LB, CDM, ST
    line: str = ''           # GK / DEF / MID / AM / FWD
    idx: int = 0             # index in the output frame arrays
    side: int = 0            # 0 home, 1 away

    x: float = 0.0
    y: float = 0.0
    vx: float = 0.0
    vy: float = 0.0
    fx: float = 1.0          # facing direction (unit vector)
    fy: float = 0.0

    tx: float = 0.0          # movement target
    ty: float = 0.0
    urgency: int = 1         # 0 walk, 1 jog, 2 run, 3 sprint

    energy: float = 1.0      # 1 fresh -> 0 exhausted
    distance: float = 0.0

    # Timers (match seconds)
    stunned_until: float = 0.0      # beaten in a duel: slowed, can't tackle
    tackle_ready_at: float = 0.0
    touch_ready_at: float = 0.0     # can't touch the ball again until (e.g. just kicked it)
    retarget_at: float = 0.0
    react_at: float = 0.0           # reaction delay after possession changes
    run_until: float = 0.0          # making a forward run until
    support_at: float = 0.0
    decide_at: float = 0.0
    kick_at: float = 0.0
    action: object = None           # pending on-ball action

    yellow: int = 0
    sent_off: bool = False
    chasing: bool = False

    oe: float = 0.7                 # current offside-line misjudgement (m)
    oe_until: float = 0.0
    tx_att_run: tuple = (0.0, 0.0)  # forward-run destination (attacking coords)
    support_ax: tuple = None        # current support position (attacking coords)

    vmax_base: float = 8.0
    accel: float = 3.5

    def a(self, name):
        return self.attrs.get(name, 50.0) / 100.0

    @property
    def is_gk(self):
        return self.line == 'GK'

    def vmax(self):
        return self.vmax_base * (0.82 + 0.18 * self.energy)

    def setup_physical(self):
        self.vmax_base = 6.6 + 2.8 * self.a('pace')          # 6.6 .. 9.4 m/s
        self.accel = 2.6 + 2.4 * self.a('acceleration')      # 2.6 .. 5.0 m/s^2


@dataclass(eq=False)
class Team:
    code: str
    name: str
    colour: str
    players: list
    formation: str = '4-3-3'
    tactics: dict = field(default_factory=dict)
    takers: dict = field(default_factory=dict)   # kind ('penalty', 'free_kick', 'corner') -> player id
    captain: str = ''
    form: float = 0.0        # per-match skill modifier applied in teams.build_team (fraction, +/- 0.05)
    side: int = 0
    direction: int = 1       # +1 attacks toward x = 105, -1 toward x = 0

    def to_att(self, x, y):
        """Pitch coords -> this team's attacking coords (own goal at x=0, attacking toward x=105)."""
        if self.direction == 1:
            return x, y
        return PITCH_LENGTH - x, PITCH_WIDTH - y

    def from_att(self, ax, ay):
        return self.to_att(ax, ay)   # the mirror is its own inverse

    def active(self):
        return [p for p in self.players if not p.sent_off]

    def tactic(self, name, default=0.5):
        v = self.tactics.get(name)
        return default if v is None else max(0.0, min(1.0, v))


@dataclass
class Ball:
    x: float = PITCH_LENGTH / 2
    y: float = PITCH_WIDTH / 2
    z: float = 0.0
    vx: float = 0.0
    vy: float = 0.0
    vz: float = 0.0
    holder: Player = None
    in_hands: bool = False
    in_play: bool = False
    last_touch: Player = None
    flight: dict = None       # what the current free ball is: pass / shot / cross / deflection ...

    def speed(self):
        return (self.vx * self.vx + self.vy * self.vy + self.vz * self.vz) ** 0.5

    def stop(self):
        self.vx = self.vy = self.vz = 0.0
