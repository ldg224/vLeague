// The Goal of the week card's html (S-05), from its data. Pure, so it is tested without a page (tests/gotw-card.test.mjs); the card itself is js/gotw-card.js.
import { icon } from './icons.js';

const when = d => new Date(d).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

// The card's html from its data (pure, so it can be tested): { row, mine, myVote, tally (null while hidden), now, hidden: Set of fixture ids, label, name(code) }
export function gotwHtml({ row, mine, myVote, tally, now, hidden = new Set(), label, name, crest, esc }) {
  const fin = (row.finalists || []).map(k => row.candidates.find(c => c.key === k)).filter(Boolean);
  const ended = row.status === 'closed' || (row.closes_at && new Date(row.closes_at) <= now);
  const votes = k => tally?.find(r => r.pick === k)?.votes || 0, total = (tally || []).reduce((s, r) => s + r.votes, 0);
  const ranked = ended ? [...fin].sort((a, b) => votes(b.key) - votes(a.key) || b.wow - a.wow) : fin;
  const hid = fin.filter(m => hidden.has(m.fixture)).length;
  const row1 = (m, i) => {
    const mineGoal = mine && m.team === mine, secret = hidden.has(m.fixture), win = ended && i === 0 && votes(m.key) > 0, pct = total ? Math.round(votes(m.key) / total * 100) : 0;
    const act = ended ? `<span class="gwc-score"><b>${votes(m.key)}</b><small>${pct}%</small></span>`
      : mineGoal ? '<span class="gwc-tag">Your club</span>'
      : mine ? `<button type="button" class="gwc-vote${myVote === m.key ? ' on' : ''}" data-gw-vote="${esc(m.key)}" aria-pressed="${myVote === m.key}">${icon(myVote === m.key ? 'check' : 'thumbs-up')}<span>${myVote === m.key ? 'Your vote' : 'Vote'}</span></button>` : '';
    return `<li class="gwc-row${win ? ' win' : ''}${secret ? ' off' : ''}"><span class="gwc-n">${i + 1}</span>`
      + `<button type="button" class="gwc-watch" data-gw-watch="${esc(m.key)}" ${secret ? 'disabled' : ''} aria-label="Watch ${esc(m.scorerName)}’s goal">${crest(m.team, 36)}`
      + `<span class="gwc-t"><b>${esc(m.scorerName)}</b><small>${secret ? 'Result hidden' : `${esc(name(m.home))} v ${esc(name(m.away))} · ${m.minute}′`}</small>${ended ? `<i class="gwc-bar" style="--w:${pct}%"></i>` : ''}</span></button>${act}</li>`;
  };
  const note = ended ? (total ? `${total} manager${total === 1 ? '' : 's'} voted.` : 'Nobody voted.')
    : `Voting closes ${esc(when(row.closes_at))}. ${mine ? 'You can change your vote until then. The tally shows when voting ends.' : 'Only club managers vote.'}`;
  const hiddenLine = hid ? `<p class="tb-hidden">${hid} of these goals ${hid === 1 ? 'is' : 'are'} from a hidden result. <button type="button" data-reveal-all>Show all</button></p>` : '';
  return `<section class="lg-card gwc" aria-label="Goal of the week"><div class="lg-card-head"><h2>Goal of the week</h2><span class="gwc-round">${esc(label)}</span></div>`
    + `${ended ? '' : '<div class="gwc-screen"></div>'}${hiddenLine}<ol class="gwc-list">${ranked.map(row1).join('')}</ol><p class="gwc-note">${note}</p></section>`;
}
