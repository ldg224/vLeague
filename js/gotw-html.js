// Goal of the week (S-05), the html of its two places, from the round's data. Pure, so it is tested without a page (tests/gotw-card.test.mjs).
//   overviewHtml(d)   the Overview card: a teaser with a button to the Vote tab while voting is open; the result once it has ended
//   voteHtml(d)       the Vote tab: the screen for the clips (put in by js/gotw-card.js), a status line and the ballot
//   isOpen(row, now)  is voting open (the office opened it and the time has not passed)?
//   ballot(row, mine) the finalists in the order this club sees them (a fixed shuffle per club, so no goal always sits first)
// d = { row, mine (club code or undefined), myVote (key or null), tally (null until it has ended), now, hidden (Set of fixture ids), label, name(code), crest(code, px), esc,
//       playing (key) }
import { icon } from './icons.js';
import { describe } from './goal-wow.js';

const when = d => new Date(d).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export const isOpen = (row, now = new Date()) => Boolean(row && row.status === 'voting' && (!row.closes_at || new Date(row.closes_at) > now));
const finalists = row => (row.finalists || []).map(k => row.candidates.find(c => c.key === k)).filter(Boolean);
const hash = str => { let h = 2166136261; for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
export const ballot = (row, mine) => (mine ? [...finalists(row)].sort((a, b) => hash(mine + a.key) - hash(mine + b.key)) : [...finalists(row)].sort((a, b) => b.wow - a.wow));
export const left = ms => {
  const m = Math.max(1, Math.round(ms / 6e4)), d = Math.floor(m / 1440), h = Math.floor(m % 1440 / 60);
  return d ? `${d} d ${h} h` : h ? `${h} h ${m % 60} min` : `${m} min`;
};

// The line that says where this manager stands: a flashing dot while they have not voted, a tick once they have.
function status({ row, mine, myVote, now, esc }) {
  const ends = new Date(row.closes_at);
  const clock = row.closes_at ? `<span class="gv-left" data-until="${+ends}">${left(ends - now)} left</span>` : '';
  if (!mine) return `<p class="gv-status info">${icon('vote')}<span>Only club managers vote. Voting closes ${esc(when(row.closes_at))}.</span></p>`;
  const picked = myVote && row.candidates.find(c => c.key === myVote);
  if (picked) return `<p class="gv-status done">${icon('check')}<span>You voted for <b>${esc(picked.scorerName)}</b>. You can change it until voting closes. ${clock}</span></p>`;
  return `<p class="gv-status due"><i class="lg-need" aria-hidden="true"></i><span><b>You haven’t voted yet.</b> Pick the best goal. ${clock}</span></p>`;
}

export function overviewHtml(d) {
  const { row, mine, myVote, tally, now, hidden = new Set(), label, name, crest, esc } = d;
  const open = isOpen(row, now), fin = finalists(row);
  const head = `<div class="lg-card-head"><h2>Goal of the week</h2><span class="gwc-round">${esc(label)}</span></div>`;
  if (open) {
    const picked = myVote && row.candidates.find(c => c.key === myVote), due = mine && !picked;
    return `<section class="lg-card gwc" aria-label="Goal of the week">${head}`
      + `<p class="gwc-line">${fin.length} goals are up for the vote. Voting closes ${esc(when(row.closes_at))}.</p>`
      + `<p class="gv-status ${!mine ? 'info' : picked ? 'done' : 'due'}">${!mine ? icon('vote') : picked ? icon('check') : '<i class="lg-need" aria-hidden="true"></i>'}<span>${!mine ? 'Only club managers vote.' : picked ? `You voted for <b>${esc(picked.scorerName)}</b>.` : '<b>You haven’t voted yet.</b>'}</span></p>`
      + `<a class="gv-go${due ? ' due' : ''}" href="#vote">${due ? 'Watch and vote' : 'Watch the goals'}${icon('chevron-right')}</a></section>`;
  }
  const votes = k => tally?.find(r => r.pick === k)?.votes || 0, total = (tally || []).reduce((s, r) => s + r.votes, 0);
  const ranked = [...fin].sort((a, b) => votes(b.key) - votes(a.key) || b.wow - a.wow);
  const row1 = (m, i) => {
    const secret = hidden.has(m.fixture), win = i === 0 && votes(m.key) > 0, pct = total ? Math.round(votes(m.key) / total * 100) : 0;
    return `<li class="gwc-row${win ? ' win' : ''}">${avatar(d, m, 36)}<span class="gwc-t"><b>${esc(m.scorerName)}</b>`
      + `<small>${secret ? 'Result hidden' : `${fixtureLine(m, esc, name)}`}</small><i class="gwc-bar" style="--w:${pct}%"></i></span>`
      + `<span class="gwc-score"><b>${votes(m.key)}</b><small>${pct}%</small></span></li>`;
  };
  const hid = fin.filter(m => hidden.has(m.fixture)).length;
  return `<section class="lg-card gwc" aria-label="Goal of the week">${head}`
    + `${hid ? `<p class="tb-hidden">${hid} of these goals ${hid === 1 ? 'is' : 'are'} from a hidden result. <button type="button" data-reveal-all>Show all</button></p>` : ''}`
    + `<ol class="gwc-list">${ranked.map(row1).join('')}</ol><p class="gwc-note">${total ? `${total} manager${total === 1 ? '' : 's'} voted.` : 'Nobody voted.'}</p></section>`;
}

// The scorer's portrait with his club's crest on its corner, or just the crest until the players have loaded (d.face(playerId, club, px) -> html).
const avatar = (d, m, px) => {
  const pic = d.face?.(m.scorer, m.team, px);
  return pic ? `<span class="gw-pf" style="--px:${px}px">${pic}<span class="gw-pfc">${d.crest(m.team, Math.round(px / 2))}</span></span>` : d.crest(m.team, px);
};

// "Neegy FC · v Lucky FC · 23′": the scorer's club first, so a goal in "Lucky FC v Neegy FC" isn't read as Lucky's.
const fixtureLine = (m, esc, name) => `${esc(name(m.team))} · v ${esc(name(m.team === m.home ? m.away : m.home))} · ${m.minute}′`;

export function voteHtml(d) {
  const { row, mine, myVote, now, hidden = new Set(), label, name, crest, esc, playing } = d;
  const list = ballot(row, mine);
  const rows = list.map(m => {
    const own = mine && m.team === mine, secret = hidden.has(m.fixture), on = myVote === m.key;
    const act = own ? '<span class="gv-tag">Your club</span>'
      : mine ? `<button type="button" class="gv-vote${on ? ' on' : ''}" data-gw-vote="${esc(m.key)}" aria-pressed="${on}">${icon(on ? 'check' : 'thumbs-up')}<span>${on ? 'Your vote' : 'Vote'}</span></button>` : '';
    return `<li class="gv-row${playing === m.key ? ' now' : ''}${on ? ' voted' : ''}"><button type="button" class="gv-watch" data-gw-watch="${esc(m.key)}" ${secret ? 'disabled' : ''} aria-label="Watch ${esc(m.scorerName)}’s goal">`
      + `${avatar(d, m, 40)}<span class="gv-t"><b>${esc(m.scorerName)}</b><small>${secret ? 'Result hidden' : `${fixtureLine(m, esc, name)}`}</small></span></button>${act}</li>`;
  }).join('');
  const hid = list.filter(m => hidden.has(m.fixture)).length;
  const first = list.find(m => m.key === playing) || list[0];
  return `<div class="lg-cols gv" data-view="vote"><div class="lg-main">`
    + `<section class="lg-card gv-stage" aria-label="Goal of the week"><span class="gv-hollow" aria-hidden="true">${esc(String(first?.scorerName || '').split(' ').slice(-1)[0])}</span>`
    + `<div class="lg-card-head"><h2>Goal of the week</h2><span class="gwc-round">${esc(label)}</span></div>${status({ row, mine, myVote, now, esc })}`
    + `<div class="gv-screen"></div><div class="gv-now" aria-live="polite"></div></section></div>`
    + `<aside class="lg-side"><section class="lg-card gv-ballot" aria-label="Ballot"><div class="lg-card-head"><h2>The ${list.length} goals</h2></div>`
    + `${hid ? `<p class="tb-hidden">${hid} of these goals ${hid === 1 ? 'is' : 'are'} from a hidden result. <button type="button" data-reveal-all>Show all</button></p>` : ''}`
    + `<ul class="gv-list">${rows}</ul></section></aside></div>`;
}

export const nowLine = (m, esc, name) => `<b>${esc(m.scorerName)}</b><span>${fixtureLine(m, esc, name)}</span><small>${esc(describe(m))}</small>`;
