// Preseason (a round Type in Editor > Fixtures): played for a preseason table and preseason stats, kept apart from the real season, in deep purple.
// No page code besides the remembered choice (tests/preseason.test.mjs).
//
//   hasPreseason(season)       is any game a preseason game?
//   phaseOf(season, now)       'preseason' until every preseason game has finished or the first real match kicks off (whichever is first), then 'season'
//   scopeNow(season, now)      what a page shows: the viewer's pick if they made one in this phase, else the phase
//   pickScope(season, scope, now)   remember the viewer's pick (browser only; during preseason it lasts while the phase stays the same; once preseason is over a look back lasts for this browser tab)
//   preseasonOver(season, now)   were there preseason games, and are they over? They are hidden from then on (user, 5 Nov 2026), reachable from the Seasons tab or league.html#preseason
//   inView(season, now)        the season with only the games the fixture lists should show: all of them during preseason; afterwards the real season, or only preseason while looking back
//   scopeBar(season, now)      the switch, when it has a job: during preseason, or to leave a look back
//   scopePills(scope)          the Preseason | vLeague switch (buttons with data-scope)
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
const LOOK = 'vl-preseason-look';   // this tab is looking back at a finished preseason; closing the tab ends it, so nobody is left on the old table
const lookingBack = () => { try { return sessionStorage.getItem(LOOK) === '1'; } catch { return false; } };

export const preseasonOver = (season, now = new Date()) => hasPreseason(season) && phaseOf(season, now) === 'season';

export function scopeNow(season, now = new Date()) {
  const phase = phaseOf(season, now);
  if (phase === 'season') return hasPreseason(season) && lookingBack() ? 'preseason' : 'season';
  const mine = read();
  return mine && mine.phase === phase && (mine.scope === 'preseason' || mine.scope === 'season') ? mine.scope : phase;
}

export function pickScope(season, scope, now = new Date()) {
  const phase = phaseOf(season, now);
  try {
    if (phase === 'season') { if (scope === 'preseason') sessionStorage.setItem(LOOK, '1'); else sessionStorage.removeItem(LOOK); }
    else localStorage.setItem(KEY, JSON.stringify({ scope, phase }));
  } catch { /* the pick just lasts until the page changes */ }
}

export function inView(season, now = new Date()) {
  if (!preseasonOver(season, now)) return season;
  const pre = scopeNow(season, now) === 'preseason';
  return { ...season, fixtures: season.fixtures.filter(f => Boolean(f.preseason) === pre) };
}

export const scopeBar = (season, now = new Date()) => (hasPreseason(season) && (!preseasonOver(season, now) || scopeNow(season, now) === 'preseason') ? scopePills(scopeNow(season, now)) : '');

export function scopePills(scope) {
  const b = (key, label) => `<button type="button" data-scope="${key}" aria-pressed="${scope === key}">${label}</button>`;
  return `<nav class="sc-toggle ps-pills" aria-label="Which games">${b('preseason', 'Preseason')}${b('season', 'vLeague')}</nav>`;
}

export const tag = '<span class="ps-tag">Preseason</span>';
