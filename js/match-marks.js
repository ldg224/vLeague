// Match marks, drawn with Icons8 icons (Color pack, downloaded to assets/icons): a football for a goal (84301), the player kicking the ball for an assist
// (16897), a yellow card (31081) and a red card (16914), plus a grey "C" for the captain. One look everywhere they appear (the Lineup pitch, the Events timeline).
//   goalMark(n?) / assistMark(n?) / cardMark('yellow' | 'red') / captainMark() -> html; the optional n is the count shown beside the icon when more than one.
const mark = (cls, file, label, n = 1) => `<b class="mk ${cls}" role="img" aria-label="${n > 1 ? `${n} ${label}s` : label}"><img src="assets/icons/mark-${file}.png" alt="" width="26" height="26">${n > 1 ? `<small>${n}</small>` : ''}</b>`;
export const goalMark = n => mark('mk-goal', 'goal', 'Goal', n);
export const assistMark = n => mark('mk-assist', 'assist', 'Assist', n);
export const cardMark = which => mark('mk-card', which === 'red' ? 'red-card' : 'yellow-card', which === 'red' ? 'Red card' : 'Yellow card');
export const captainMark = () => '<b class="mk mk-cap" role="img" aria-label="Captain">C</b>';
