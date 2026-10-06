// The draft's reads and writes (0.21), no page code, so the nav can ask "is a draft open?" too.
// Tables and functions are the shared contract in docs/DRAFT.md.
import { db } from './auth.js';

// The draft managers can see: status live or paused and now inside opens_at..closes_at (a missing bound is open). Newest first.
export async function openDraft(now = new Date()) {
  try {
    const { data } = await (await db()).from('drafts').select('*').in('status', ['live', 'paused']).order('opens_at', { ascending: false });
    return (data || []).find(d => (!d.opens_at || new Date(d.opens_at) <= now) && (!d.closes_at || now < new Date(d.closes_at))) || null;
  } catch { return null; }
}

// Quiet times (0.28): when the pick timer doesn't run. quiet = [{ days: [0..6], from: 'HH:MM', to: 'HH:MM' }], Melbourne time.
// A manager can still pick in them; only the clock stops. The database works out the deadline (supabase/migrations/0029).
export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const clockTime = t => { const [h, m] = String(t).split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };
export function describeQuiet(quiet = []) {
  const order = [1, 2, 3, 4, 5, 6, 0];   // Monday first
  const dayText = (w) => {
    if (w.days.length === 7) return w.to <= w.from ? 'every night' : 'every day';
    const on = order.filter(d => w.days.includes(d)), parts = [];
    for (let i = 0; i < on.length;) {   // runs of three or more days become "Mon to Fri"
      let k = i; while (k + 1 < on.length && order.indexOf(on[k + 1]) === order.indexOf(on[k]) + 1) k++;
      if (k - i >= 2) parts.push(`${DAYS[on[i]]} to ${DAYS[on[k]]}`); else for (let m = i; m <= k; m++) parts.push(DAYS[on[m]]);
      i = k + 1;
    }
    return parts.join(', ');
  };
  return quiet.map(w => `${clockTime(w.from)} to ${clockTime(w.to)}, ${dayText(w)}`).join('; ');
}
// Is it quiet now, when does that end or the next one start, and how much active time is left on the pick? null if unknown.
export async function quietState(id) {
  try {
    const { data, error } = await (await db()).rpc('draft_quiet_state', { p_draft: id });
    return error || !data ? null : { ...data, at: Date.now() };
  } catch { return null; }
}

const one = async q => { const { data, error } = await q; if (error) throw new Error(error.message); return data || []; };

// Everything the board needs in one go.
export async function loadDraft(id, club) {
  const c = await db();
  const [draft, order, picks, queue, prefs] = await Promise.all([
    one(c.from('drafts').select('*').eq('id', id)),
    one(c.from('draft_order').select('pick_no, club').eq('draft', id).order('pick_no')),
    one(c.from('draft_picks').select('pick_no, club, player, made_at, how').eq('draft', id).order('pick_no')),
    club ? one(c.from('draft_queue').select('rank, player').eq('draft', id).eq('club', club).order('rank')) : [],
    club ? one(c.from('draft_prefs').select('mode, minutes, pick_how').eq('draft', id).eq('club', club)) : [],
  ]);
  return { draft: draft[0] || null, order, picks, queue: queue.map(r => r.player), prefs: prefs[0] || { mode: 'on_miss', minutes: null, pick_how: 'queue' } };
}

// Replace this club's queue (rank 1 = first choice).
export async function saveQueue(id, club, players) {
  const c = await db();
  const del = await c.from('draft_queue').delete().eq('draft', id).eq('club', club);
  if (del.error) throw new Error(del.error.message);
  if (!players.length) return;
  const ins = await c.from('draft_queue').insert(players.map((player, i) => ({ draft: id, club, rank: i + 1, player })));
  if (ins.error) throw new Error(ins.error.message);
}

export async function savePrefs(id, club, mode, minutes, pickHow = 'queue') {
  const { error } = await (await db()).from('draft_prefs')
    .upsert({ draft: id, club, mode, minutes: mode === 'after_minutes' ? minutes : null, pick_how: pickHow }, { onConflict: 'draft,club' });
  if (error) throw new Error(error.message);
}

export async function makePick(id, player) {
  const { error } = await (await db()).rpc('make_pick', { p_draft: id, p_player: player });
  if (error) throw new Error(error.message);
}
