// The league's players, from Supabase (0.11). Replaces the s3 site's season.json players.
// Shape matches what the pages already use: { id, name, team, position, number, offense, defense, value }, where `team` is the
// club code, or '' for a free agent.
// Cached in the browser for a few minutes so a page costs at most one small read (the whole league is about 25 KB).
import { db, ready } from './auth.js';

const KEY = 'vleague-players';
const TTL = 5 * 60 * 1000;
let memo = null;

const shape = r => ({ id: r.id, name: r.name, team: r.club || '', position: r.position, number: r.number, offense: r.offense, defense: r.defense, value: r.value });

export function forgetPlayers() {
  memo = null;
  try { sessionStorage.removeItem(KEY); } catch { /* storage blocked */ }
}

export async function loadPlayers({ fresh = false } = {}) {
  if (!ready) return [];
  if (!fresh) {
    if (memo && Date.now() - memo.at < TTL) return memo.list;
    try {
      const saved = JSON.parse(sessionStorage.getItem(KEY) || 'null');
      if (saved && Date.now() - saved.at < TTL) { memo = saved; return saved.list; }
    } catch { /* storage blocked or bad data */ }
  }
  const { data, error } = await (await db()).from('players').select('id, name, position, number, offense, defense, club, value').order('id').range(0, 1999);
  if (error) throw new Error('The players didn’t load.');
  memo = { at: Date.now(), list: data.map(shape) };
  try { sessionStorage.setItem(KEY, JSON.stringify(memo)); } catch { /* storage blocked */ }
  return memo.list;
}
