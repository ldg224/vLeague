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

const one = async q => { const { data, error } = await q; if (error) throw new Error(error.message); return data || []; };

// Everything the board needs in one go.
export async function loadDraft(id, club) {
  const c = await db();
  const [draft, order, picks, queue, prefs] = await Promise.all([
    one(c.from('drafts').select('*').eq('id', id)),
    one(c.from('draft_order').select('pick_no, club').eq('draft', id).order('pick_no')),
    one(c.from('draft_picks').select('pick_no, club, player, made_at, how').eq('draft', id).order('pick_no')),
    club ? one(c.from('draft_queue').select('rank, player').eq('draft', id).eq('club', club).order('rank')) : [],
    club ? one(c.from('draft_prefs').select('mode, minutes').eq('draft', id).eq('club', club)) : [],
  ]);
  return { draft: draft[0] || null, order, picks, queue: queue.map(r => r.player), prefs: prefs[0] || { mode: 'on_miss', minutes: null } };
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

export async function savePrefs(id, club, mode, minutes) {
  const { error } = await (await db()).from('draft_prefs')
    .upsert({ draft: id, club, mode, minutes: mode === 'after_minutes' ? minutes : null }, { onConflict: 'draft,club' });
  if (error) throw new Error(error.message);
}

export async function makePick(id, player) {
  const { error } = await (await db()).rpc('make_pick', { p_draft: id, p_player: player });
  if (error) throw new Error(error.message);
}
