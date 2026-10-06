// Which news a club sees in its Inbox, and what it has read (0.5). No page code, so Home can import it too.
//   inboxItems(season, sbNews, code) -> [{ id, src: 's3' | 'sb', post|row, at: Date, pinned }], pinned first, then newest
//   readIds(code), markRead(code, ids)  -> read state: this device plus the account's (prefs.js), so it follows you
//   unreadCount(season, sbNews, code)   -> how many of the club's items are unread
// season posts: live or closed, for 'all', 'teams' or a list of codes with this club in it.
// sbNews: rows of the Supabase news table (crest reveals and posts), all of which every club sees.
import { audienceOf, parseStamp } from './dashboard-data.js';
import { prefsNow, rememberRead } from './prefs.js';

const forClub = (post, code) => {
  const a = audienceOf(post);
  return a === 'all' || a === 'teams' || (Array.isArray(a) && a.includes(code));
};

export function inboxItems(season, sbNews, code) {
  const s3 = (season?.news || []).filter(p => (p.status === 'live' || p.status === 'closed') && forClub(p, code))
    .map(p => ({ id: `s3-${p.id}`, src: 's3', post: p, at: parseStamp(p.sent), pinned: Boolean(p.pinned) }));
  const sb = (sbNews || []).map(r => ({ id: `sb-${r.id}`, src: 'sb', row: r, at: r.created_at ? new Date(r.created_at) : null, pinned: Boolean(r.pinned || r.data?.pinned) }));
  const t = i => i.at?.getTime() || 0;
  return [...s3, ...sb].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || t(b) - t(a));
}

const key = code => `vleague-inbox-read-${code}`;
export function readIds(code) {
  try {
    const v = JSON.parse(localStorage.getItem(key(code)) || '[]');
    return new Set([...(Array.isArray(v) ? v.map(String) : []), ...prefsNow().read]);
  } catch { return new Set(prefsNow().read); }
}
export function markRead(code, ids) {
  const set = readIds(code);
  for (const id of ids) set.add(String(id));
  try { localStorage.setItem(key(code), JSON.stringify([...set])); } catch { /* storage blocked */ }
  rememberRead(ids);
  return set;
}

export function unreadCount(season, sbNews, code) {
  if (!code) return 0;
  const read = readIds(code);
  return inboxItems(season, sbNews, code).filter(i => !read.has(i.id)).length;
}
