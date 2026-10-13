// FotMob-style marks for the match page: a round chip carrying a football (goal), a boot (assist), a card (yellow or red) or a "C" (captain). One look everywhere
// they appear (the Lineup pitch, the Events timeline), drawn here as small inline SVG, not from the icon set, so they stay the same size and colour in both themes.
//   goalMark(n?) / assistMark(n?) / cardMark('yellow' | 'red') / captainMark() -> html; the optional n is the count shown beside the chip when more than one.
const BALL = '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="9.2" fill="#fff" stroke="#111" stroke-opacity=".4"/><path fill="#111" d="m10 6.1 3.4 2.5-1.3 4H7.9l-1.3-4z"/>'
  + '<path fill="none" stroke="#111" stroke-width="1.3" stroke-linecap="round" d="M10 6.1V2.6M13.4 8.6l3.3-1.1M12.1 12.6l2 2.8M7.9 12.6l-2 2.8M6.6 8.6 3.3 7.5"/></svg>';
const BOOT = '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="9.2" fill="#fff" stroke="#111" stroke-opacity=".4"/>'
  + '<path fill="#111" d="M4.6 6.2c0-.5.4-.8.9-.7l2.4.5c.4.1.7.4.8.8l.3 1.2 3.7 1.4c1.5.6 2.5 1.9 2.7 3.5.1.5-.3.9-.8.9H5.4c-.5 0-.8-.4-.8-.8z"/>'
  + '<path fill="#111" d="M6 14.2h1.5v1.1H6zM8.7 14.2h1.5v1.1H8.7zM11.4 14.2h1.5v1.1h-1.5z"/></svg>';
const chip = (cls, inner, label, n) => `<b class="mk ${cls}" role="img" aria-label="${label}">${inner}${n > 1 ? `<small>${n}</small>` : ''}</b>`;
export const goalMark = (n = 1) => chip('mk-goal', BALL, n > 1 ? `${n} goals` : 'Goal', n);
export const assistMark = (n = 1) => chip('mk-assist', BOOT, n > 1 ? `${n} assists` : 'Assist', n);
export const cardMark = which => chip('mk-card', `<i class="mk-c is-${which === 'red' ? 'r' : 'y'}"></i>`, which === 'red' ? 'Red card' : 'Yellow card', 1);
export const captainMark = () => '<b class="mk mk-cap" role="img" aria-label="Captain">C</b>';
