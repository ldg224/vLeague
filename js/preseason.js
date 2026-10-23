// Preseason (a round Type in Editor > Fixtures): played for a preseason table and preseason stats, kept apart from the real season, in deep purple.
// No page code besides the remembered choice (tests/preseason.test.mjs).
//
//   hasPreseason(season)       is any game a preseason game?
//   phaseOf(season, now)       'preseason' until every preseason game has finished or the first real match kicks off (whichever is first), then 'season'
//   scopeNow(season, now)      what a page shows: the viewer's pick if they made one in this phase, else the phase
//   pickScope(season, scope, now)   remember the viewer's pick (browser only; lasts while the phase stays the same)
//   scopePills(scope)          the Preseason | Season switch (buttons with data-scope)
//   tag                        the purple "Preseason" chip
import { kickoff, status } from './dashboard-data.js';
import { tableOf } from './scope.js';

export const PRESEASON_COLOUR = '#8522f0';

export const hasPreseason = season => Boolean(season?.fixtures?.some(f => f.preseason));

export function phaseOf(season, now = new Date()) {
  if (!hasPreseason(season)) return 'season';
  const pre = season.fixtures.filter(f => f.preseason && !f.postponed);
  if (pre.length && pre.every(f => f.result && status(f, season, now) === 'ft')) return 'season';   // preseason is over: the real table starts from nothing
  const starts = season.fixtures.filter(f => tableOf(f) === 'season' && kickoff(f)).map(f => +kickoff(f));
  return starts.length && Math.min(...starts) <= +now ? 'season' : 'preseason';
}

const KEY = 'vl-table-scope';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } };

export function scopeNow(season, now = new Date()) {
  const phase = phaseOf(season, now), mine = read();
  return mine && mine.phase === phase && (mine.scope === 'preseason' || mine.scope === 'season') ? mine.scope : phase;
}

export function pickScope(season, scope, now = new Date()) {
  try { localStorage.setItem(KEY, JSON.stringify({ scope, phase: phaseOf(season, now) })); } catch { /* the pick just lasts until the page changes */ }
}

export function scopePills(scope) {
  const b = (key, label) => `<button type="button" data-scope="${key}" aria-pressed="${scope === key}">${label}</button>`;
  return `<nav class="sc-toggle ps-pills" aria-label="Which games">${b('preseason', 'Preseason')}${b('season', 'Season')}</nav>`;
}

export const tag = '<span class="ps-tag">Preseason</span>';
