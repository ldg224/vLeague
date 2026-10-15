import test from 'node:test';
import assert from 'node:assert/strict';
const { overviewHtml, voteHtml, isOpen, ballot, left } = await import('../js/gotw-html.js');

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const m = (i, team, who) => ({ key: `k${i}`, fixture: `f${i}`, team, scorerName: who, home: 'AAA', away: 'BBB', minute: 30 + i, xg: 0.05, dist: 25, passes: 3, body: 'foot', wow: 50 - i });
const cand = [m(1, 'AAA', 'Ann Able'), m(2, 'BBB', 'Bob Best'), m(3, 'CCC', 'Cy Cole')];
const row = { week: 5, status: 'voting', candidates: cand, finalists: ['k1', 'k2', 'k3'], closes_at: '2099-01-01T00:00:00Z' };
const base = { row, mine: 'AAA', myVote: null, tally: null, now: new Date('2026-10-16'), label: 'Round 5', name: c => c, crest: c => `<i>${c}</i>`, esc };

test('open means the office opened it and the time has not passed', () => {
  assert.equal(isOpen(row, new Date('2026-10-16')), true);
  assert.equal(isOpen({ ...row, closes_at: '2026-10-10T00:00:00Z' }, new Date('2026-10-16')), false);
  assert.equal(isOpen({ ...row, status: 'closed' }, new Date('2026-10-16')), false);
  assert.equal(isOpen({ ...row, status: 'picking' }, new Date('2026-10-16')), false);
  assert.equal(isOpen(null), false);
});

test('Vote tab: a vote button on other clubs goals, none on your own, the flashing dot while you have not voted', () => {
  const h = voteHtml(base);
  assert.match(h, /data-gw-vote="k2"/);
  assert.match(h, /data-gw-vote="k3"/);
  assert.doesNotMatch(h, /data-gw-vote="k1"/);
  assert.match(h, /Your club/);
  assert.match(h, /lg-need/);
  assert.match(h, /You haven’t voted yet/);
  assert.match(h, /data-until=/);
});

test('Vote tab: your vote is ticked, the dot goes, and you can change it', () => {
  const h = voteHtml({ ...base, myVote: 'k2' });
  assert.match(h, /gv-vote on" data-gw-vote="k2" aria-pressed="true"/);
  assert.match(h, /You voted for <b>Bob Best<\/b>/);
  assert.doesNotMatch(h, /lg-need/);
  assert.match(h, /data-gw-vote="k3"/);
});

test('Vote tab: someone with no club can watch but not vote', () => {
  const h = voteHtml({ ...base, mine: undefined });
  assert.doesNotMatch(h, /data-gw-vote/);
  assert.match(h, /Only club managers vote/);
});

test('Vote tab: a goal from a hidden result cannot be watched and gives nothing away', () => {
  const h = voteHtml({ ...base, hidden: new Set(['f2']) });
  assert.match(h, /Result hidden/);
  assert.match(h, /disabled/);
  assert.match(h, /data-reveal-all/);
});

test('the ballot order is fixed per club, differs between clubs, and has every goal once', () => {
  const a = ballot(row, 'AAA').map(c => c.key), b = ballot(row, 'AAA').map(c => c.key);
  assert.deepEqual(a, b);
  assert.deepEqual([...a].sort(), ['k1', 'k2', 'k3']);
  const orders = new Set(['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF'].map(c => ballot(row, c).map(x => x.key).join()));
  assert.ok(orders.size > 1);
  assert.deepEqual(ballot(row, undefined).map(c => c.key), ['k1', 'k2', 'k3']);   // no club: best first
});

test('Overview while open: a teaser with a button to the Vote tab, no clips and no tally', () => {
  const h = overviewHtml(base);
  assert.match(h, /href="#vote"/);
  assert.match(h, /Watch and vote/);
  assert.match(h, /3 goals are up for the vote/);
  assert.doesNotMatch(h, /data-gw-vote|canvas|gwc-score/);
  assert.match(overviewHtml({ ...base, myVote: 'k3' }), /You voted for <b>Cy Cole<\/b>/);
  assert.match(overviewHtml({ ...base, myVote: 'k3' }), /Watch the goals/);
});

test('Overview once ended: the tally, most votes first, winner marked', () => {
  const h = overviewHtml({ ...base, row: { ...row, status: 'closed' }, tally: [{ pick: 'k3', votes: 6 }, { pick: 'k2', votes: 2 }] });
  assert.doesNotMatch(h, /href="#vote"/);
  assert.ok(h.indexOf('Cy Cole') < h.indexOf('Bob Best') && h.indexOf('Bob Best') < h.indexOf('Ann Able'));
  assert.match(h, /gwc-row win/);
  assert.match(h, /75%/);
  assert.match(h, /8 managers voted/);
});

test('Overview: a time that has passed counts as ended even if the office has not closed it', () => {
  const h = overviewHtml({ ...base, row: { ...row, closes_at: '2026-10-10T00:00:00Z' }, tally: [] });
  assert.match(h, /Nobody voted/);
});

test('time left reads in days, hours or minutes', () => {
  assert.equal(left(29 * 3600e3), '1 d 5 h');
  assert.equal(left(150 * 6e4), '2 h 30 min');
  assert.equal(left(20 * 6e4), '20 min');
});
