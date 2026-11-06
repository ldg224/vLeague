// The one-hour match slot (S-34): 45 minutes of football, 15 of show, whatever the result.
import assert from 'node:assert/strict';
import { test } from 'node:test';
globalThis.location = new URL('http://localhost/');
const { liveSimTime, liveShow, liveSpeed, status, shownScore } = await import('../js/dashboard-data.js');

const KICK = new Date(2026, 10, 6, 17, 30);
const season = { live_minutes: 60 };
const periods = [{ period: 1, start_t: 0, end_t: 2900 }, { period: 2, start_t: 2900, end_t: 5900 }];
const fixture = goals => ({ id: 'x', date: '2026-11-06', time: '17:30', home: 'A', away: 'B', 
  result: { home: 0, away: 0, duration_t: 5900, periods, goals } });
const at = s => new Date(KICK.getTime() + s * 1000);
const goal = (t, team = 'A') => ({ t, team, minute: '10', scorer: 'p' });

test('the football rate is the same whatever the score', () => {
  assert.equal(liveSpeed(fixture([]), season), 5900 / 2700);
  assert.equal(liveSpeed(fixture([goal(100), goal(4000), goal(5000)]), season), 5900 / 2700);
});

test('the clock never runs backwards and ends on the whistle at 60 minutes', () => {
  for (const goals of [[], [goal(100)], [goal(2895)], [goal(5895)], Array.from({ length: 12 }, (_, i) => goal(300 + i * 400))]) {
    const f = fixture(goals);
    let last = -1;
    for (let s = 0; s <= 3600; s += 2) { const t = liveSimTime(f, season, at(s)); assert.ok(t >= last - 1e-9, `backwards at ${s}`); last = t; }
    assert.ok(Math.abs(last - 5900) < 1e-6);
    assert.equal(status(f, season, at(3599)), 'live');
    assert.equal(status(f, season, at(3601)), 'ft');
  }
});

test('the show runs in order and the score waits for the football', () => {
  const f = fixture([goal(1000)]);
  assert.equal(liveShow(f, season, at(10)).kind, 'pre');
  assert.equal(liveSimTime(f, season, at(149)), 0);
  assert.equal(shownScore(f, season, at(149)).home, 0);
  assert.equal(liveShow(f, season, at(160)), null);
  const goalReal = 150 + 1022 / (5900 / 2700);
  assert.equal(liveShow(f, season, at(goalReal + 5)).kind, 'goal');
  assert.equal(shownScore(f, season, at(goalReal + 5)).home, 1);
  const halfReal = 150 + 40 + 2900 / (5900 / 2700);
  assert.equal(liveShow(f, season, at(halfReal + 60)).kind, 'half');
  assert.equal(liveShow(f, season, at(halfReal + 125)), null);
  assert.equal(liveShow(f, season, at(3590)).kind, 'end');
});

test('there is always time for a full-time show, even with a lot of goals', () => {
  const f = fixture(Array.from({ length: 30 }, (_, i) => goal(100 + i * 190)));
  assert.equal(liveShow(f, season, at(3600 - 119)).kind, 'end');
});
