"""Run with:  python -m unittest discover -s tests -v

These tests don't need the internet: they build a small synthetic league.
The full-match tests take about a minute.
"""

import json
import math
import os
import tempfile
import unittest

from hcl_sim import physics, ratings, teams
from hcl_sim.run import simulate
from hcl_sim.validate import validate


def synthetic_league():
    teams = {'AAA': {'code': 'AAA', 'name': 'Alpha', 'manager': '', 'colour': '#ff0000'},
             'BBB': {'code': 'BBB', 'name': 'Beta', 'manager': '', 'colour': '#0000ff'}}
    players = {}
    n = 0
    for code, off, dfn in (('AAA', 7, 6), ('BBB', 5, 7)):
        for pos, count in (('GK', 1), ('DEF', 4), ('MID', 3), ('FWD', 3)):
            for _ in range(count):
                pid = f'{n:04d}'
                players[pid] = {'id': pid, 'name': f'Player {pid}', 'team': code, 'position': pos,
                                'offense': off, 'defense': dfn}
                n += 1
    return {'teams': teams, 'players': players, 'attributes': {}, 'tactics': {}, 'schedule': []}


class Physics(unittest.TestCase):
    def test_ground_pass_arrives_at_planned_speed(self):
        for d, arrival in ((10, 6), (25, 8), (40, 9)):
            v0 = physics.ground_speed_for(d, arrival)
            self.assertIsNotNone(v0)
            ball = physics._P(0, 0, 0, v0, 0, 0)
            while ball.x < d and ball.vx > 0:
                physics.step(ball)
            self.assertAlmostEqual(ball.vx, arrival, delta=1.0)

    def test_lofted_ball_lands_where_planned(self):
        for d, angle in ((20, 25), (35, 30), (50, 35)):
            v0 = physics.loft_speed_for(d, angle)
            vx, vy, vz = physics.launch_velocity(1, 0, v0, angle)
            ball = physics._P(0, 0, 0, vx, vy, vz)
            physics.step(ball)
            while ball.z > 0:
                physics.step(ball)
            self.assertAlmostEqual(ball.x, d, delta=1.5)

    def test_rolling_ball_stops(self):
        ball = physics._P(0, 0, 0, 20, 0, 0)
        for _ in range(1000):
            physics.step(ball)
        self.assertEqual(ball.vx, 0.0)
        self.assertLess(ball.x, 80)


class Ratings(unittest.TestCase):
    def test_derived_attributes_are_stable_and_in_range(self):
        p = {'id': '0007', 'position': 'FWD', 'offense': 9, 'defense': 3}
        a1, a2 = ratings.derive(p), ratings.derive(p)
        self.assertEqual(a1, a2)
        self.assertTrue(all(1 <= v <= 99 for v in a1.values()))
        self.assertGreater(a1['finishing'], a1['tackling'])

    def test_overrides_win(self):
        a = ratings.derive({'id': '1', 'position': 'MID', 'offense': 5, 'defense': 5}, {'pace': 95})
        self.assertEqual(a['pace'], 95)


class ManagerChoices(unittest.TestCase):
    def test_chosen_lineup_formation_and_takers(self):
        from hcl_sim.teams import build_team
        league = synthetic_league()
        # A 4-4-2 with a DEF in midfield; one slot names a player from the other team and gets auto-filled.
        league['tactics']['AAA'] = {'formation': '4-4-2', 'tempo': 0.8,
                                    'lineup': {'GK': '0000', 'LB': '0004', 'LCB': '0001', 'LM': '0002', 'LST': '0015', 'NOPE': '0003'},
                                    'penalties': '0010', 'captain': '0001', 'corners': '9999'}
        team = build_team(league, 'AAA')
        slots = {p.slot: p.id for p in team.players}
        self.assertEqual(team.formation, '4-4-2')
        self.assertEqual(len(team.players), 11)
        self.assertEqual((slots['LB'], slots['LCB'], slots['LM']), ('0004', '0001', '0002'))
        self.assertNotEqual(slots['LST'], '0015')
        self.assertEqual(team.tactic('tempo'), 0.8)
        self.assertEqual(team.takers['penalty'], '0010')
        self.assertEqual(team.captain, '0001')
        self.assertNotIn('lineup', team.tactics)

    def test_defaults_unchanged_without_choices(self):
        from hcl_sim.teams import build_team
        team = build_team(synthetic_league(), 'AAA')
        self.assertEqual((team.formation, team.takers, team.captain), ('4-3-3', {}, ''))


