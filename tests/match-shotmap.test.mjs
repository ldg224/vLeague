// Run with:  node --test "tests/*.test.mjs"        (no packages needed)
// The shot map's little goal and Result line (B-44, B-40): every shot shows, however wide or high it went.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shotsOf, shotMapCard, playerShotMap, resultText } from '../js/match-shotmap.js';

const fx = { home: 'AAA', away: 'BBB' };
const shot = (id, x, y, end_y, end_z, outcome, on_target = false) => ({ id, type: 'shot', team: 'BBB', player: 'p1', period: 1, minute: String(10 + id), t: 100 + id, x, y, end_y, end_z, outcome, on_target, xg: 0.08 });
const file = { periods: [{ period: 1, home_attacks: 'left' }], events: [
  shot(1, 90, 30, 35.1, 1.2, 'saved', true), shot(2, 88, 40, 40.7, 0.3, 'off_target'), shot(3, 80, 20, 58, 0.1, 'off_target'), shot(4, 92, 34, 33, 5.6, 'off_target')] };
const ctx = { team: c => ({ code: c, name: c }), club: () => null, crest: () => '', accent: () => '', players: [{ id: 'p1', name: 'Shooter' }] };
const mouthDot = html => {
  const m = html.match(/<svg class="sm-mouth" viewBox="([-\d. ]+)"[\s\S]*?<circle class="sm-md ([^"]+)" cx="([-\d.]+)" cy="([-\d.]+)" r="([\d.]+)"/);
  const [x0, y0, w, h] = m[1].split(' ').map(Number);
  return { cls: m[2], cx: +m[3], cy: +m[4], r: +m[5], x0, y0, x1: x0 + w, y1: y0 + h };
};

test('a miss far wide of the post still shows in the little goal, pinned to its edge', () => {
  for (const sel of ['2', '3', '4']) {
    const d = mouthDot(shotMapCard(fx, file, ctx, { sel, period: 'all' }));
    assert.ok(d.cx - d.r >= d.x0 && d.cx + d.r <= d.x1 && d.cy - d.r >= d.y0 && d.cy + d.r <= d.y1, `shot ${sel} inside the picture`);
    assert.match(d.cls, /is-miss/);
  }
  assert.match(mouthDot(shotMapCard(fx, file, ctx, { sel: '3', period: 'all' })).cls, /is-out/);   // 20 m wide: pinned, dashed
  assert.doesNotMatch(mouthDot(shotMapCard(fx, file, ctx, { sel: '1', period: 'all' })).cls, /is-out/);   // a save sits in the goal
});

test('the Result line says how far wide, or over the bar', () => {
  const s = Object.fromEntries(shotsOf(file, fx).map(x => [x.id, x]));
  assert.equal(resultText(s['1']), 'Saved');
  assert.equal(resultText(s['2']), 'Off target, 3 m wide');
  assert.equal(resultText(s['3']), 'Off target, 20 m wide');
  assert.equal(resultText(s['4']), 'Off target, over the bar');
});

test('the player map widens to show a shot from far out', () => {
  const list = shotsOf({ ...file, events: [shot(9, 20, 34, 40, 0.5, 'off_target')] }, fx).map(x => ({ ...x, home: false, label: '' }));
  const vb = playerShotMap(list, { sel: null }, { colour: '#00f', label: () => '' }).match(/class="sm-pitch" viewBox="([-\d.]+)/)[1];
  assert.ok(Number(vb) < list[0].X - 2, `view starts at ${vb}, shot at ${list[0].X}`);
});
