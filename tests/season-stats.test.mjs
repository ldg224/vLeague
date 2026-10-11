// Run with:  node --test "tests/*.test.mjs"        (no packages needed)
// Made-up results for two clubs, small enough to check by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MIN_MINUTES, countedFixtures, totals, rank, format, per90, PLAYER_CARDS, TEAM_CARDS } from '../js/season-stats.js';

const P = (name, team, slot, o = {}) => ({ name, team, slot, min: 90, g: 0, a: 0, sh: 0, sot: 0, xg: 0, kp: 0, pas: 0, pc: 0, tk: 0, int: 0, clr: 0, blk: 0, sv: 0, gc: 0, yc: 0, rc: 0, fl: 0, dr: 0, cr: 0, r: 6.5, ...o });
const stats = (o = {}) => ({ xg: 1, shots: 8, shots_on_target: 3, big_chances: 1, passes: 300, passes_completed: 240, crosses: 10, tackles_won: 12, interceptions: 8, clearances: 15, saves: 2, fouls: 10, yellow_cards: 1, red_cards: 0, corners: 4, offsides: 1, possession: 50, ...o });

// Match 1: AAA 2-0 BBB. Ana scores both; Cam is sent off after 10 minutes.
const m1 = {
  id: 'f1', home: 'AAA', away: 'BBB',
  result: {
    home: 2, away: 0,
    stats: { home: stats({ xg: 2.1, possession: 60 }), away: stats({ xg: 0.4, possession: 40 }) },
    players: {
      a1: P('Ana', 'AAA', 'ST', { g: 2, a: 0, sh: 4, sot: 3, xg: 1.5, r: 8.6, pc: 20, pas: 25 }),
      a2: P('Alf', 'AAA', 'GK', { sv: 3, gc: 0, r: 7.4 }),
      a3: P('Cam', 'AAA', 'CM', { min: 10, rc: 1, fl: 2, r: 4.2 }),
      b1: P('Bea', 'BBB', 'ST', { sh: 2, xg: 0.3, r: 6.0 }),
      b2: P('Ben', 'BBB', 'GK', { sv: 3, gc: 2, r: 6.2 }),
    },
  },
};
// Match 2: BBB 1-1 AAA. Ana scores again and Bea equalises; Alf concedes one.
const m2 = {
  id: 'f2', home: 'BBB', away: 'AAA',
  result: {
    home: 1, away: 1,
    stats: { home: stats({ xg: 1.0, possession: 45 }), away: stats({ xg: 1.2, possession: 55 }) },
    players: {
      a1: P('Ana', 'AAA', 'ST', { g: 1, a: 1, sh: 3, xg: 0.9, r: 7.6 }),
      a2: P('Alf', 'AAA', 'GK', { sv: 2, gc: 1, r: 6.5 }),
      b1: P('Bea', 'BBB', 'ST', { g: 1, sh: 3, xg: 0.8, r: 7.2 }),
      b2: P('Ben', 'BBB', 'GK', { sv: 1, gc: 1, r: 6.6 }),
    },
  },
};

test('only finished league matches with a result are counted', () => {
  const list = [m1, m2, { ...m1, id: 't', test: true }, { ...m1, id: 'x', exhibition: true }, { id: 'n', home: 'AAA', away: 'BBB' }];
  assert.deepEqual(countedFixtures(list).map(f => f.id), ['f1', 'f2']);
});

test('player totals add up across matches', () => {
  const { players } = totals([m1, m2]);
  const ana = players.find(p => p.name === 'Ana');
  assert.equal(ana.apps, 2);
  assert.equal(ana.g, 3);
  assert.equal(ana.a, 1);
  assert.equal(ana.min, 180);
  assert.equal(ana.sh, 7);
  assert.ok(Math.abs(ana.xg - 2.4) < 1e-9);
  assert.equal(per90(ana, 'g'), 1.5);
});

test('goalkeeper numbers: clean sheet, saves and goals conceded come from games in goal', () => {
  const { players } = totals([m1, m2]);
  const alf = players.find(p => p.name === 'Alf');
  assert.equal(alf.cs, 1);
  assert.equal(alf.saves, 5);
  assert.equal(alf.conceded, 1);
  assert.equal(alf.gkMin, 180);
  const ana = players.find(p => p.name === 'Ana');
  assert.equal(ana.gkMin, 0);
});

