import test from 'node:test';
import assert from 'node:assert/strict';
const { buildEffects, DIVE_MIN } = await import('../js/viewer/effects.js');

const d = (events, extra = {}) => ({
  teams: { home: { code: 'AAA' }, away: { code: 'BBB' } },
  players: [{ idx: 0, id: 'g1', team: 'AAA', slot: 'GK' }, { idx: 1, id: 'p1', team: 'AAA', slot: 'CB' }, { idx: 2, id: 'g2', team: 'BBB', slot: 'GK' }, { idx: 3, id: 'p2', team: 'BBB', slot: 'ST' }],
  events, ...extra,
});
// frames: the BBB keeper (idx 2) slides `slide` metres along y between t = 10 and 12; everyone else stands still
const frames = slide => ({ at: t => ({ players: [[3, 34], [30, 20], [102, 34 + slide * Math.min(1, Math.max(0, (t - 10) / 2))], [60, 30]], vel: [[0, 0], [1, 0], [0, 0], [2, 1]] }) });
const shot = (outcome, over = {}) => ({ type: 'shot', t: 10, team: 'AAA', player: 'p1', on_target: true, outcome, ...over });

test('a keeper who goes 1.1 m or more after a shot on target dives; a short step does not', () => {
  const ev = [shot('saved'), { type: 'save', t: 12, player: 'g2' }];
  assert.equal(buildEffects(d(ev), frames(3)).dives.length, 1);
  assert.equal(buildEffects(d(ev), frames(0.5)).dives.length, 0);
  assert.ok(DIVE_MIN >= 1);
});

test('the dive is upright before the shot, goes out, lies a moment, then gets up', () => {
  const fx = buildEffects(d([shot('goal'), { type: 'goal', t: 12, team: 'AAA' }]), frames(3));
  assert.equal(fx.diveAt(2, 9), null);
  const mid = fx.diveAt(2, 11), lying = fx.diveAt(2, 12.3), up = fx.diveAt(2, 12.7);
  assert.ok(mid.k > 0.9 && mid.lift > 0.1, JSON.stringify(mid));
  assert.ok(lying.k > 0.9 && lying.lift === 0);
  assert.ok(up.k < lying.k);
  assert.equal(fx.diveAt(2, 14), null);
  assert.equal(fx.diveAt(0, 11), null);   // only the keeper who was shot at
  assert.ok(mid.dy > 0.9);                 // he goes towards +y
});

test('off-target shots and misses make no dive', () => {
  assert.equal(buildEffects(d([shot('missed', { on_target: false })]), frames(3)).dives.length, 0);
  assert.equal(buildEffects(d([shot('saved', { on_target: false })]), frames(3)).dives.length, 0);
});

test('a red card no longer takes the head off', () => {
  const fx = buildEffects(d([{ type: 'foul', t: 20, player: 'p1', team: 'AAA' }, { type: 'card', t: 22.5, player: 'p1', team: 'AAA', card: 'red' }]), frames(0));
  assert.equal(fx.headGone, undefined);
  assert.equal(fx.heads, undefined);
});
