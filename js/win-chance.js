// ONE way to work out a match's win chance for every page (the fixtures page, the matches page, the match page, the game page), so they
// always agree and move together (the user, 15 Oct 2026).
//   loadChanceSheets()                              -> [{ week, club, formation, captain, lineup, kit }]: locked sheets (week_sheets) for every round, plus
//                                                      the submitted-but-not-locked ones (all_submitted_lineups) for rounds still open; a locked sheet wins
//   chanceOf(season, fx, { sheets, now, hidden })   -> { w: winChance result, pct: [home, draw, away] whole percents }; `hidden` = the viewer
//                                                      has hidden this result, so the chance is worked out as if it were not in yet and never goes live
import { db } from './auth.js';
import { winChance, percents } from './match-model.js';
import { liveState } from './dashboard-data.js';

export async function loadChanceSheets() {
  try {
    const c = await db();
    const [locked, open] = await Promise.all([
      c.from('week_sheets').select('week, club, formation, captain, lineup, kit').range(0, 1999).then(r => r.data || []).catch(() => []),
      c.rpc('all_submitted_lineups').then(r => r.data || []).catch(() => []),
    ]);
    const have = new Set(locked.map(s => `${s.week}|${s.club}`));
    return [...locked, ...open.filter(s => !have.has(`${s.week}|${s.club}`))];
  } catch { return []; }   // the model falls back to squad ratings
}

export function chanceOf(season, fx, { sheets = [], now = new Date(), hidden = false } = {}) {
  const w = winChance(season, fx, { sheets, now, live: hidden ? null : liveState(fx, season, now) });
  return { w, pct: percents(w) };
}