test('team totals: record, goals, clean sheets, xG for and against', () => {
  const { teams } = totals([m1, m2]);
  const a = teams.find(t => t.code === 'AAA'), b = teams.find(t => t.code === 'BBB');
  assert.deepEqual([a.p, a.w, a.d, a.l, a.gf, a.ga, a.cs, a.pts], [2, 1, 1, 0, 3, 1, 1, 4]);
  assert.deepEqual([b.p, b.w, b.d, b.l, b.gf, b.ga, b.cs, b.pts], [2, 0, 1, 1, 1, 3, 0, 1]);
  assert.ok(Math.abs(a.xg - 3.3) < 1e-9);
  assert.ok(Math.abs(a.xga - 1.4) < 1e-9);
  assert.equal(a.possession / a.p, 57.5);
});

test('a 10-minute cameo can not top a per-90 list or the ratings', () => {
  const { players } = totals([m1, m2]);
  const cam = players.find(p => p.name === 'Cam');
  assert.ok(cam.min < MIN_MINUTES);
  const fouls = rank(players, PLAYER_CARDS.find(c => c.id === 'fl90'));
  assert.ok(!fouls.some(x => x.row.name === 'Cam'));
  const rated = rank(players, PLAYER_CARDS.find(c => c.id === 'rating'));
  assert.ok(!rated.some(x => x.row.name === 'Cam'));
  // ...but his red card still counts in the plain totals
  const reds = rank(players, PLAYER_CARDS.find(c => c.id === 'rc'));
  assert.equal(reds[0].row.name, 'Cam');
});

test('rankings: best first, 0s left out, ties share a rank and the next rank skips', () => {
  const { players } = totals([m1, m2]);
  const scorers = rank(players, PLAYER_CARDS.find(c => c.id === 'scorers'));
  assert.deepEqual(scorers.map(x => [x.row.name, x.value, x.rank]), [['Ana', 3, 1], ['Bea', 1, 2]]);
  const rows = [{ name: 'A', g: 5 }, { name: 'B', g: 5 }, { name: 'C', g: 5 }, { name: 'D', g: 2 }, { name: 'E', g: 0 }];
  assert.deepEqual(rank(rows, { value: r => r.g }).map(x => x.rank), [1, 1, 1, 4]);
  assert.equal(rank(rows, { value: r => r.g }, 2).length, 2);
});

test('rating is the average of the match ratings', () => {
  const { players } = totals([m1, m2]);
  const top = rank(players, PLAYER_CARDS.find(c => c.id === 'rating'));
  assert.equal(top[0].row.name, 'Ana');
  assert.equal(top[0].value, 8.1);   // (8.6 + 7.6) / 2
});

test('goalkeeper cards only list keepers; low-is-better cards put the lowest first', () => {
  const { players } = totals([m1, m2]);
  const conceded = rank(players, PLAYER_CARDS.find(c => c.id === 'gc90'));
  assert.deepEqual(conceded.map(x => [x.row.name, x.value]), [['Alf', 0.5], ['Ben', 1.5]]);
  const pct = rank(players, PLAYER_CARDS.find(c => c.id === 'savepct'));
  assert.equal(pct[0].row.name, 'Alf');   // 5 saves, 1 conceded: 83%
  assert.equal(pct[0].value, 83);
  assert.equal(format(pct[0].value, PLAYER_CARDS.find(c => c.id === 'savepct')), '83%');
});

test('team cards rank clubs', () => {
  const { teams } = totals([m1, m2]);
  const diff = rank(teams, TEAM_CARDS.find(c => c.id === 'txgdiff'));
  assert.deepEqual(diff.map(x => [x.row.code, x.value]), [['AAA', 1.9], ['BBB', -1.9]]);
  assert.equal(format(1.9, TEAM_CARDS.find(c => c.id === 'txgdiff')), '+1.9');
  const conceded = rank(teams, TEAM_CARDS.find(c => c.id === 'tconceded'));
  assert.equal(conceded[0].row.code, 'AAA');   // 0.5 a match, fewest first
});

test('a result saved before WR-07 (no fouls, dribbles...) still counts', () => {
  const old = structuredClone(m1);
  for (const p of Object.values(old.result.players)) { delete p.fl; delete p.dr; delete p.cr; }
  const { players } = totals([old]);
  assert.equal(players.find(p => p.name === 'Ana').dr, 0);
  assert.equal(players.find(p => p.name === 'Ana').g, 2);
});

test('no matches played gives empty lists, not errors', () => {
  const { players, teams } = totals([]);
  assert.deepEqual([players.length, teams.length], [0, 0]);
  for (const c of PLAYER_CARDS) assert.deepEqual(rank(players, c), []);
  for (const c of TEAM_CARDS) assert.deepEqual(rank(teams, c), []);
});
