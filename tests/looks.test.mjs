// Run with:  node --test "tests/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, PRESET_ROWS, FX, resolveLook, cleanTheme, themeVars, fxHtml, swatch, fxNames, starPoints } from '../js/looks.js';
import { lookInfo, scoreboard } from '../js/scoreboard.js';

test('every preset is a valid look: a key the table accepts, a clean theme, only known effects', () => {
  for (const [key, p] of Object.entries(PRESETS)) {
    assert.match(key, /^[a-z0-9_]{2,24}$/, key);
    const look = resolveLook(key, null);
    assert.deepEqual(look.theme, cleanTheme(p.theme), key);
    assert.ok(look.theme.fx.every(n => FX.includes(n)), key);
    assert.equal(look.theme.fx.length, p.theme.fx.length, `${key}: no effect was dropped`);
  }
  assert.deepEqual(PRESET_ROWS.map(r => r.key), Object.keys(PRESETS));
});

test('a look the app does not know falls back to Classic; the five older looks have no theme', () => {
  assert.equal(resolveLook('nope', null).key, 'classic');
  assert.equal(resolveLook('classic', { key: 'classic', name: 'Classic', settings: { accent: null } }).theme, null);
  assert.equal(resolveLook('derby', { key: 'derby', name: 'Derby', settings: { accent: '#ff7043', banner: 'DERBY' } }).accent, '#ff7043');
});

test('a look added as data (a table row with a theme) works without a preset', () => {
  const row = { key: 'anzac', name: 'Anzac', settings: { banner: 'ANZAC DAY', theme: { bg: ['#222222', '#111111'], ink: '#ffffff', fx: ['stars'] } } };
  const look = resolveLook('anzac', row);
  assert.equal(look.name, 'Anzac');
  assert.deepEqual(look.theme.bg, ['#222222', '#111111']);
  assert.deepEqual(look.theme.fx, ['stars']);
  assert.equal(look.theme.glow, '#6b8cff', 'what the row leaves out comes from the base theme');
});

test('the table row overlays the preset, so a look can be tuned without a release', () => {
  const look = resolveLook('festive', { key: 'festive', name: 'Festive', settings: { theme: { glow: '#00ff00', fx: ['snow'] } } });
  assert.equal(look.theme.glow, '#00ff00');
  assert.deepEqual(look.theme.fx, ['snow']);
  assert.equal(look.theme.ink, PRESETS.festive.theme.ink);
});

test('only #rrggbb colours and known effects get through: nothing else can reach the page', () => {
  const t = cleanTheme({ bg: ['red', 'url(javascript:1)'], ink: '#ZZZZZZ', edge: '"><script>', glow: '#ABCDEF', fx: ['snow', 'script', '<b>', 'lights', 'stars', 'moustache', 'sparkle', 'confetti', 'shine'] });
  assert.deepEqual(t.bg, ['#12182a', '#0a0e1a']);
  assert.equal(t.ink, '#f2f2f2');
  assert.equal(t.edge, '#3a4560');
  assert.equal(t.glow, '#abcdef');
  assert.deepEqual(t.fx, ['snow', 'lights', 'stars', 'moustache', 'sparkle'], 'unknown names are dropped and five effects at most');
  assert.ok(!/[<>"';]/.test(themeVars(t).replace(/;/g, '')), 'the style string holds only colours');
  assert.equal(cleanTheme(null), null);
  assert.equal(themeVars(null), '');
});

test('the scoreboard draws a themed look with its colours and effects, and an older look as before', () => {
  const season = { rounds: { 3: { label: 'Round 3' } }, looks: {} };
  const draw = look => scoreboard({ fx: { week: 3, look }, season, look: lookInfo(season, { look }), h: 'Reds', a: 'Blues', crests: ['', ''], score: '<strong>1</strong>', state: 'FT', goals: ['', ''], meta: '' });
  const f = draw('festive'), d = draw('derby');
  assert.match(f, /data-themed/);
  assert.match(f, /--t-bg1:#174a31/);
  assert.match(f, /class="sb-fx"/);
  assert.match(f, /fx-lights/);
  assert.match(f, /fx-snow/);
  assert.doesNotMatch(d, /data-themed|sb-fx/);
});

test('effects: each name draws its layer; unknown names draw nothing; the stars are a seven-pointed cross', () => {
  for (const n of FX) assert.match(fxHtml([n]), new RegExp(`fx-${n === 'moustache' ? 'mous' : n}`), n);
  assert.equal(fxHtml(['nonsense']), '');
  assert.equal(fxHtml(undefined), '');
  assert.equal(starPoints(7, 0, 0, 10).split(' ').length, 14);
  assert.equal((fxHtml(['stars']).match(/<polygon/g) || []).length, 5);
});

test('the Editor previews: every look has a swatch and a note about its effects', () => {
  for (const key of ['classic', 'finals', 'grand_final', 'christmas', 'derby', ...Object.keys(PRESETS)]) {
    const s = swatch(resolveLook(key, { key, name: key, settings: {} }));
    assert.ok(s.bg.length === 2 && /^#[0-9a-f]{6}$/.test(s.edge) && /^#[0-9a-f]{6}$/.test(s.accent), key);
  }
  assert.deepEqual(fxNames(resolveLook('new_year', null)), ['Sparkle', 'Confetti']);
  assert.deepEqual(fxNames(resolveLook('classic', { settings: {} })), []);
});
