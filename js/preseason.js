// Preseason (rounds marked "Preseason" in Editor > Fixtures): played for a preseason ladder and preseason stats, kept apart from the real season.
// Pure functions, no page code (tests/preseason.test.mjs).
//
//   hasPreseason(season)            is any round a preseason round?
//   phaseOf(season, now)            'pre' until the first real league match kicks off, then 'season' (automatic; nothing to switch)
//   scoped(season, scope)           a copy of the season for 'pre' (only preseason matches count) or 'season' (preseason left out)
//   scopePills(scope, tag)          the Preseason | Season switch (buttons with data-scope)
//
// Preseason fixtures carry `preseason: true` and, because their round has "Counts for the table" off, `exhibition: true`, so every part of the site that
// leaves exhibitions out (win chance, head-to-head, form) still does. Only the table, the stats and Team of the week look through scoped().
import { kickoff } from './dashboard-data.js';

export const PRESEASON_COLOUR = '#8522f0';

const real = f => !f.test && !f.preseason && !f.exhibition;

export const hasPreseason = season => Boolean(season?.fixtures?.some(f => f.preseason));

export function phaseOf(season, now = new Date()) {
  if (!hasPreseason(season)) return 'season';
  const starts = season.fixtures.filter(f => real(f) && kickoff(f)).map(f => +kickoff(f));
  return starts.length && Math.min(...starts) <= +now ? 'season' : 'pre';
}

export function scoped(season, scope) {
  if (!season || !hasPreseason(season)) return season;
  const fixtures = scope === 'pre'
    ? season.fixtures.filter(f => f.preseason).map(f => ({ ...f, exhibition: false }))
    : season.fixtures.filter(f => !f.preseason);
  return { ...season, fixtures, ...(scope === 'pre' ? { adjustments: [] } : {}) };
}

export function scopePills(scope) {
  const b = (key, label) => `<button type="button" data-scope="${key}" aria-pressed="${scope === key}">${label}</button>`;
  return `<nav class="sc-toggle ps-pills" aria-label="Which games">${b('pre', 'Preseason')}${b('season', 'Season')}</nav>`;
}

export const tag = '<span class="ps-tag">Preseason</span>';