class Form(unittest.TestCase):
    """The per-match form modifier (tactics 'form', the site's press effect)."""

    def test_form_scales_exactly_the_skill_attributes(self):
        from hcl_sim.teams import FORM_ATTRS, build_team
        base = {p.id: dict(p.attrs) for p in build_team(synthetic_league(), 'AAA').players}
        league = synthetic_league()
        league['tactics']['AAA'] = {'form': 0.02}
        team = build_team(league, 'AAA')
        self.assertEqual(team.form, 0.02)
        self.assertNotIn('form', team.tactics)
        for p in team.players:
            for k, v in base[p.id].items():
                want = round(max(1.0, min(99.0, v * 1.02)), 1) if k in FORM_ATTRS else v
                self.assertEqual(p.attrs[k], want, k)
        for k in ('pace', 'acceleration', 'stamina', 'strength', 'agility', 'aggression'):
            self.assertNotIn(k, FORM_ATTRS)
        # The other team is untouched.
        self.assertEqual(build_team(league, 'BBB').form, 0.0)

    def test_form_is_clamped(self):
        from hcl_sim.teams import build_team
        for given, want in ((0.2, 0.03), (-1, -0.03), (0.02, 0.02), ('0.03', 0.0), (None, 0.0)):
            league = synthetic_league()
            league['tactics']['AAA'] = {'form': given}
            self.assertEqual(build_team(league, 'AAA').form, want, given)

    def test_no_form_gives_the_same_match(self):
        base = simulate(synthetic_league(), 'AAA', 'BBB', seed=5)
        for form in (0, 0.0):
            league = synthetic_league()
            league['tactics']['AAA'] = {'form': form}
            again = simulate(league, 'AAA', 'BBB', seed=5)
            self.assertNotIn('form', again['teams']['home'])
            again['engine']['generated_at'] = base['engine']['generated_at']
            self.assertEqual(json.dumps(again, sort_keys=True), json.dumps(base, sort_keys=True))

    def test_form_is_written_to_the_output(self):
        league = synthetic_league()
        league['tactics']['BBB'] = {'form': -0.09}
        m = simulate(league, 'AAA', 'BBB', seed=5, include_frames=False)
        self.assertEqual(m['teams']['away']['form'], -0.03)
        self.assertNotIn('form', m['teams']['home'])
        self.assertNotIn('form', m['teams']['away']['tactics'])


class Validator(unittest.TestCase):
    def _match(self):
        league = synthetic_league()
        return simulate(league, 'AAA', 'BBB', seed=11)

    @classmethod
    def setUpClass(cls):
        cls.match = cls._match(cls)

    def test_simulated_match_is_valid(self):
        rep = validate(self.match)
        self.assertTrue(rep['ok'], rep['problems'][:5])
        self.assertLessEqual(rep['max_player_speed'], 10.5)

    def test_result_matches_goal_events(self):
        goals = [e for e in self.match['events'] if e['type'] == 'goal']
        self.assertEqual(len(goals), self.match['result']['home'] + self.match['result']['away'])

    def test_validator_catches_teleport(self):
        m = self.match
        data = [row[:] for row in m['frames']['data'][:200]]
        data[150][6] += 400          # move player 0 forty metres in one frame
        bad = dict(m, frames=dict(m['frames'], data=data))
        rep = validate(bad)
        self.assertIn('player_speed', [k for k, _ in rep['problems']])

    def test_validator_catches_unexplained_possession(self):
        m = self.match
        events = [e for e in m['events'] if e['type'] != 'control']
        bad = dict(m, events=events)
        rep = validate(bad)
        self.assertIn('unexplained_possession', [k for k, _ in rep['problems']])

    def test_same_seed_same_match(self):
        again = simulate(synthetic_league(), 'AAA', 'BBB', seed=11)
        self.assertEqual(again['result'], self.match['result'])
        self.assertEqual(again['frames']['data'][-1], self.match['frames']['data'][-1])


if __name__ == '__main__':
    unittest.main()
