// The shared sortable-table helper (js/sort-table.js): the Draft's Available players and the Office's Squad and Market.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sortRows, clickSort, isDefault, sortHead, sortBar } from '../js/sort-table.js';

const cols = [
  { key: 'position', label: 'Pos', long: 'Position', first: 1, val: p => ({ GK: 0, DEF: 1 })[p.position] },
  { key: 'name', label: 'Player', long: 'Name', first: 1, val: p => p.name.toLowerCase() },
  { key: 'value', label: 'Value', long: 'Value', first: -1, val: p => p.value },
];
const rows = [{ name: 'Cy', position: 'DEF', value: 5 }, { name: 'Al', position: 'GK', value: 5 }, { name: 'Bo', position: 'DEF', value: 9 }];

test('sortRows: levels in order, name breaks ties, unknown keys ignored', () => {
  assert.deepEqual(sortRows(rows, [{ key: 'value', dir: -1 }], cols).map(r => r.name), ['Bo', 'Al', 'Cy']);
  assert.deepEqual(sortRows(rows, [{ key: 'position', dir: 1 }, { key: 'value', dir: -1 }], cols).map(r => r.name), ['Al', 'Bo', 'Cy']);
  assert.deepEqual(sortRows(rows, [{ key: 'nope', dir: 1 }], cols).map(r => r.name), ['Al', 'Bo', 'Cy']);
  assert.equal(rows[0].name, 'Cy');   // a copy: the list itself is not reordered
});

test('clickSort: a click sorts, again flips, shift adds a level', () => {
  let l = [{ key: 'value', dir: -1 }];
  l = clickSort(l, 'value', false, cols); assert.deepEqual(l, [{ key: 'value', dir: 1 }]);
  l = clickSort(l, 'name', false, cols); assert.deepEqual(l, [{ key: 'name', dir: 1 }]);
  l = clickSort(l, 'value', true, cols); assert.deepEqual(l, [{ key: 'name', dir: 1 }, { key: 'value', dir: -1 }]);
  l = clickSort(l, 'value', true, cols); assert.deepEqual(l, [{ key: 'name', dir: 1 }, { key: 'value', dir: 1 }]);
  l = clickSort(l, 'name', false, cols); assert.deepEqual(l, [{ key: 'name', dir: -1 }]);   // the first level clicked with others: flips and drops the rest
  const before = [{ key: 'value', dir: -1 }]; clickSort(before, 'value', false, cols); assert.equal(before[0].dir, -1);   // never changes what it was given
});

test('the heading and the chips', () => {
  const lv = [{ key: 'position', dir: 1 }, { key: 'value', dir: -1 }];
  const h = sortHead({ t: 'x', levels: lv, cols, extra: '<th></th>' });
  assert.match(h, /aria-sort="ascending"><button type="button" data-t="x" data-sort="position"/);
  assert.match(h, /<sup>2<\/sup>/);
  assert.match(h, /data-sort="name" title="Name">Player<\/button>/);
  const b = sortBar({ t: 'x', levels: lv, cols, defaults: lv });
  assert.match(b, /data-sflip="1"/); assert.match(b, /Stop sorting by Value/); assert.match(b, /<option value="name">Name/);
  assert.doesNotMatch(b, /data-sreset/);
  assert.match(sortBar({ t: 'x', levels: [lv[0]], cols, defaults: lv }), /data-sreset/);
  assert.ok(isDefault(lv, lv.map(x => ({ ...x }))));
  assert.ok(!isDefault([lv[0]], lv));
});
