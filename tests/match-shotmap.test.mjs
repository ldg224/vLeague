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

test('the Result line gives no distance, only "over the bar" (B-50)', () => {
  const s = Object.fromEntries(shotsOf(file, fx).map(x => [x.id, x]));
  assert.equal(resultText(s['1']), 'Saved');
  assert.equal(resultText(s['2']), 'Off target');
  assert.equal(resultText(s['3']), 'Off target');
  assert.equal(resultText(s['4']), 'Off target, over the bar');
});

test('a narrow miss, or one the data put inside the frame, is drawn clear of the goal (B-50)', () => {
  // goal frame in the picture: x 0..73.2, y 0..24.4 (tenths of a metre)
  const near = { ...file, events: [shot(5, 88, 34, 34 + 3.7, 0.5, 'off_target', true), shot(6, 88, 34, 33.9, 0.6, 'off_target')] };
  for (const sel of ['5', '6']) {
    const d = mouthDot(shotMapCard(fx, near, ctx, { sel, period: 'all' }));
    const clear = d.cx + d.r < 0 || d.cx - d.r > 73.2 || d.cy + d.r < 0;
    assert.ok(clear, `shot ${sel} at ${d.cx},${d.cy} is clear of the frame`);
  }
  const s = shotsOf(near, fx)[0];
  assert.equal(s.xgot, null, 'a miss has no xGOT even if flagged on target');
});

test('a blocked shot: its line stops at the block, and no dot in the little goal (B-50)', () => {
  const blk = { ...file, events: [shot(7, 85, 30, 34, 0.2, 'blocked', true), { id: 8, type: 'block', t: 107.3, x: 88, y: 31, team: 'AAA' }] };
  const html = shotMapCard(fx, blk, ctx, { sel: '7', period: 'all' });
  assert.doesNotMatch(html, /class="sm-md /);
  const line = html.match(/class="sm-trail" x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/);
  assert.ok(line, 'a line to the block');
  assert.ok(Math.abs(+line[3] - +line[1]) < 4, `the line is short (${line[1]} -> ${line[3]}), not to the goal line`);
  const none = shotMapCard(fx, { ...blk, events: [blk.events[0]] }, ctx, { sel: '7', period: 'all' });
  assert.doesNotMatch(none, /class="sm-trail"/, 'no block spot known: no line at all');
});

test('the player map widens to show a shot from far out', () => {
  const list = shotsOf({ ...file, events: [shot(9, 20, 34, 40, 0.5, 'off_target')] }, fx).map(x => ({ ...x, home: false, label: '' }));
  const vb = playerShotMap(list, { sel: null }, { colour: '#00f', label: () => '' }).match(/class="sm-pitch" viewBox="([-\d.]+)/)[1];
  assert.ok(Number(vb) < list[0].X - 2, `view starts at ${vb}, shot at ${list[0].X}`);
});
