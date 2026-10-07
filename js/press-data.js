// Press conferences and reactions (0.30). No page code, so the Inbox, Home and Simulate can all import it.
//
//   pressWindow(fx, now)        -> 'open' (24 h before kick-off to kick-off) | 'closed' | 'soon' | 'none'
//   pickQuestions(bank, fxId)   -> the 3 questions this match asks (the same for both clubs: seeded by the fixture id)
//   loadPress(fixtureIds)       -> { bank, answers } from Supabase (answers: rows of press_answers)
//   savePressAnswer(fx, q, a)   -> saves through save_press_answer() (the database checks the window and the club)
//   meters(bank, answers, club) -> { fans, mood, team, opp }: each answer's effect added up, each capped at +/-3 (percent)
//   pressFactors(bank, answers, a, b) -> { [club]: factor } Simulate multiplies a club's ratings by: its own team meter and
//                                  the other club's opposition meter, each at most 3%
//   loadReactions(targets)      -> Map(target -> { counts: {emoji: n}, mine: emoji|null })
//   setReaction(target, emoji)  -> sets, changes or (same emoji again) removes the signed-in user's reaction
import { db } from './auth.js';
import { kickoff } from './dashboard-data.js';

export const QUESTIONS_PER_MATCH = 3;
export const CAP = 3;                       // percent, per meter
export const EMOJI = ['👍', '🔥', '😂', '👏', '😮'];
export const METERS = [['fans', 'Fans'], ['mood', 'Happiness'], ['team', 'Team'], ['opp', 'Opposition']];

export function pressWindow(fx, now = new Date()) {
  if (!fx || fx.postponed) return 'none';
  const ko = kickoff(fx);
  if (!ko) return 'none';
  if (now >= ko) return 'closed';
  return ko - now <= 24 * 3600e3 ? 'open' : 'soon';
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function pickQuestions(bank, fxId) {
  const list = (bank || []).filter(q => q.active !== false).slice().sort((a, b) => a.id.localeCompare(b.id));
  const out = [];
  let h = hash(String(fxId));
  while (out.length < Math.min(QUESTIONS_PER_MATCH, list.length)) {
    h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
    const q = list[h % list.length];
    if (!out.includes(q)) out.push(q);
  }
  return out;
}

export async function loadPress(fixtureIds) {
  const c = await db();
  const [bank, answers] = await Promise.all([
    c.from('press_questions').select('id, text, answers, active'),
    fixtureIds.length ? c.from('press_answers').select('fixture, club, question, answer').in('fixture', fixtureIds) : { data: [] },
  ]);
  return { bank: bank.data || [], answers: answers.data || [] };
}

export async function savePressAnswer(fixtureId, question, answer) {
  const { error } = await (await db()).rpc('save_press_answer', { p_fixture: fixtureId, p_question: question, p_answer: answer });
  if (error) throw new Error(/open|your club|Sign in|answers/.test(error.message) ? error.message : 'That didn’t save. Check your connection and try again.');
}

export function chosen(bank, row) {
  const q = bank.find(x => x.id === row.question);
  const a = q?.answers.find(x => x.id === row.answer);
  return q && a ? { q, a } : null;
}

export function meters(bank, rows, club) {
  const m = { fans: 0, mood: 0, team: 0, opp: 0 };
  for (const r of rows) {
    if (r.club !== club) continue;
    const c = chosen(bank, r);
    if (c) for (const k of Object.keys(m)) m[k] += Number(c.a[k]) || 0;
  }
  for (const k of Object.keys(m)) m[k] = Math.max(-CAP, Math.min(CAP, m[k]));
  return m;
}

// A club's players play at (1 + team%) times their ratings, and (1 + the other club's opp%) times again.
export function pressFactors(bank, rows, a, b) {
  const ma = meters(bank, rows, a), mb = meters(bank, rows, b);
  return { [a]: (1 + ma.team / 100) * (1 + mb.opp / 100), [b]: (1 + mb.team / 100) * (1 + ma.opp / 100) };
}

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
