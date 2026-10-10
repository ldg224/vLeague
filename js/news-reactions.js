// Reactions on news posts (0.30). Press conferences, which shared this file, were removed in 0.62 (S-03).
//   loadReactions(targets)      -> Map(target -> { counts: {emoji: n}, mine: emoji|null })
//   setReaction(target, emoji)  -> sets, changes or (same emoji again) removes the signed-in user's reaction
import { db } from './auth.js';

export const EMOJI = ['👍', '🔥', '😂', '👏', '😮'];

export async function loadReactions(targets) {
  const out = new Map(targets.map(t => [t, { counts: {}, mine: null }]));
  if (!targets.length) return out;
  const c = await db();
  const me = (await c.auth.getUser()).data.user?.id;
  const { data } = await c.from('reactions').select('target, user_id, emoji').in('target', targets);
  for (const r of data || []) {
    const o = out.get(r.target);
    if (!o) continue;
    o.counts[r.emoji] = (o.counts[r.emoji] || 0) + 1;
    if (r.user_id === me) o.mine = r.emoji;
  }
  return out;
}

export async function setReaction(target, emoji, current) {
  const c = await db();
  if (current === emoji) {
    const { error } = await c.from('reactions').delete().eq('target', target).eq('user_id', (await c.auth.getUser()).data.user.id);
    if (error) throw new Error('That didn’t save. Try again.');
    return null;
  }
  const { error } = await c.from('reactions').upsert({ target, emoji }, { onConflict: 'target,user_id' });
  if (error) throw new Error('That didn’t save. Try again.');
  return emoji;
}
