// Run with:  node --test "tests/*.test.mjs"        (no packages needed)
// The Office notice on the Overview: what it lists for offers, answers and the transfer window.
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.location ??= { hostname: 'localhost', search: '', href: 'http://localhost/' };
const { alertItems } = await import('../js/office-alert.js');

const names = { CCF: 'Coast City FC', SKS: 'SKS FC', NGY: 'Neegy FC' };
const nameOf = c => names[c] || c;

test('incoming offers and answers to my offers, each once by key', () => {
  const items = alertItems({ incoming: [{ id: 7, from_club: 'CCF' }], answered: [{ id: 9, to_club: 'SKS', status: 'accepted' }, { id: 10, to_club: 'NGY', status: 'countered' }] }, nameOf);
  assert.deepEqual(items.map(i => i.key), ['in:7', 'ans:9:accepted', 'ans:10:countered']);
  assert.match(items[0].text, /<b>Coast City FC<\/b> sent you a trade offer/);
  assert.match(items[1].text, /SKS FC<\/b> accepted your trade offer/);
  assert.match(items[2].text, /counter-offer/);
});
test('the window shows only while open, keyed by its closing time', () => {
  const open = alertItems({ window: { status: 'open', closes_at: '2026-11-20T08:30:00Z' } });
  assert.equal(open.length, 1); assert.equal(open[0].key, 'win:2026-11-20T08:30:00Z'); assert.match(open[0].text, /Transfer window open\.<\/b> Closes /);
  assert.equal(alertItems({ window: { status: 'closed' } }).length, 0);
  assert.equal(alertItems({ window: { status: 'round' } }).length, 0);
});
test('nothing to say, nothing listed; withdrawn or expired answers are left out', () => {
  assert.equal(alertItems({}).length, 0);
  assert.equal(alertItems({ answered: [{ id: 1, to_club: 'SKS', status: 'expired' }] }).length, 0);
});
test('club names are escaped', () => {
  assert.match(alertItems({ incoming: [{ id: 1, from_club: '<x>' }] }).at(0).text, /&lt;x&gt;/);
});
