// Run with:  node --test "tests/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { PRESETS, PRESET_ROWS, FX, ART, SPILL, EVENT_LOOKS, SCENES, isEventLook, spillOf, stageName, boardOf, pageSpillInk, artOf, resolveLook, cleanTheme, themeVars, fxHtml, swatch, fxNames, starPoints } from '../js/looks.js';
import { lookInfo, scoreboard } from '../js/scoreboard.js';

test('only the events change the match page: a normal week does not', () => {
  assert.equal(isEventLook('classic'), false);
  assert.equal(isEventLook('christmas'), false);
  assert.equal(isEventLook(undefined), false);
  assert.deepEqual([...EVENT_LOOKS].sort(), ['australia_day', 'derby', 'festive', 'finals', 'grand_final', 'last_round', 'lunar_new_year', 'movember', 'new_year', 'opening_week', 'spring_blossom', 'third_place']);
});

test('every event has a scene whose pictures are in the repo, and board colours', () => {
  for (const key of EVENT_LOOKS) {
    assert.ok(SCENES[key]?.props?.length, key);
    for (const p of SCENES[key].props) { assert.ok(existsSync(new URL(`../assets/looks/${p.src}.png`, import.meta.url)), p.src); assert.ok(['left', 'right'].includes(p.side), p.src); }
    const b = boardOf(resolveLook(key, { key, name: key, settings: {} }));
    for (const c of [...b.bg, b.edge, b.ink, ...b.plate, b.plateInk, b.clock, b.clockInk]) assert.match(c, /^#[0-9a-f]{6}$/i, key);
  }
});

test('what falls past the board: only known names get through, and the older looks have theirs', () => {
  assert.equal(cleanTheme({ spill: 'snow' }).spill, 'snow');
  assert.equal(cleanTheme({ spill: '<script>' }).spill, null);
  for (const k of ['grand_final', 'finals', 'derby']) assert.ok(SPILL.includes(spillOf({ key: k, theme: null })), k);
  assert.equal(spillOf({ key: 'classic', theme: null }), null);
  assert.equal(spillOf(resolveLook('festive', null)), 'snow');
  assert.ok(pageSpillInk(resolveLook('festive', null), 'light').length && pageSpillInk({ key: 'derby', theme: null }, 'dark').length);
});

test('the stages have names, the third place final among them', () => {
  assert.equal(stageName({ stage: 'SF' }), 'Semi-final'); assert.equal(stageName({ stage: 'TP' }), 'Third place final'); assert.equal(stageName({ stage: 'GF' }), 'Grand Final');
  assert.equal(stageName({}), null);
});

test('the database and the presets describe each redone look the same (0084, or the old colours would come back)', () => {
  const sql = readFileSync(new URL('../supabase/migrations/0084_event_looks.sql', import.meta.url), 'utf8');
  for (const key of ['festive', 'movember', 'new_year', 'australia_day', 'spring_blossom', 'last_round', 'third_place', 'lunar_new_year']) {
    const line = sql.split('\n').find(l => l.includes(`('${key}',`));
    assert.ok(line, key);
    assert.deepEqual(JSON.parse(line.slice(line.indexOf(`'{`) + 1, line.lastIndexOf(`}'`) + 1)).theme, PRESETS[key].theme, key);
  }
});

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

test('artwork: only known names get through, and every look has some', () => {
  assert.equal(cleanTheme({ art: 'chalk' }).art, 'chalk');
  assert.equal(cleanTheme({ art: '<script>' }).art, null);
  for (const [key, p] of Object.entries(PRESETS)) if (p.theme.art) assert.ok(ART.includes(p.theme.art), key);
  assert.equal(artOf(resolveLook('opening_week')), 'chalk');
  assert.equal(artOf(resolveLook('new_year')), 'beams');
  assert.equal(artOf(resolveLook('classic')), 'mow');
  assert.equal(artOf({ key: 'grand_final', theme: null }), 'beams');
  assert.equal(artOf(resolveLook('anzac', { key: 'anzac', name: 'Anzac', settings: { theme: { fx: [] } } })), 'mow');
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
  assert.match(f, /--t-bg1:#1a5c3e/);
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
  assert.deepEqual(fxNames(resolveLook('new_year', null)), ['Falling confetti', 'Sparkle']);
  assert.deepEqual(fxNames(resolveLook('classic', { settings: {} })), []);
});
