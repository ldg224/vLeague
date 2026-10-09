import { icon } from './icons.js';
// The draft as a grid (0.31): a row per round, a column per club, and in each cell the pick number and who was taken.
// Used by the managers' Board and by the Editor's Draft order (where unmade picks can be dragged). No page code.
//
//   gridOf(order, picks)  -> { cols: [club], rounds: [{ n, cells: Map(club -> [{ pick_no, club, pick }]) }] }
//                            order: [{ pick_no, club }], picks: [{ pick_no, player, how }]. A round is one pick per club, so
//                            the columns are the clubs in the order they first pick (the first round).
//   renderGrid(grid, o)   -> HTML. o: { esc, clubName(code), who(pick row) -> html, me, current (pick_no on the clock),
//                            made (picks made so far), editable, selected (pick_no picked for a swap), removable (show a red x on
//                            each made pick, data-act="rmpick" data-no) }
//                            A pick is made when it has a row in `picks`, not when its number is low: the office can take one
//                            back, so a later pick can be made while an earlier one is open.
//   moveColumn(cols, from, to) -> { [oldClub]: newClub } mapping for moving a column, applied to the unmade picks.

export function gridOf(order, picks = []) {
  const sorted = [...order].sort((a, b) => a.pick_no - b.pick_no);
  const cols = [...new Set(sorted.map(o => o.club))];
  const n = cols.length || 1, made = new Map(picks.map(k => [k.pick_no, k]));
  const rounds = [];
  sorted.forEach((o, i) => {
    const r = Math.floor(i / n);
    if (!rounds[r]) rounds[r] = { n: r + 1, cells: new Map(cols.map(c => [c, []])) };
    rounds[r].cells.get(o.club).push({ pick_no: o.pick_no, club: o.club, pick: made.get(o.pick_no) || null });
  });
  return { cols, rounds };
}

export function moveColumn(cols, from, to) {
  const next = [...cols];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return Object.fromEntries(cols.map((c, i) => [c, next[i]]));
}

export function renderGrid(grid, o) {
  const { esc, clubName, who, me, current, made = 0, editable, selected, removable } = o;
  if (!grid.rounds.length) return '';
  const move = editable && made === 0;
  const head = grid.cols.map((c, i) => `<th scope="col" class="dg-col${c === me ? ' me' : ''}"${move ? ` draggable="true" data-col="${esc(c)}" data-i="${i}"` : ''}>
      ${move ? `<button type="button" class="dg-mv" data-act="colleft" data-i="${i}" aria-label="Move ${esc(clubName(c))} left"${i ? '' : ' disabled'}>${icon('chevron-left')}</button>` : ''}<span>${esc(clubName(c))}${c === me ? ' (you)' : ''}</span>${move ? `<button type="button" class="dg-mv" data-act="colright" data-i="${i}" aria-label="Move ${esc(clubName(c))} right"${i < grid.cols.length - 1 ? '' : ' disabled'}>${icon('chevron-right')}</button>` : ''}</th>`).join('');
  const body = grid.rounds.map(r => `<tr><th scope="row" class="dg-r">${r.n}</th>${grid.cols.map(c => {
    const cell = r.cells.get(c) || [];
    return `<td class="dg-cell${c === me ? ' me' : ''}${cell.length === 0 ? ' none' : ''}">${cell.map(x => {
      const done = !!x.pick, now = x.pick_no === current, drag = editable && !done && x.pick_no > made;
      return `<div class="dg-pick${done ? ' done' : ''}${now ? ' now' : ''}${selected === x.pick_no ? ' sel' : ''}${drag ? ' drag' : ''}"${drag ? ` draggable="true" data-no="${x.pick_no}" tabindex="0" role="button" aria-label="Pick ${x.pick_no}, ${esc(clubName(c))}. Press to select, then press another pick to swap them."` : ` data-no="${x.pick_no}"`}>
        <span class="dg-no">#${x.pick_no}</span><span class="dg-who">${done ? who(x) : now ? '<i>On the clock</i>' : ''}</span>${removable && done ? `<button type="button" class="dg-x" data-act="rmpick" data-no="${x.pick_no}" title="Take back pick ${x.pick_no} so ${esc(clubName(c))} picks again" aria-label="Take back pick ${x.pick_no} (${esc(clubName(c))}) so they pick again">&times;</button>` : ''}</div>`;
    }).join('')}</td>`;
  }).join('')}</tr>`).join('');
  return `<div class="dg-wrap"><table class="dg"><thead><tr><th scope="col" class="dg-r">Round</th>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}
