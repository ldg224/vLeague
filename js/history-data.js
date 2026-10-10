// League history (0.66), read by history.html and the team pages' trophy cabinets. Written in Editor -> History.
//   loadHistory()            -> { comps, seasons (newest first), past, awards } or null if it didn't load (or isn't set up yet)
//   artOf(award, comps)      -> the picture path for an award: its own, else its competition's for that place
//   cabinet(h, code)         -> [{ comp, place, seasons: [season, ...], art }] what one current club has won, winners first
import { db } from './auth.js';
import { SUPABASE_URL } from './config.js';

export const trophyUrl = path => (path ? `${SUPABASE_URL}/storage/v1/object/public/trophies/${path}` : '');

export async function loadHistory() {
  try {
    const c = await db();
    const [comps, seasons, past, awards] = await Promise.all([
      c.from('history_competitions').select('*').order('sort').order('id'),
      c.from('history_seasons').select('*').order('sort', { ascending: false }).order('id', { ascending: false }),
      c.from('history_past_teams').select('*'),
      c.from('history_awards').select('*'),
    ]);
    if (comps.error || seasons.error) return null;
    return { comps: comps.data || [], seasons: seasons.data || [], past: past.data || [], awards: awards.data || [] };
  } catch { return null; }
}

export function artOf(a, comps) {
  if (a.art_path) return a.art_path;
  const c = comps.find(x => x.id === a.competition);
  return (a.place === 'winner' ? c?.winner_art : c?.runner_art) || '';
}

export function cabinet(h, code) {
  if (!h) return [];
  const out = [];
  for (const place of ['winner', 'runner_up']) {
    for (const comp of h.comps) {
      const won = h.awards.filter(a => a.club === code && a.competition === comp.id && a.place === place);
      if (!won.length) continue;
      const seasons = won.map(a => h.seasons.find(s => s.id === a.season)).filter(Boolean).sort((a, b) => b.sort - a.sort);
      out.push({ comp, place, seasons, art: artOf(won[0], h.comps), arts: won.map(a => artOf(a, h.comps)) });
    }
  }
  return out;
}
