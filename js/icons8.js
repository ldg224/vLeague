// Icons for the revamp's league page (league.html): Icons8 "Fluent Systems Regular" (https://icons8.com, free licence with
// the "Icons by Icons8" link in the footer). Free PNGs (96 px, black) in assets/icons8/, drawn as a CSS mask so they take the
// current text colour like the old SVG icons. Same call as icons.js, which the older pages keep using:
//   icon(name, { label })  -> html; with label it is announced, without it the icon is decoration
// To add one: pick it in the same pack (icons8.json at the repo root), save its PNG to assets/icons8/<name>.png, add the name below.
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// name -> [file, mirrored]; the pack's left caret is drawn differently, so it is the right one mirrored
const ICONS = {
  'settings': ['settings'],
  'pencil': ['edit'],
  'shield': ['shield'],
  'chevron-down': ['chevron-down'],
  'chevron-right': ['chevron-right'],
  'chevron-left': ['chevron-right', true],
  'star': ['star'],
  'trophy': ['trophy'],
};

export const icon = (name, { label } = {}) => {
  const [file, flip] = ICONS[name] || [];
  const a11y = label ? ` role="img" aria-label="${esc(label)}"` : ' aria-hidden="true"';
  return `<span class="ic ic8${flip ? ' is-flip' : ''}" style="-webkit-mask-image:url(assets/icons8/${file}.png);mask-image:url(assets/icons8/${file}.png)"${a11y}></span>`;
};
