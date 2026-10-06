// Club colours on the page. Pure functions, no DOM (the setup wizard and the shell both use them).
// A club's primary colour is the colour of its whole signed-in page, as it was picked (0.17): no lifted "accent" any more.
//   contrast(a, b)  -> WCAG contrast ratio of two '#rrggbb' colours (1 to 21)
//   onColour(c)     -> the text colour ('#ffffff' or the navy) that reads best on top of the colour c
//   isHex(c)        -> true for '#rrggbb'

export const NAVY = '#0a0f19';

export const isHex = c => /^#[0-9a-f]{6}$/i.test(c || '');

const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));

function luminance(hex) {
  const [r, g, b] = rgb(hex).map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  if (!isHex(a) || !isHex(b)) return 1;
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export const onColour = c => (contrast(c, '#ffffff') >= contrast(c, NAVY) ? '#ffffff' : NAVY);
