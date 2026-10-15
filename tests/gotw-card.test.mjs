import test from 'node:test';
import assert from 'node:assert/strict';
const { gotwHtml } = await import('../js/gotw-html.js');

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const m = (i, team, who) => ({ key: `k${i}`, fixture: `f${i}`, team, scorerName: who, home: 'AAA', away: 'BBB', minute: 30 + i, xg: 0.05, dist: 25, passes: 3, body: 'foot', wow: 50 });
const cand = [m(1, 'AAA', 'Ann'), m(2, 'BBB', 'Bob'), m(3, 'CCC', 'Cy')];
const row = { week: 5, status: 'voting', candidates: cand, finalists: ['k1', 'k2', 'k3'], closes_at: '2099-01-01T00:00:00Z' };
const base = { row, mine: 'AAA', myVote: null, tally: null, now: new Date('2026-10-16'), label: 'Round 5', name: c => c, crest: c => `<i>${c}</i>`, esc };

test('while voting: a vote button on other clubs goals, none on your own, no tally', () => {
  const h = gotwHtml(base);
  assert.match(h, /data-gw-vote="k2"/);
  assert.match(h, /data-gw-vote="k3"/);
  assert.doesNotMatch(h, /data-gw-vote="k1"/);
  assert.match(h, /Your club/);
  assert.match(h, /gwc-screen/);
  assert.doesNotMatch(h, /gwc-score/);
});

test('your vote is marked, and you can change it', () => {
  const h = gotwHtml({ ...base, myVote: 'k2' });
  assert.match(h, /gwc-vote on" data-gw-vote="k2" aria-pressed="true"/);
  assert.match(h, /Your vote/);
  assert.match(h, /data-gw-vote="k3"/);
});

test('a signed-in visitor with no club sees no vote buttons', () => {
  const h = gotwHtml({ ...base, mine: undefined });
  assert.doesNotMatch(h, /data-gw-vote/);
  assert.match(h, /Only club managers vote/);
});

test('once ended: the tally, most votes first, winner marked, no screen or vote buttons', () => {
  const h = gotwHtml({ ...base, row: { ...row, status: 'closed' }, tally: [{ pick: 'k3', votes: 6 }, { pick: 'k2', votes: 2 }] });
  assert.doesNotMatch(h, /data-gw-vote/);
  assert.doesNotMatch(h, /gwc-screen/);
  assert.ok(h.indexOf('Cy') < h.indexOf('Bob') && h.indexOf('Bob') < h.indexOf('Ann'));
  assert.match(h, /gwc-row win/);
  assert.match(h, /75%/);
  assert.match(h, /8 managers voted/);
});

test('a time that has passed counts as ended even if the office has not closed it', () => {
  const h = gotwHtml({ ...base, row: { ...row, closes_at: '2026-10-10T00:00:00Z' }, tally: [] });
  assert.match(h, /Nobody voted/);
  assert.doesNotMatch(h, /data-gw-vote/);
});

test('a goal from a hidden result cannot be watched and gives nothing away', () => {
  const h = gotwHtml({ ...base, hidden: new Set(['f2']) });
  assert.match(h, /Result hidden/);
  assert.match(h, /disabled/);
  assert.match(h, /data-reveal-all/);
});
